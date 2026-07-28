import { describe, expect, it, vi } from 'vitest';
import { crc32, deflateSync } from 'node:zlib';
import {
  createDeterministicFakePlanner,
  normalizeInput,
} from '@vpc/compiler-core';

import {
  ModelBaselineSchema,
  ModelDirectionsSchema,
  ModelRevisionSchema,
  OpenAIAdapterError,
  OpenAIPlanner,
  normalizeOpenAIError,
  type ResponsesClient,
} from '../src/index.js';
import { OpenAIImageGenerator, type ImagesClient } from '../src/image.js';

const scores = {
  fidelity: 90,
  subjectClarity: 90,
  composition: 90,
  hierarchy: 90,
  lightingMaterialCoherence: 90,
  typographyFeasibility: 90,
  constraintControl: 90,
  directionDistinctness: 90,
  originalityRisk: 10,
};
const directions = {
  directions: ['faithful', 'creative', 'experimental'].map((mode, index) => ({
    mode,
    name: mode,
    concept: `concept-${index}`,
    differenceAxes: [['构图结构'], ['视觉叙事'], ['媒介']][index],
    instructions: [],
    scores,
  })),
};
const modelSpec = {
  taskType: 'general',
  goal: 'goal',
  deliverable: 'image',
  subject: 'subject',
  composition: [],
  lighting: [],
  palette: [],
  materials: [],
  background: [],
  media: [],
  mood: [],
  assumptions: [],
  unresolvedQuestions: [],
};

const client = (result: unknown): ResponsesClient => ({
  responses: { parse: async () => result as never },
});

const pngFor = (width: number, height: number): string => {
  const chunk = (type: string, data = Buffer.alloc(0)): Buffer => {
    const payload = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const bytes = Buffer.alloc(payload.length + 8);
    bytes.writeUInt32BE(data.length, 0);
    payload.copy(bytes, 4);
    bytes.writeUInt32BE(crc32(payload), payload.length + 4);
    return bytes;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  const pixels = Buffer.alloc((width + 1) * height);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(pixels)),
    chunk('IEND'),
  ]).toString('base64');
};

const pngWithoutImageData = (width: number, height: number): string => {
  const bytes = Buffer.from(pngFor(width, height), 'base64');
  return Buffer.concat([
    bytes.subarray(0, 33),
    bytes.subarray(bytes.length - 12),
  ]).toString('base64');
};

describe('OpenAI adapter', () => {
  it('generates exactly one low-quality PNG without automatic retry', async () => {
    let now = 1_000;
    const base64 = pngFor(1536, 1024);
    const generate = vi.fn(async () => {
      now += 12;
      return {
        created: 1,
        data: [{ b64_json: base64 }],
        usage: { input_tokens: 10, output_tokens: 20, total_tokens: 30 },
      };
    });
    const generator = new OpenAIImageGenerator(
      { images: { generate } } satisfies ImagesClient,
      'gpt-image-2',
      { timeoutMs: 500, now: () => now },
    );

    await expect(
      generator.generate({
        imageContractVersion: 'image-1',
        source: { kind: 'text', prompt: '蓝白企业展厅' },
        n: 1,
        size: '1536x1024',
        quality: 'low',
        outputFormat: 'png',
      }),
    ).resolves.toEqual({
      base64,
      mimeType: 'image/png',
      size: '1536x1024',
      usage: {
        model: 'gpt-image-2',
        latencyMs: 12,
        inputTokens: 10,
        outputTokens: 20,
        totalTokens: 30,
      },
    });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledWith(
      {
        model: 'gpt-image-2',
        prompt: '蓝白企业展厅',
        n: 1,
        size: '1536x1024',
        quality: 'low',
        output_format: 'png',
      },
      { timeout: 500 },
    );
  });

  it.each([
    '',
    'not valid base64!',
    'iVBORw0KGgo=',
    pngFor(1536, 1024),
    pngWithoutImageData(1024, 1024),
  ])('rejects empty or invalid image base64', async (b64_json) => {
    const generator = new OpenAIImageGenerator(
      {
        images: {
          generate: async () => ({
            created: 1,
            data: [{ b64_json }],
          }),
        },
      },
      'gpt-image-2',
    );
    await expect(
      generator.generate({
        imageContractVersion: 'image-1',
        source: { kind: 'text', prompt: 'test' },
        n: 1,
        size: '1024x1024',
        quality: 'low',
        outputFormat: 'png',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('rejects oversized image output before decoding', async () => {
    const generator = new OpenAIImageGenerator(
      {
        images: {
          generate: async () => ({
            data: [{ b64_json: 'A'.repeat(22_369_628) }],
          }),
        },
      },
      'gpt-image-2',
    );
    await expect(
      generator.generate({
        imageContractVersion: 'image-1',
        source: { kind: 'text', prompt: 'test' },
        n: 1,
        size: '1024x1024',
        quality: 'low',
        outputFormat: 'png',
      }),
    ).rejects.toMatchObject({
      code: 'MODEL_OUTPUT_INVALID',
      retryable: true,
    });
  });

  it('normalizes image errors and never retries automatically', async () => {
    const generate = vi.fn(async () => {
      throw { status: 429 };
    });
    const generator = new OpenAIImageGenerator(
      { images: { generate } },
      'gpt-image-2',
    );
    await expect(
      generator.generate({
        imageContractVersion: 'image-1',
        source: { kind: 'text', prompt: 'test' },
        n: 1,
        size: '1024x1024',
        quality: 'low',
        outputFormat: 'png',
      }),
    ).rejects.toMatchObject({ code: 'RATE_LIMITED', retryable: true });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it.each(['moderation_blocked', 'content_policy_violation'])(
    'maps image policy errors to content rejection',
    async (code) => {
      const generator = new OpenAIImageGenerator(
        {
          images: {
            generate: async () => {
              throw { status: 400, code };
            },
          },
        },
        'gpt-image-2',
      );
      await expect(
        generator.generate({
          imageContractVersion: 'image-1',
          source: { kind: 'text', prompt: 'test' },
          n: 1,
          size: '1024x1024',
          quality: 'low',
          outputFormat: 'png',
        }),
      ).rejects.toMatchObject({
        code: 'CONTENT_REJECTED',
        retryable: false,
      });
    },
  );

  it('expands the raw normalized input through the baseline path', async () => {
    let captured: unknown;
    const planner = new OpenAIPlanner(
      {
        responses: {
          parse: async (input) => {
            captured = input;
            return {
              output_parsed: {
                fullPrompt: 'full direct expansion',
                compactPrompt: 'compact direct expansion',
              },
            };
          },
        },
      },
      'configured-model',
    );
    const result = await planner.expand(
      normalizeInput({
        brief: 'raw brief',
        taskType: 'poster',
        aspectRatio: 'auto',
        mandatoryText: [],
        mandatoryElements: [],
        forbiddenElements: [],
        creativity: 50,
        allowAssumptions: true,
        outputLanguage: 'zh-CN',
      }),
    );

    expect(ModelBaselineSchema.safeParse(result).success).toBe(true);
    expect(JSON.stringify(captured)).toContain('raw brief');
    expect(JSON.stringify(captured)).toContain('directly');
  });

  it('parses structured directions and records usage', async () => {
    const planner = new OpenAIPlanner(
      client({
        output_parsed: directions,
        usage: { input_tokens: 12, output_tokens: 34 },
      }),
      'configured-model',
    );
    const parsed = await planner.planDirections({} as never);

    expect(
      ModelDirectionsSchema.safeParse({ directions: parsed }).success,
    ).toBe(true);
    expect(planner.usage()).toMatchObject({
      inputTokens: 12,
      outputTokens: 34,
    });
  });

  it('sends only approved pattern summaries from optional retrieval context', async () => {
    let captured: unknown;
    const planner = new OpenAIPlanner(
      {
        responses: {
          parse: async (input) => {
            captured = input;
            return { output_parsed: directions };
          },
        },
      },
      'configured-model',
    );
    await planner.planDirections({} as never, {
      previousDirections: [],
      casePatterns: [
        {
          id: 'synthetic-one',
          license: 'CC0-1.0',
          patternSummary: 'summary only',
        },
      ],
    });

    const serialized = JSON.stringify(captured);
    expect(serialized).toContain('summary only');
    expect(serialized).toContain('CC0-1.0');
    expect(serialized).not.toContain('designGoal');
    expect(serialized).not.toContain('visualStructure');
    expect(serialized).not.toContain('sourceUrl');
  });

  it('rejects invalid and empty structured output', async () => {
    for (const output_parsed of [{ directions: [] }, null]) {
      const planner = new OpenAIPlanner(client({ output_parsed }), 'model');
      await expect(planner.planDirections({} as never)).rejects.toMatchObject({
        code: 'MODEL_OUTPUT_INVALID',
      });
    }
  });

  it('maps timeout, rate limit, and upstream errors', () => {
    expect(
      normalizeOpenAIError({ name: 'APIConnectionTimeoutError' }).code,
    ).toBe('MODEL_TIMEOUT');
    expect(normalizeOpenAIError({ status: 429 }).code).toBe('RATE_LIMITED');
    expect(normalizeOpenAIError(new Error('upstream')).code).toBe(
      'UPSTREAM_ERROR',
    );
    for (const value of [null, undefined, 'failure', 42, true]) {
      expect(normalizeOpenAIError(value)).toMatchObject({
        code: 'UPSTREAM_ERROR',
        retryable: false,
      });
    }
    for (const status of [400, 401, 403, 422]) {
      expect(normalizeOpenAIError({ status })).toMatchObject({
        code: 'UPSTREAM_ERROR',
        retryable: false,
      });
    }
    for (const status of [408, 409, 429, 500, 503]) {
      expect(normalizeOpenAIError({ status }).retryable).toBe(true);
    }
    const hostile = Object.defineProperty({}, 'status', {
      get() {
        throw new Error('sensitive getter');
      },
    });
    expect(normalizeOpenAIError(hostile)).toMatchObject({
      code: 'UPSTREAM_ERROR',
      retryable: false,
    });
    expect(normalizeOpenAIError({ name: 'APIConnectionError' })).toMatchObject({
      code: 'UPSTREAM_ERROR',
      retryable: true,
    });
  });

  it('maps refusal when parsed output is empty', async () => {
    const planner = new OpenAIPlanner(
      client({ output_parsed: null, output: [{ type: 'refusal' }] }),
      'model',
    );
    await expect(planner.planDirections({} as never)).rejects.toEqual(
      expect.objectContaining<Partial<OpenAIAdapterError>>({
        code: 'CONTENT_REJECTED',
      }),
    );
  });

  it('keeps the shared spec unchanged for a targeted preserved revision', async () => {
    const previousSpec = await createDeterministicFakePlanner().buildVisualSpec(
      normalizeInput({
        brief: '海报',
        taskType: 'poster',
        aspectRatio: '3:4',
        mandatoryText: [],
        mandatoryElements: [],
        forbiddenElements: [],
        creativity: 50,
        allowAssumptions: true,
        outputLanguage: 'zh-CN',
      }),
    );
    const planner = new OpenAIPlanner(
      client({ output_parsed: { goal: '模型改写目标' } }),
      'model',
    );
    const revised = await planner.reviseSpec({
      previousSpec,
      previousDirections: [] as never,
      instruction: '只改创意方向',
      targetMode: 'creative',
      preserveOtherDirections: true,
    });

    expect(revised.spec.goal).toBe(previousSpec.goal);
    expect(revised.changes[0]?.path).toBe('directions.creative');
  });

  it('shares one request deadline across calls and retries at most once without sleeping', async () => {
    let now = 1_000;
    const timeouts: number[] = [];
    let calls = 0;
    const planner = new OpenAIPlanner(
      {
        responses: {
          parse: async (_input, options) => {
            timeouts.push(options.timeout);
            calls += 1;
            now += calls === 1 ? 10 : 30;
            if (calls === 1) throw { status: 500 };
            return { output_parsed: directions };
          },
        },
      },
      'model',
      { timeoutMs: 50, now: () => now },
    );

    await planner.planDirections({} as never);
    await expect(planner.planDirections({} as never)).rejects.toMatchObject({
      code: 'MODEL_TIMEOUT',
    });
    expect(timeouts).toEqual([50, 40, 10]);
    expect(calls).toBe(3);
  });

  it('allows only one manual retry across the whole planner request', async () => {
    let calls = 0;
    const planner = new OpenAIPlanner(
      {
        responses: {
          parse: async () => {
            calls += 1;
            if (calls === 2) return { output_parsed: directions };
            throw { status: 500 };
          },
        },
      },
      'model',
    );

    await planner.planDirections({} as never);
    await expect(planner.planDirections({} as never)).rejects.toMatchObject({
      code: 'UPSTREAM_ERROR',
    });
    expect(calls).toBe(3);
  });

  it('keeps manual task type and suppresses assumptions when disabled', async () => {
    const planner = new OpenAIPlanner(
      client({
        output_parsed: {
          taskType: 'photography',
          goal: 'goal',
          deliverable: 'poster',
          subject: 'subject',
          composition: [],
          lighting: [],
          palette: [],
          materials: [],
          background: [],
          media: [],
          mood: [],
          assumptions: ['model assumption'],
          unresolvedQuestions: [],
        },
      }),
      'model',
    );
    const spec = await planner.buildVisualSpec({
      brief: 'brief',
      taskType: 'poster',
      aspectRatio: '1:1',
      mandatoryText: [],
      mandatoryElements: [],
      forbiddenElements: [],
      creativity: 50,
      allowAssumptions: false,
      outputLanguage: 'zh-CN',
    });

    expect(spec.taskType).toBe('poster');
    expect(spec.assumptions).toEqual([]);
  });

  it('maps domain assembly validation failures to MODEL_OUTPUT_INVALID', async () => {
    const planner = new OpenAIPlanner(
      client({
        output_parsed: {
          taskType: 'poster',
          goal: 'goal',
          deliverable: 'poster',
          subject: 'subject',
          composition: [],
          lighting: [],
          palette: [],
          materials: [],
          background: [],
          media: [],
          mood: [],
          assumptions: [],
          unresolvedQuestions: [],
        },
      }),
      'model',
    );

    await expect(
      planner.buildVisualSpec({
        brief: 'brief',
        taskType: 'poster',
        aspectRatio: '1:1',
        mandatoryText: [],
        mandatoryElements: [],
        forbiddenElements: [],
        creativity: 50,
        allowAssumptions: false,
        outputLanguage: 'x',
      }),
    ).rejects.toMatchObject({ code: 'MODEL_OUTPUT_INVALID' });
  });

  it('requests and returns only the targeted direction', async () => {
    const planner = new OpenAIPlanner(
      client({
        output_parsed: { direction: directions.directions[1] },
      }),
      'model',
    );
    const planned = await planner.planDirections({} as never, {
      previousDirections: [] as never,
      revision: {
        instruction: '只改创意方向',
        targetMode: 'creative',
        preserveOtherDirections: true,
      },
    });

    expect(planned).toHaveLength(1);
    expect(planned[0]?.mode).toBe('creative');
  });

  it.each([
    ['poster', [], 'informationHierarchy'],
    ['image_edit', ['人物身份保持'], 'preserve'],
    ['storyboard', ['角色一致性'], 'continuityAnchors'],
  ] as const)(
    'builds shared %s task-specific fields on the OpenAI path',
    async (taskType, mandatoryElements, key) => {
      const planner = new OpenAIPlanner(
        client({ output_parsed: { ...modelSpec, taskType } }),
        'model',
      );
      const spec = await planner.buildVisualSpec({
        brief: 'brief',
        taskType,
        aspectRatio: '1:1',
        mandatoryText: [],
        mandatoryElements: [...mandatoryElements],
        forbiddenElements: [],
        creativity: 50,
        allowAssumptions: false,
        outputLanguage: 'zh-CN',
      });

      expect(spec.taskSpecific).toHaveProperty(key);
    },
  );

  it('applies every supported non-targeted revision field', async () => {
    expect(ModelRevisionSchema).toBeDefined();
    const previousSpec = await createDeterministicFakePlanner().buildVisualSpec(
      normalizeInput({
        brief: '海报',
        taskType: 'poster',
        aspectRatio: '3:4',
        mandatoryText: [],
        mandatoryElements: [],
        forbiddenElements: [],
        creativity: 50,
        allowAssumptions: true,
        outputLanguage: 'zh-CN',
      }),
    );
    const patch = {
      goal: 'new goal',
      composition: ['new composition'],
      lighting: ['new lighting'],
      palette: ['blue'],
      materials: ['glass'],
      background: ['plain'],
      styleDNA: {
        media: ['photo'],
        designSystem: ['grid'],
        spatialLanguage: ['depth'],
        mood: ['calm'],
      },
    };
    const planner = new OpenAIPlanner(
      client({ output_parsed: patch }),
      'model',
    );
    const revised = await planner.reviseSpec({
      previousSpec,
      previousDirections: [] as never,
      instruction: '全面更新',
      targetMode: null,
      preserveOtherDirections: false,
    });

    expect(revised.spec).toMatchObject({
      goal: patch.goal,
      composition: patch.composition,
      lighting: patch.lighting,
      materials: patch.materials,
      background: patch.background,
      styleDNA: patch.styleDNA,
    });
    expect(revised.spec.palette.primary).toEqual(patch.palette);
  });

  it('preserves optional style DNA fields and reports only changed fields', async () => {
    const previousSpec = {
      ...(await createDeterministicFakePlanner().buildVisualSpec(
        normalizeInput({
          brief: '海报',
          taskType: 'poster',
          aspectRatio: '3:4',
          mandatoryText: [],
          mandatoryElements: [],
          forbiddenElements: [],
          creativity: 50,
          allowAssumptions: true,
          outputLanguage: 'zh-CN',
        }),
      )),
      styleDNA: {
        media: ['digital'],
        designSystem: ['grid'],
        spatialLanguage: ['depth'],
        timeCharacter: ['future'],
        graphicLanguage: ['geometric'],
        mood: ['calm'],
      },
    };
    const planner = new OpenAIPlanner(
      client({
        output_parsed: {
          goal: previousSpec.goal,
          composition: previousSpec.composition,
          lighting: previousSpec.lighting,
          palette: ['blue'],
          materials: previousSpec.materials,
          background: previousSpec.background,
          styleDNA: {
            media: previousSpec.styleDNA.media,
            designSystem: previousSpec.styleDNA.designSystem,
            spatialLanguage: previousSpec.styleDNA.spatialLanguage,
            mood: previousSpec.styleDNA.mood,
          },
        },
      }),
      'model',
    );
    const revised = await planner.reviseSpec({
      previousSpec,
      previousDirections: [] as never,
      instruction: '只改配色',
      targetMode: null,
      preserveOtherDirections: false,
    });

    expect(revised.spec.styleDNA.timeCharacter).toEqual(['future']);
    expect(revised.spec.styleDNA.graphicLanguage).toEqual(['geometric']);
    expect(revised.changes.map(({ path }) => path)).toEqual([
      'palette.primary',
    ]);
  });
});
