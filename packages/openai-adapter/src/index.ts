import OpenAI from 'openai';
import { zodTextFormat } from 'openai/helpers/zod';
import { z } from 'zod';

import {
  buildTaskSpecific,
  type DirectionPlan,
  type LintIssue,
  type NormalizedInput,
  type Planner,
  type PlanningContext,
  type RepairResult,
} from '@vpc/compiler-core';
import {
  TaskTypeSchema,
  VisualSpecSchema,
  type ReviseRequest,
  type VisualSpec,
} from '@vpc/contracts';

const scoresSchema = z
  .object({
    fidelity: z.number().min(0).max(100),
    subjectClarity: z.number().min(0).max(100),
    composition: z.number().min(0).max(100),
    hierarchy: z.number().min(0).max(100),
    lightingMaterialCoherence: z.number().min(0).max(100),
    typographyFeasibility: z.number().min(0).max(100),
    constraintControl: z.number().min(0).max(100),
    directionDistinctness: z.number().min(0).max(100),
    originalityRisk: z.number().min(0).max(100),
  })
  .strict();

export const ModelSpecSchema = z
  .object({
    taskType: TaskTypeSchema,
    goal: z.string().min(1),
    deliverable: z.string().min(1),
    subject: z.string().min(1),
    composition: z.array(z.string()),
    lighting: z.array(z.string()),
    palette: z.array(z.string()),
    materials: z.array(z.string()),
    background: z.array(z.string()),
    media: z.array(z.string()),
    mood: z.array(z.string()),
    assumptions: z.array(z.string()),
    unresolvedQuestions: z.array(
      z.object({ question: z.string(), blocking: z.boolean() }).strict(),
    ),
  })
  .strict();

const modelDirectionSchema = z
  .object({
    mode: z.enum(['faithful', 'creative', 'experimental']),
    name: z.string().min(1),
    concept: z.string().min(1),
    differenceAxes: z.array(z.string()).min(1),
    instructions: z.array(z.string()),
    scores: scoresSchema,
  })
  .strict();

export const ModelDirectionsSchema = z
  .object({ directions: z.array(modelDirectionSchema).length(3) })
  .strict();

export const ModelRevisionSchema = z
  .object({
    goal: z.string().min(1),
    composition: z.array(z.string()),
    lighting: z.array(z.string()),
    palette: z.array(z.string()),
    materials: z.array(z.string()),
    background: z.array(z.string()),
    styleDNA: z
      .object({
        media: z.array(z.string()),
        designSystem: z.array(z.string()),
        spatialLanguage: z.array(z.string()),
        mood: z.array(z.string()),
      })
      .strict(),
  })
  .strict();

type ParseResponse = {
  output_parsed: unknown;
  output?: unknown;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type ResponsesClient = {
  responses: {
    parse(input: unknown, options: { timeout: number }): Promise<ParseResponse>;
  };
};

export type AdapterErrorCode =
  | 'MODEL_OUTPUT_INVALID'
  | 'MODEL_TIMEOUT'
  | 'RATE_LIMITED'
  | 'UPSTREAM_ERROR'
  | 'CONTENT_REJECTED';

export class OpenAIAdapterError extends Error {
  constructor(
    readonly code: AdapterErrorCode,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = 'OpenAIAdapterError';
  }
}

const safeProperty = (value: unknown, key: string): unknown => {
  if (
    (typeof value !== 'object' || value === null) &&
    typeof value !== 'function'
  ) {
    return undefined;
  }
  try {
    return Reflect.get(value, key);
  } catch {
    return undefined;
  }
};

const refusalPresent = (output: unknown): boolean => {
  try {
    return JSON.stringify(output ?? '').includes('"refusal"');
  } catch {
    return false;
  }
};

export const normalizeOpenAIError = (error: unknown): OpenAIAdapterError => {
  if (error instanceof OpenAIAdapterError) return error;
  const name = safeProperty(error, 'name');
  const code = safeProperty(error, 'code');
  const status = safeProperty(error, 'status');

  if (
    name === 'AbortError' ||
    name === 'APIConnectionTimeoutError' ||
    code === 'ETIMEDOUT'
  ) {
    return new OpenAIAdapterError('MODEL_TIMEOUT', true);
  }
  if (name === 'APIConnectionError') {
    return new OpenAIAdapterError('UPSTREAM_ERROR', true);
  }
  if (status === 429) return new OpenAIAdapterError('RATE_LIMITED', true);
  const retryable =
    typeof status === 'number' &&
    (status === 408 || status === 409 || status >= 500);
  return new OpenAIAdapterError('UPSTREAM_ERROR', retryable);
};

const aspectRatio = (value: string): VisualSpec['aspectRatio'] =>
  value === 'auto'
    ? { mode: 'auto', value: null }
    : {
        mode: ['1:1', '4:3', '3:4', '16:9', '9:16'].includes(value)
          ? 'preset'
          : 'custom',
        value,
      };

const parseDomain = <T>(schema: z.ZodType<T>, value: unknown): T => {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new OpenAIAdapterError('MODEL_OUTPUT_INVALID', false);
  }
  return parsed.data;
};

type PlannerOptions = {
  timeoutMs: number;
  now: () => number;
};

export class OpenAIPlanner implements Planner {
  private latencyMs = 0;
  private inputTokens = 0;
  private outputTokens = 0;
  private retryUsed = false;
  private repairAttempts = 0;
  private readonly deadline: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: ResponsesClient,
    readonly model: string,
    options: Partial<PlannerOptions> = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.now = options.now ?? Date.now;
    this.deadline = this.now() + this.timeoutMs;
  }

  usage() {
    return {
      latencyMs: this.latencyMs,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      repairAttempts: this.repairAttempts,
    };
  }

  private remainingMs(): number {
    return Math.max(0, this.deadline - this.now());
  }

  private async parse<T>(
    schema: z.ZodType<T>,
    name: string,
    system: string,
    payload: unknown,
  ): Promise<T> {
    const request = {
      model: this.model,
      input: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify(payload) },
      ],
      text: { format: zodTextFormat(schema, name) },
    };

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const remaining = this.remainingMs();
      if (remaining <= 0) {
        throw new OpenAIAdapterError('MODEL_TIMEOUT', true);
      }

      const started = this.now();
      let response: ParseResponse;
      try {
        response = await this.client.responses.parse(request, {
          timeout: remaining,
        });
      } catch (error) {
        this.latencyMs += Math.max(0, this.now() - started);
        const normalized = normalizeOpenAIError(error);
        if (!normalized.retryable || attempt === 1 || this.retryUsed) {
          throw normalized;
        }
        this.retryUsed = true;
        continue;
      }

      this.latencyMs += Math.max(0, this.now() - started);
      if (this.remainingMs() <= 0) {
        throw new OpenAIAdapterError('MODEL_TIMEOUT', true);
      }
      this.inputTokens += response.usage?.input_tokens ?? 0;
      this.outputTokens += response.usage?.output_tokens ?? 0;
      if (
        response.output_parsed === null ||
        response.output_parsed === undefined
      ) {
        throw new OpenAIAdapterError(
          refusalPresent(response.output)
            ? 'CONTENT_REJECTED'
            : 'MODEL_OUTPUT_INVALID',
          false,
        );
      }
      return parseDomain(schema, response.output_parsed);
    }

    throw new OpenAIAdapterError('UPSTREAM_ERROR', false);
  }

  async buildVisualSpec(input: NormalizedInput): Promise<VisualSpec> {
    const planned = await this.parse(
      ModelSpecSchema,
      'visual_spec_plan',
      'Create a model-neutral visual specification. Preserve hard constraints exactly.',
      input,
    );
    const taskType =
      input.taskType === 'auto' ? planned.taskType : input.taskType;
    const taskSpecific = buildTaskSpecific(taskType, input.mandatoryElements);

    return parseDomain(VisualSpecSchema, {
      schemaVersion: '1.0.0',
      taskType,
      goal: planned.goal,
      deliverable: planned.deliverable,
      aspectRatio: aspectRatio(input.aspectRatio),
      outputLanguage: input.outputLanguage,
      mandatoryText: input.mandatoryText.map((text) => ({
        text,
        mustMatchExactly: true,
      })),
      mandatoryElements: input.mandatoryElements,
      forbiddenElements: input.forbiddenElements,
      subject: { primary: planned.subject, attributes: [] },
      sceneGraph: input.mandatoryElements.map((element, index) => ({
        id: `element-${index + 1}`,
        element,
        region: '按视觉层级安排',
        scale: '清晰可辨',
        relationships: [],
      })),
      visualHierarchy: {
        primaryFocus: planned.subject,
        secondaryElements: input.mandatoryElements,
        readingOrder: input.mandatoryElements,
      },
      composition: planned.composition,
      camera: null,
      lighting: planned.lighting,
      palette: {
        primary: planned.palette,
        accent: [],
        contrastStrategy: '主体与背景清晰分离',
      },
      materials: planned.materials,
      background: planned.background,
      styleDNA: {
        media: planned.media,
        designSystem: [],
        spatialLanguage: [],
        mood: planned.mood,
      },
      typography: null,
      qualityRequirements: ['硬约束逐项保留'],
      assumptions: input.allowAssumptions
        ? planned.assumptions.map((statement) => ({
            statement,
            confidence: 0.5,
            impact: 'medium' as const,
          }))
        : [],
      unresolvedQuestions: planned.unresolvedQuestions,
      riskFlags: [],
      ...(taskSpecific ? { taskSpecific } : {}),
    });
  }

  async planDirections(
    spec: VisualSpec,
    context?: PlanningContext,
  ): Promise<DirectionPlan[]> {
    const revision = context?.revision;
    if (
      revision &&
      revision.targetMode !== null &&
      revision.preserveOtherDirections
    ) {
      const targetSchema = z
        .object({
          direction: modelDirectionSchema.extend({
            mode: z.literal(revision.targetMode),
          }),
        })
        .strict();
      const target = await this.parse(
        targetSchema,
        'target_direction',
        'Regenerate only the requested direction and preserve all hard constraints.',
        { spec, revision, previousDirections: context.previousDirections },
      );
      return [target.direction];
    }

    return (
      await this.parse(
        ModelDirectionsSchema,
        'direction_plan',
        'Return faithful, creative, and experimental directions with distinct structural axes.',
        { spec, context: context ?? null },
      )
    ).directions;
  }

  async reviseSpec(input: ReviseRequest) {
    const instruction = input.instruction.trim();
    const targeted = input.targetMode !== null && input.preserveOtherDirections;
    if (targeted) {
      return {
        spec: input.previousSpec,
        changes: [
          {
            path: `directions.${input.targetMode}`,
            before: null,
            after: instruction,
          },
        ],
      };
    }

    const patch = await this.parse(
      ModelRevisionSchema,
      'revision_patch',
      'Return a complete strict patch for editable visual fields while preserving hard constraints.',
      input,
    );
    const spec = parseDomain(VisualSpecSchema, {
      ...input.previousSpec,
      goal: patch.goal,
      composition: patch.composition,
      lighting: patch.lighting,
      palette: { ...input.previousSpec.palette, primary: patch.palette },
      materials: patch.materials,
      background: patch.background,
      styleDNA: { ...input.previousSpec.styleDNA, ...patch.styleDNA },
    });
    const changedFields: Array<[string, string, string]> = [
      ['goal', input.previousSpec.goal, spec.goal],
      [
        'composition',
        JSON.stringify(input.previousSpec.composition),
        JSON.stringify(spec.composition),
      ],
      [
        'lighting',
        JSON.stringify(input.previousSpec.lighting),
        JSON.stringify(spec.lighting),
      ],
      [
        'palette.primary',
        JSON.stringify(input.previousSpec.palette.primary),
        JSON.stringify(spec.palette.primary),
      ],
      [
        'materials',
        JSON.stringify(input.previousSpec.materials),
        JSON.stringify(spec.materials),
      ],
      [
        'background',
        JSON.stringify(input.previousSpec.background),
        JSON.stringify(spec.background),
      ],
      [
        'styleDNA',
        JSON.stringify(input.previousSpec.styleDNA),
        JSON.stringify(spec.styleDNA),
      ],
    ];
    const changes = changedFields
      .filter(([, before, after]) => before !== after)
      .map(([path, before, after]) => ({ path, before, after }));
    return { spec, changes };
  }

  async repair(
    spec: VisualSpec,
    directions: DirectionPlan[],
    issues: LintIssue[],
  ): Promise<RepairResult> {
    this.repairAttempts += 1;
    const repaired = await this.parse(
      ModelDirectionsSchema,
      'repaired_directions',
      'Repair only the listed deterministic issues.',
      { spec, directions, issues },
    );
    return { directions: repaired.directions };
  }
}

export const createOpenAIPlanner = (config: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  now?: () => number;
}): OpenAIPlanner =>
  new OpenAIPlanner(
    new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: 0,
      logLevel: 'off',
    }) as unknown as ResponsesClient,
    config.model,
    { timeoutMs: config.timeoutMs, ...(config.now ? { now: config.now } : {}) },
  );
