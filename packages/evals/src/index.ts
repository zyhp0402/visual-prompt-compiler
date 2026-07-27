import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  PROMPT_VERSION,
  compileBrief,
  createDeterministicFakePlanner,
  normalizeInput,
  type Planner,
} from '@vpc/compiler-core';
import {
  CompileRequestSchema,
  CompileResponseSchema,
  SCHEMA_VERSION,
  TaskTypeSchema,
  type CompileRequest,
  type CompileResponse,
} from '@vpc/contracts';
import {
  ModelBaselineSchema,
  createOpenAIBaselineExpander,
  createOpenAIPlanner,
  type BaselineExpansion,
  type BaselineExpander,
} from '@vpc/openai-adapter';

export type EvalMode = 'mock' | 'real';
export type EvalArm = 'baseline' | 'compiler';

export type RatioMetric = {
  numerator: number;
  denominator: number;
  rate: number | null;
};

export type LengthMetric = {
  count: number;
  total: number;
  min: number | null;
  max: number | null;
  average: number | null;
};

export type CaseMetrics = {
  mandatoryTextPreservation: RatioMetric;
  forbiddenLeakage: RatioMetric;
  schemaSuccess: boolean;
  conflictCount: number;
  directionsDistinct: boolean;
  directionAxisCount: number;
  fullPromptLength: LengthMetric;
  compactPromptLength: LengthMetric;
};

export type BenchmarkCase = {
  id: string;
  category: CompileRequest['taskType'];
  request: CompileRequest;
};

export type EvalRecord = {
  caseId: string;
  category: CompileRequest['taskType'];
  arm: EvalArm;
  status: 'success' | 'error';
  errorCode?: string;
  model: string;
  promptVersion: string;
  schemaVersion: string;
  metrics: CaseMetrics;
};

export type EvalReport = {
  run: {
    runId: string;
    mode: EvalMode;
    timestamp: string;
    inputCaseCount: number;
    armCount: number;
    promptVersion: string;
    schemaVersion: string;
    models: { baseline: string; compiler: string };
  };
  records: EvalRecord[];
  summary: {
    recordCount: number;
    failures: { count: number; recordIds: string[] };
    successCoverage: RatioMetric;
    schemaSuccess: RatioMetric;
    mandatoryTextPreservation: RatioMetric;
    forbiddenLeakage: RatioMetric;
    conflictCount: number;
    distinctDirections: RatioMetric;
    fullPromptLength: LengthMetric;
    compactPromptLength: LengthMetric;
    byArm: Record<
      EvalArm,
      {
        recordCount: number;
        successCoverage: RatioMetric;
        schemaSuccess: RatioMetric;
        mandatoryTextPreservation: RatioMetric;
        forbiddenLeakage: RatioMetric;
        conflictCount: number;
        distinctDirections: RatioMetric;
        fullPromptLength: LengthMetric;
        compactPromptLength: LengthMetric;
      }
    >;
  };
};

export type EvalErrorCode =
  | 'EVAL_INVALID_JSONL'
  | 'EVAL_INVALID_CASE'
  | 'EVAL_INVALID_CATEGORY'
  | 'EVAL_DUPLICATE_CASE_ID'
  | 'EVAL_INVALID_RUN_ID'
  | 'EVAL_REAL_CREDENTIALS_MISSING'
  | 'EVAL_ARM_FAILED'
  | 'EVAL_RUN_FAILED';

export class EvalError extends Error {
  constructor(
    readonly code: EvalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'EvalError';
  }
}

const ratio = (numerator: number, denominator: number): RatioMetric => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

const lengths = (values: number[]): LengthMetric => ({
  count: values.length,
  total: values.reduce((sum, value) => sum + value, 0),
  min: values.length === 0 ? null : Math.min(...values),
  max: values.length === 0 ? null : Math.max(...values),
  average:
    values.length === 0
      ? null
      : values.reduce((sum, value) => sum + value, 0) / values.length,
});

const mergeRatios = (items: RatioMetric[]): RatioMetric =>
  ratio(
    items.reduce((sum, item) => sum + item.numerator, 0),
    items.reduce((sum, item) => sum + item.denominator, 0),
  );

const mergeLengths = (items: LengthMetric[]): LengthMetric => {
  const count = items.reduce((sum, item) => sum + item.count, 0);
  const total = items.reduce((sum, item) => sum + item.total, 0);
  const minima = items
    .map(({ min }) => min)
    .filter((value): value is number => value !== null);
  const maxima = items
    .map(({ max }) => max)
    .filter((value): value is number => value !== null);
  return {
    count,
    total,
    min: minima.length === 0 ? null : Math.min(...minima),
    max: maxima.length === 0 ? null : Math.max(...maxima),
    average: count === 0 ? null : total / count,
  };
};

const recordSchemaRatio = (records: EvalRecord[]): RatioMetric =>
  ratio(
    records.filter(({ metrics }) => metrics.schemaSuccess).length,
    records.length,
  );

type RawCase = {
  id?: unknown;
  category?: unknown;
  brief?: unknown;
  aspectRatio?: unknown;
  mandatoryText?: unknown;
  mandatoryElements?: unknown;
  forbiddenElements?: unknown;
};

export const parseBenchmarkJsonl = (source: string): BenchmarkCase[] => {
  const cases: BenchmarkCase[] = [];
  const ids = new Set<string>();
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (line.trim() === '') continue;
    let raw: RawCase;
    try {
      raw = JSON.parse(line) as RawCase;
    } catch {
      throw new EvalError(
        'EVAL_INVALID_JSONL',
        `Benchmark line ${index + 1} is not valid JSON.`,
      );
    }
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      throw new EvalError(
        'EVAL_INVALID_CASE',
        `Benchmark line ${index + 1} has no valid id.`,
      );
    }
    const category = TaskTypeSchema.safeParse(raw.category);
    if (!category.success) {
      throw new EvalError(
        'EVAL_INVALID_CATEGORY',
        `Benchmark case ${raw.id} has an unsupported category.`,
      );
    }
    if (ids.has(raw.id)) {
      throw new EvalError(
        'EVAL_DUPLICATE_CASE_ID',
        `Benchmark case id ${raw.id} is duplicated.`,
      );
    }
    const request = CompileRequestSchema.safeParse({
      brief: raw.brief,
      taskType: category.data,
      aspectRatio: raw.aspectRatio ?? 'auto',
      mandatoryText: raw.mandatoryText ?? [],
      mandatoryElements: raw.mandatoryElements ?? [],
      forbiddenElements: raw.forbiddenElements ?? [],
      creativity: 50,
      allowAssumptions: true,
      outputLanguage: 'zh-CN',
    });
    if (!request.success) {
      throw new EvalError(
        'EVAL_INVALID_CASE',
        `Benchmark case ${raw.id} does not satisfy CompileRequest.`,
      );
    }
    ids.add(raw.id);
    cases.push({
      id: raw.id,
      category: category.data,
      request: request.data,
    });
  }
  if (cases.length === 0) {
    throw new EvalError(
      'EVAL_INVALID_CASE',
      'Benchmark input must contain at least one case.',
    );
  }
  return cases;
};

const promptsFrom = (response: CompileResponse): string[] =>
  response.directions.flatMap(({ fullPrompt, compactPrompt }) => [
    fullPrompt,
    compactPrompt,
  ]);

const normalizeSearchText = (value: string): string =>
  value.normalize('NFKC').toLocaleLowerCase('zh-CN');

const countDeterministicConflicts = (value: string): number => {
  const text = normalizeSearchText(value);
  const has = (phrase: string): boolean => text.includes(phrase);
  return [
    (has('阴天散射光') || has('柔光')) &&
      has('硬光') &&
      (has('无阴影') || has('没有阴影')),
    (has('俯视') && has('仰视')) || (has('超广角') && has('长焦')),
    (has('极简') && has('繁复')) || (has('写实') && has('扁平插画')),
  ].filter(Boolean).length;
};

const positiveForbiddenMention = (
  prompt: string,
  forbidden: string,
): boolean => {
  const haystack = normalizeSearchText(prompt);
  const needle = normalizeSearchText(forbidden);
  let offset = haystack.indexOf(needle);
  while (offset >= 0) {
    const preceding = haystack.slice(0, offset);
    const clauseStart = Math.max(
      preceding.lastIndexOf('。'),
      preceding.lastIndexOf('；'),
      preceding.lastIndexOf(';'),
      preceding.lastIndexOf('，'),
      preceding.lastIndexOf(','),
      preceding.lastIndexOf('\n'),
    );
    const before = preceding.slice(clauseStart + 1);
    const after = haystack.slice(
      offset + needle.length,
      offset + needle.length + 8,
    );
    const negativeBefore =
      /(?:不要|禁止(?:出现|包含)?|不得|避免|不出现|不能出现|勿|无|没有|排除)/u.test(
        before,
      );
    const negativeAfter =
      /^(?:不得出现|不要出现|禁止出现|排除|缺席|不可见)/u.test(after);
    if (!negativeBefore && !negativeAfter) return true;
    offset = haystack.indexOf(needle, offset + needle.length);
  }
  return false;
};

export const evaluateMetrics = (
  request: CompileRequest,
  response: CompileResponse,
): CaseMetrics => {
  const parsed = CompileResponseSchema.safeParse(response);
  const prompts = promptsFrom(response);
  const mandatoryChecks = request.mandatoryText.flatMap((text) =>
    prompts.map((prompt) => prompt.includes(text)),
  );
  const forbiddenChecks = request.forbiddenElements.flatMap((item) =>
    prompts.map((prompt) => positiveForbiddenMention(prompt, item)),
  );
  const axisSignatures = response.directions.map(({ differenceAxes }) =>
    [...new Set(differenceAxes.map(normalizeSearchText))].sort().join('|'),
  );
  const distinct =
    response.directions.length === 3 &&
    axisSignatures.every((signature) => signature.length > 0) &&
    new Set(axisSignatures).size === response.directions.length &&
    new Set(
      response.directions.map(({ fullPrompt }) =>
        normalizeSearchText(fullPrompt),
      ),
    ).size === response.directions.length &&
    new Set(
      response.directions.map(({ compactPrompt }) =>
        normalizeSearchText(compactPrompt),
      ),
    ).size === response.directions.length;

  return {
    mandatoryTextPreservation: ratio(
      mandatoryChecks.filter(Boolean).length,
      mandatoryChecks.length,
    ),
    forbiddenLeakage: ratio(
      forbiddenChecks.filter(Boolean).length,
      forbiddenChecks.length,
    ),
    schemaSuccess: parsed.success,
    conflictCount: countDeterministicConflicts(prompts.join('\n')),
    directionsDistinct: distinct,
    directionAxisCount: new Set(
      response.directions.flatMap(({ differenceAxes }) =>
        differenceAxes.map(normalizeSearchText),
      ),
    ).size,
    fullPromptLength: lengths(
      response.directions.map(({ fullPrompt }) => [...fullPrompt].length),
    ),
    compactPromptLength: lengths(
      response.directions.map(({ compactPrompt }) => [...compactPrompt].length),
    ),
  };
};

export const evaluateBaselineMetrics = (
  request: CompileRequest,
  output: unknown,
): CaseMetrics => {
  const parsed = ModelBaselineSchema.safeParse(output);
  if (!parsed.success) return emptyMetrics(request, 'baseline');
  const prompts = [parsed.data.fullPrompt, parsed.data.compactPrompt];
  const mandatoryChecks = request.mandatoryText.flatMap((text) =>
    prompts.map((prompt) => prompt.includes(text)),
  );
  const forbiddenChecks = request.forbiddenElements.flatMap((item) =>
    prompts.map((prompt) => positiveForbiddenMention(prompt, item)),
  );
  return {
    mandatoryTextPreservation: ratio(
      mandatoryChecks.filter(Boolean).length,
      mandatoryChecks.length,
    ),
    forbiddenLeakage: ratio(
      forbiddenChecks.filter(Boolean).length,
      forbiddenChecks.length,
    ),
    schemaSuccess: true,
    conflictCount: countDeterministicConflicts(prompts.join('\n')),
    directionsDistinct: false,
    directionAxisCount: 0,
    fullPromptLength: lengths([[...parsed.data.fullPrompt].length]),
    compactPromptLength: lengths([[...parsed.data.compactPrompt].length]),
  };
};

const directPrompt = (request: CompileRequest): string =>
  [
    request.brief,
    ...request.mandatoryText.map((text) => `必须逐字包含：${text}`),
    ...request.mandatoryElements.map((item) => `必须包含：${item}`),
    ...request.forbiddenElements.map((item) => `禁止出现：${item}`),
    `画幅：${request.aspectRatio}`,
  ].join('；');

const deterministicRequestId = (caseIndex: number, arm: EvalArm): string => {
  const suffix = (caseIndex * 2 + (arm === 'compiler' ? 2 : 1))
    .toString(16)
    .padStart(12, '0');
  return `00000000-0000-4000-8000-${suffix}`;
};

const expectedPromptCount = (arm: EvalArm): number =>
  arm === 'baseline' ? 2 : 6;

const emptyMetrics = (request: CompileRequest, arm: EvalArm): CaseMetrics => ({
  mandatoryTextPreservation: ratio(
    0,
    request.mandatoryText.length * expectedPromptCount(arm),
  ),
  forbiddenLeakage: ratio(
    0,
    request.forbiddenElements.length * expectedPromptCount(arm),
  ),
  schemaSuccess: false,
  conflictCount: 0,
  directionsDistinct: false,
  directionAxisCount: 0,
  fullPromptLength: lengths([]),
  compactPromptLength: lengths([]),
});

const summarizeRecords = (records: EvalRecord[]) => ({
  recordCount: records.length,
  successCoverage: ratio(
    records.filter(({ status }) => status === 'success').length,
    records.length,
  ),
  schemaSuccess: recordSchemaRatio(records),
  mandatoryTextPreservation: mergeRatios(
    records.map(({ metrics }) => metrics.mandatoryTextPreservation),
  ),
  forbiddenLeakage: mergeRatios(
    records.map(({ metrics }) => metrics.forbiddenLeakage),
  ),
  conflictCount: records.reduce(
    (sum, { metrics }) => sum + metrics.conflictCount,
    0,
  ),
  distinctDirections: ratio(
    records.filter(({ metrics }) => metrics.directionsDistinct).length,
    records.length,
  ),
  fullPromptLength: mergeLengths(
    records.map(({ metrics }) => metrics.fullPromptLength),
  ),
  compactPromptLength: mergeLengths(
    records.map(({ metrics }) => metrics.compactPromptLength),
  ),
});

type ExecuteOptions = {
  mode: EvalMode;
  source?: string | undefined;
  runId: string;
  now: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
  readSource?: () => Promise<string>;
  writeArtifacts?: (report: EvalReport) => Promise<void>;
  realFactories?: {
    planner: (config: {
      apiKey: string;
      model: string;
      timeoutMs: number;
    }) => Planner;
    baseline: (config: {
      apiKey: string;
      model: string;
      timeoutMs: number;
    }) => BaselineExpander;
  };
};

const requireRealConfig = (
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): { apiKey: string; model: string } => {
  const apiKey = env.OPENAI_API_KEY?.trim();
  const model = env.OPENAI_TEXT_MODEL?.trim();
  if (!apiKey || !model) {
    throw new EvalError(
      'EVAL_REAL_CREDENTIALS_MISSING',
      'Real evaluation requires OPENAI_API_KEY and OPENAI_TEXT_MODEL.',
    );
  }
  return { apiKey, model };
};

export const executeEvaluation = async (
  options: ExecuteOptions,
): Promise<EvalReport> => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(options.runId)) {
    throw new EvalError(
      'EVAL_INVALID_RUN_ID',
      'Run id is not filesystem-safe.',
    );
  }
  const realConfig =
    options.mode === 'real'
      ? requireRealConfig(options.env ?? process.env)
      : undefined;
  const source =
    options.source ??
    (await (
      options.readSource ??
      (() => readFile(resolve('fixtures/benchmark-cases.jsonl'), 'utf8'))
    )());
  const cases = parseBenchmarkJsonl(source);
  const records: EvalRecord[] = [];
  const models = {
    baseline:
      options.mode === 'mock'
        ? 'deterministic-direct-baseline'
        : realConfig!.model,
    compiler:
      options.mode === 'mock'
        ? 'deterministic-fake-planner'
        : realConfig!.model,
  };
  const realFactories = options.realFactories ?? {
    planner: createOpenAIPlanner,
    baseline: createOpenAIBaselineExpander,
  };

  for (const [caseIndex, testCase] of cases.entries()) {
    for (const arm of ['baseline', 'compiler'] as const) {
      const requestId = deterministicRequestId(caseIndex, arm);
      try {
        if (arm === 'baseline') {
          let output: BaselineExpansion;
          let model: string;
          if (options.mode === 'mock') {
            const prompt = directPrompt(testCase.request);
            output = { fullPrompt: prompt, compactPrompt: prompt };
            model = 'deterministic-direct-baseline';
          } else {
            const expander = realFactories.baseline({
              apiKey: realConfig!.apiKey,
              model: realConfig!.model,
              timeoutMs: 45_000,
            });
            output = await expander.expand(normalizeInput(testCase.request));
            model = expander.model;
          }
          records.push({
            caseId: testCase.id,
            category: testCase.category,
            arm,
            status: 'success',
            model,
            promptVersion: PROMPT_VERSION,
            schemaVersion: SCHEMA_VERSION,
            metrics: evaluateBaselineMetrics(testCase.request, output),
          });
          continue;
        }
        const response = await compileBrief(testCase.request, {
          planner:
            options.mode === 'mock'
              ? createDeterministicFakePlanner()
              : realFactories.planner({
                  apiKey: realConfig!.apiKey,
                  model: realConfig!.model,
                  timeoutMs: 45_000,
                }),
          requestId: () => requestId,
        });
        records.push({
          caseId: testCase.id,
          category: testCase.category,
          arm,
          status: 'success',
          model: response.usage.model,
          promptVersion: response.promptVersion,
          schemaVersion: response.schemaVersion,
          metrics: evaluateMetrics(testCase.request, response),
        });
      } catch (error) {
        records.push({
          caseId: testCase.id,
          category: testCase.category,
          arm,
          status: 'error',
          errorCode:
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            typeof error.code === 'string'
              ? error.code
              : 'EVAL_ARM_FAILED',
          model: models[arm],
          promptVersion: PROMPT_VERSION,
          schemaVersion: SCHEMA_VERSION,
          metrics: emptyMetrics(testCase.request, arm),
        });
      }
    }
  }

  const baseline = records.filter(({ arm }) => arm === 'baseline');
  const compiler = records.filter(({ arm }) => arm === 'compiler');
  const failures = records
    .filter(({ status }) => status === 'error')
    .map(({ caseId, arm }) => `${caseId}:${arm}`);
  const combined = summarizeRecords(records);
  const report: EvalReport = {
    run: {
      runId: options.runId,
      mode: options.mode,
      timestamp: options.now,
      inputCaseCount: cases.length,
      armCount: 2,
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      models,
    },
    records,
    summary: {
      ...combined,
      failures: { count: failures.length, recordIds: failures },
      byArm: {
        baseline: summarizeRecords(baseline),
        compiler: summarizeRecords(compiler),
      },
    },
  };
  await options.writeArtifacts?.(report);
  return report;
};

export const assertRunSucceeded = (report: EvalReport): void => {
  if (report.summary.failures.count > 0) {
    throw new EvalError(
      'EVAL_RUN_FAILED',
      'Evaluation completed with failed arm records.',
    );
  }
};

export const serializeReportJson = (report: EvalReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const formatRatio = (metric: RatioMetric): string =>
  `${metric.numerator}/${metric.denominator} (${metric.rate === null ? 'n/a' : metric.rate.toFixed(3)})`;

const formatLength = (metric: LengthMetric): string =>
  `count=${metric.count}, total=${metric.total}, min=${metric.min ?? 'n/a'}, max=${metric.max ?? 'n/a'}, avg=${metric.average === null ? 'n/a' : metric.average.toFixed(2)}`;

export const renderMarkdown = (report: EvalReport): string => {
  const rows = (['baseline', 'compiler'] as const).map((arm) => {
    const item = report.summary.byArm[arm];
    return `| ${arm} | ${item.recordCount} | ${formatRatio(item.successCoverage)} | ${formatRatio(item.schemaSuccess)} | ${formatRatio(item.mandatoryTextPreservation)} | ${formatRatio(item.forbiddenLeakage)} | ${item.conflictCount} | ${formatRatio(item.distinctDirections)} |`;
  });
  const failureLines =
    report.summary.failures.recordIds.length === 0
      ? ['- None']
      : report.summary.failures.recordIds.map((id) => `- ${id}`);
  return [
    `# Evaluation ${report.run.runId}`,
    '',
    `- Mode: ${report.run.mode}`,
    `- Timestamp: ${report.run.timestamp}`,
    `- Cases: ${report.run.inputCaseCount}`,
    `- Prompt version: ${report.run.promptVersion}`,
    `- Schema version: ${report.run.schemaVersion}`,
    `- Baseline model: ${report.run.models.baseline}`,
    `- Compiler model: ${report.run.models.compiler}`,
    '',
    '| Arm | Records | Success coverage | Schema success | Mandatory text preservation | Forbidden leakage | Conflicts | Distinct directions |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `- Full prompt lengths: ${formatLength(report.summary.fullPromptLength)}`,
    `- Compact prompt lengths: ${formatLength(report.summary.compactPromptLength)}`,
    '',
    '## Failed record IDs',
    '',
    ...failureLines,
    '',
    '> Metrics describe deterministic contract behavior only; they do not measure visual quality or beauty.',
    '',
  ].join('\n');
};

export const writeEvalArtifacts = async (
  report: EvalReport,
  outDir: string,
): Promise<{ jsonPath: string; markdownPath: string }> => {
  const jsonPath = join(outDir, `${report.run.runId}.json`);
  const markdownPath = join(outDir, `${report.run.runId}.md`);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, serializeReportJson(report), 'utf8');
  await writeFile(markdownPath, renderMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
};

export const finalizeEvaluationRun = async (
  report: EvalReport,
  outDir: string,
  write: typeof writeEvalArtifacts = writeEvalArtifacts,
  onWritten: (paths: { jsonPath: string; markdownPath: string }) => void = () =>
    undefined,
): ReturnType<typeof writeEvalArtifacts> => {
  const paths = await write(report, outDir);
  onWritten(paths);
  assertRunSucceeded(report);
  return paths;
};
