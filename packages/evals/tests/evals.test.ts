import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it, vi } from 'vitest';
import { createDeterministicFakePlanner } from '@vpc/compiler-core';
import {
  assertRunSucceeded,
  EvalError,
  evaluateBaselineMetrics,
  evaluateMetrics,
  executeEvaluation,
  finalizeEvaluationRun,
  parseBenchmarkJsonl,
  renderMarkdown,
  serializeReportJson,
  type EvalReport,
} from '../src/index.js';
import {
  EVALUATION_VERSION,
  approveVersions,
  checkApprovedVersions,
} from '../src/versions.js';

const fixturePath = resolve('../../fixtures/benchmark-cases.jsonl');

describe('benchmark parsing', () => {
  it('maps category and fills documented defaults', () => {
    const [testCase] = parseBenchmarkJsonl(
      '{"id":"one","category":"poster","brief":"brief"}',
    );
    expect(testCase?.request).toEqual({
      brief: 'brief',
      taskType: 'poster',
      aspectRatio: 'auto',
      mandatoryText: [],
      mandatoryElements: [],
      forbiddenElements: [],
      creativity: 50,
      allowAssumptions: true,
      outputLanguage: 'zh-CN',
    });
  });

  it.each([
    ['{', 'EVAL_INVALID_JSONL'],
    ['', 'EVAL_INVALID_CASE'],
    ['   \r\n\t', 'EVAL_INVALID_CASE'],
    [
      '{"id":"one","category":"unknown","brief":"brief"}',
      'EVAL_INVALID_CATEGORY',
    ],
    [
      '{"id":"one","category":"poster","brief":"brief"}\n{"id":"one","category":"poster","brief":"brief"}',
      'EVAL_DUPLICATE_CASE_ID',
    ],
  ])('returns stable errors', (source, code) => {
    expect(() => parseBenchmarkJsonl(source)).toThrowError(
      expect.objectContaining({ code }),
    );
  });
});

describe('metrics', () => {
  it('scores the baseline as two prompts without a compiler response wrapper', () => {
    const testCase = parseBenchmarkJsonl(
      '{"id":"baseline","category":"poster","brief":"brief","mandatoryText":["COPY"],"forbiddenElements":["人物"]}',
    )[0]!;
    const metrics = evaluateBaselineMetrics(testCase.request, {
      fullPrompt: 'COPY；禁止出现：人物',
      compactPrompt: 'COPY；禁止出现：人物',
    });
    expect(metrics.schemaSuccess).toBe(true);
    expect(metrics.mandatoryTextPreservation).toEqual({
      numerator: 2,
      denominator: 2,
      rate: 1,
    });
    expect(metrics.forbiddenLeakage).toEqual({
      numerator: 0,
      denominator: 2,
      rate: 0,
    });
    expect(metrics.fullPromptLength.count).toBe(1);
    expect(metrics.compactPromptLength.count).toBe(1);
  });

  it('counts exact mandatory text, schema, conflicts, distinctness, and lengths', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const report = await executeEvaluation({
      mode: 'mock',
      source,
      runId: 'metrics-run',
      now: '2026-07-27T00:00:00.000Z',
    });
    expect(report.records).toHaveLength(20);
    expect(report.summary.schemaSuccess).toEqual({
      numerator: 20,
      denominator: 20,
      rate: 1,
    });
    expect(
      report.records.find(
        ({ caseId, arm }) =>
          caseId === 'conflicting-light' && arm === 'compiler',
      )?.metrics.conflictCount,
    ).toBeGreaterThan(0);
    expect(
      report.records.find(
        ({ caseId, arm }) =>
          caseId === 'conflicting-light' && arm === 'baseline',
      )?.metrics.conflictCount,
    ).toBeGreaterThan(0);
    expect(
      report.records.find(({ arm }) => arm === 'baseline')?.metrics
        .directionsDistinct,
    ).toBe(false);
    expect(
      report.records.find(({ arm }) => arm === 'compiler')?.metrics
        .directionsDistinct,
    ).toBe(true);
    expect(report.summary.fullPromptLength.count).toBe(40);
    expect(report.summary.compactPromptLength.count).toBe(40);
  });

  it('does not count a forbidden item used only in negative clauses as leakage', async () => {
    const source =
      '{"id":"privacy-case","category":"poster","brief":"SENSITIVE_BRIEF","mandatoryText":["SECRET_COPY"],"forbiddenElements":["人物"]}';
    const report = await executeEvaluation({
      mode: 'mock',
      source,
      runId: 'privacy-run',
      now: '2026-07-27T00:00:00.000Z',
    });
    for (const record of report.records) {
      expect(record.metrics.forbiddenLeakage.numerator).toBe(0);
    }
    const caseRecord = parseBenchmarkJsonl(source)[0];
    if (!caseRecord) throw new Error('missing fixture');
    const response = await import('@vpc/compiler-core').then(
      async ({ compileBrief, createDeterministicFakePlanner }) =>
        compileBrief(caseRecord.request, {
          planner: createDeterministicFakePlanner(),
          requestId: () => '00000000-0000-4000-8000-000000000000',
        }),
    );
    response.directions[0]!.fullPrompt = '画面中央有清晰人物。';
    expect(
      evaluateMetrics(caseRecord.request, response).forbiddenLeakage.numerator,
    ).toBe(1);
  });

  it('treats a positive mention after a comma as leakage', async () => {
    const testCase = parseBenchmarkJsonl(
      '{"id":"comma","category":"poster","brief":"brief","forbiddenElements":["人物"]}',
    )[0]!;
    const response = await import('@vpc/compiler-core').then(
      async ({ compileBrief, createDeterministicFakePlanner }) =>
        compileBrief(testCase.request, {
          planner: createDeterministicFakePlanner(),
          requestId: () => '00000000-0000-4000-8000-000000000000',
        }),
    );
    response.directions[0]!.fullPrompt = '禁止背景模糊，人物位于中央。';
    expect(
      evaluateMetrics(testCase.request, response).forbiddenLeakage.numerator,
    ).toBe(1);
  });

  it('does not accept identical prompts with different self-reported axes', async () => {
    const testCase = parseBenchmarkJsonl(
      '{"id":"same","category":"poster","brief":"brief"}',
    )[0]!;
    const response = await import('@vpc/compiler-core').then(
      async ({ compileBrief, createDeterministicFakePlanner }) =>
        compileBrief(testCase.request, {
          planner: createDeterministicFakePlanner(),
          requestId: () => '00000000-0000-4000-8000-000000000000',
        }),
    );
    response.directions.forEach((direction, index) => {
      direction.differenceAxes = [['foo', 'bar', 'baz'][index]!];
      direction.fullPrompt = 'same';
      direction.compactPrompt = 'same';
    });
    expect(evaluateMetrics(testCase.request, response).directionsDistinct).toBe(
      false,
    );
  });
});

describe('reports and execution boundary', () => {
  it('is deterministic and never serializes briefs, required copy, or prompts', async () => {
    const source =
      '{"id":"private","category":"poster","brief":"SENSITIVE_BRIEF","mandatoryText":["SECRET_COPY"],"forbiddenElements":["NO_PERSON"]}';
    const options = {
      mode: 'mock' as const,
      source,
      runId: 'fixed-run',
      now: '2026-07-27T00:00:00.000Z',
    };
    const first = await executeEvaluation(options);
    const second = await executeEvaluation(options);
    expect(serializeReportJson(first)).toBe(serializeReportJson(second));
    for (const output of [serializeReportJson(first), renderMarkdown(first)]) {
      expect(output).not.toContain('SENSITIVE_BRIEF');
      expect(output).not.toContain('SECRET_COPY');
      expect(output).not.toContain('NO_PERSON');
    }
  });

  it('fails real mode before reading input or writing artifacts', async () => {
    const readSource = vi.fn<() => Promise<string>>();
    const writeArtifacts = vi.fn<(report: EvalReport) => Promise<void>>();
    await expect(
      executeEvaluation({
        mode: 'real',
        source: undefined,
        runId: 'real-run',
        now: '2026-07-27T00:00:00.000Z',
        env: {},
        readSource,
        writeArtifacts,
      }),
    ).rejects.toEqual(
      expect.objectContaining({ code: 'EVAL_REAL_CREDENTIALS_MISSING' }),
    );
    expect(readSource).not.toHaveBeenCalled();
    expect(writeArtifacts).not.toHaveBeenCalled();
  });

  it('runs configured real baseline and compiler factories without network access', async () => {
    const baselineExpand = vi.fn(async (input: { brief: string }) => ({
      fullPrompt: `${input.brief}；必须逐字包含：COPY；禁止出现：人物`,
      compactPrompt: `${input.brief}；必须逐字包含：COPY；禁止出现：人物`,
    }));
    const baselineFactory = vi.fn(() => ({
      model: 'injected-real-model',
      usage: () => ({ latencyMs: 0 }),
      expand: baselineExpand,
    }));
    const plannerFactory = vi.fn(() => createDeterministicFakePlanner());
    const report = await executeEvaluation({
      mode: 'real',
      source:
        '{"id":"real-case","category":"poster","brief":"brief","mandatoryText":["COPY"],"forbiddenElements":["人物"]}',
      runId: 'real-injected',
      now: '2026-07-27T00:00:00.000Z',
      env: {
        OPENAI_API_KEY: 'test-only',
        OPENAI_TEXT_MODEL: 'injected-real-model',
      },
      realFactories: {
        baseline: baselineFactory,
        planner: plannerFactory,
      },
    });
    expect(baselineFactory).toHaveBeenCalledOnce();
    expect(baselineExpand).toHaveBeenCalledOnce();
    expect(plannerFactory).toHaveBeenCalledOnce();
    expect(report.records.map(({ arm, status }) => [arm, status])).toEqual([
      ['baseline', 'success'],
      ['compiler', 'success'],
    ]);
  });

  it('counts failed arms in coverage and constraint denominators', async () => {
    const fail = (): never => {
      throw Object.assign(new Error('private upstream detail'), {
        code: 'UPSTREAM_ERROR',
      });
    };
    const report = await executeEvaluation({
      mode: 'real',
      source:
        '{"id":"failed","category":"poster","brief":"brief","mandatoryText":["COPY"],"forbiddenElements":["人物"]}',
      runId: 'failed-run',
      now: '2026-07-27T00:00:00.000Z',
      env: {
        OPENAI_API_KEY: 'test-only',
        OPENAI_TEXT_MODEL: 'injected-real-model',
      },
      realFactories: {
        baseline: () => ({
          model: 'injected-real-model',
          usage: () => ({ latencyMs: 0 }),
          expand: async () => fail(),
        }),
        planner: () => ({
          model: 'injected-real-model',
          buildVisualSpec: async () => fail(),
          planDirections: async () => fail(),
          reviseSpec: async () => fail(),
          repair: async () => fail(),
        }),
      },
    });
    expect(report.summary.successCoverage).toEqual({
      numerator: 0,
      denominator: 2,
      rate: 0,
    });
    expect(
      report.summary.byArm.baseline.mandatoryTextPreservation.denominator,
    ).toBe(2);
    expect(
      report.summary.byArm.compiler.mandatoryTextPreservation.denominator,
    ).toBe(6);
    expect(report.summary.byArm.baseline.forbiddenLeakage.denominator).toBe(2);
    expect(report.summary.byArm.compiler.forbiddenLeakage.denominator).toBe(6);
    expect(() => assertRunSucceeded(report)).toThrowError(
      expect.objectContaining({ code: 'EVAL_RUN_FAILED' }),
    );
    const write = vi.fn(async () => ({
      jsonPath: 'report.json',
      markdownPath: 'report.md',
    }));
    const onWritten = vi.fn();
    await expect(
      finalizeEvaluationRun(report, 'unused', write, onWritten),
    ).rejects.toEqual(expect.objectContaining({ code: 'EVAL_RUN_FAILED' }));
    expect(write).toHaveBeenCalledOnce();
    expect(onWritten).toHaveBeenCalledWith({
      jsonPath: 'report.json',
      markdownPath: 'report.md',
    });
    expect(serializeReportJson(report)).not.toContain(
      'private upstream detail',
    );
  });

  it('preflights real credentials before the root command builds', async () => {
    const packageJson = JSON.parse(
      await readFile(resolve('../../package.json'), 'utf8'),
    ) as { scripts: { 'eval:real': string } };
    expect(packageJson.scripts['eval:real']).toMatch(
      /^node scripts\/eval-real-preflight\.mjs && pnpm build/u,
    );
    const result = spawnSync(
      process.execPath,
      [resolve('../../scripts/eval-real-preflight.mjs')],
      {
        encoding: 'utf8',
        env: {},
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr.trim()).toBe('EVAL_REAL_CREDENTIALS_MISSING');
  });
});

describe('version approval', () => {
  const approved = {
    promptVersion: 'prompt-2',
    promptFingerprint: 'sha256:prompt-old',
    schemaVersion: '1.1.0',
    schemaFingerprint: 'sha256:schema-old',
    evaluationVersion: EVALUATION_VERSION,
    evaluationFingerprint: 'sha256:evaluation-old',
  };

  it('detects all three kinds of drift', async () => {
    await expect(
      checkApprovedVersions({
        read: async () => JSON.stringify(approved),
        fingerprints: async () => ({
          promptFingerprint: 'sha256:prompt-new',
          schemaFingerprint: 'sha256:schema-new',
          evaluationFingerprint: 'sha256:evaluation-new',
        }),
      }),
    ).rejects.toEqual(expect.objectContaining({ code: 'EVAL_VERSION_DRIFT' }));
  });

  it.each([
    ['promptVersion', 'promptFingerprint'],
    ['schemaVersion', 'schemaFingerprint'],
    ['evaluationVersion', 'evaluationFingerprint'],
  ] as const)(
    'rejects approval when %s did not advance',
    async (versionKey, fingerprintKey) => {
      await expect(
        approveVersions({
          read: async () => JSON.stringify(approved),
          fingerprints: async () => ({
            promptFingerprint: 'sha256:prompt-old',
            schemaFingerprint: 'sha256:schema-old',
            evaluationFingerprint: 'sha256:evaluation-old',
            [fingerprintKey]: `sha256:${versionKey}-new`,
          }),
          versions: {
            promptVersion: approved.promptVersion,
            schemaVersion: approved.schemaVersion,
            evaluationVersion: approved.evaluationVersion,
          },
          write: vi.fn(),
        }),
      ).rejects.toEqual(
        expect.objectContaining({ code: 'EVAL_VERSION_NOT_BUMPED' }),
      );
    },
  );

  it('writes approval after the matching version advances', async () => {
    let approvedContent = '';
    const write = vi.fn(async (content: string) => {
      approvedContent = content;
    });
    await approveVersions({
      read: async () => JSON.stringify(approved),
      write,
      fingerprints: async () => ({
        promptFingerprint: 'sha256:prompt-new',
        schemaFingerprint: 'sha256:schema-old',
        evaluationFingerprint: 'sha256:evaluation-old',
      }),
      versions: {
        promptVersion: 'prompt-3',
        schemaVersion: approved.schemaVersion,
        evaluationVersion: approved.evaluationVersion,
      },
    });
    expect(write).toHaveBeenCalledOnce();
    expect(approvedContent).toContain('"promptVersion": "prompt-3"');
    expect(approvedContent).toContain(
      '"promptFingerprint": "sha256:prompt-new"',
    );
  });
});

it('uses EvalError as the stable public error type', () => {
  expect(new EvalError('EVAL_INVALID_JSONL', 'bad')).toMatchObject({
    name: 'EvalError',
    code: 'EVAL_INVALID_JSONL',
  });
});
