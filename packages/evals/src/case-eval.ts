import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import {
  checkPatternSimilarity,
  compileBrief,
  createDeterministicFakePlanner,
  importCasePatterns,
  PROMPT_VERSION,
  retrieveCasePatterns,
  type Planner,
  type RetrievalStrength,
  type SimilarityFinding,
} from '@vpc/compiler-core';
import {
  SCHEMA_VERSION,
  type CasePattern,
  type CompileResponse,
} from '@vpc/contracts';

import {
  evaluateMetrics,
  parseBenchmarkJsonl,
  type CaseMetrics,
  type RatioMetric,
} from './index.js';
import { EVALUATION_VERSION } from './versions.js';

export type CaseEvalArm = 'compiler-no-retrieval' | 'compiler-retrieval';

export type CaseEvalRecord = {
  caseId: string;
  arm: CaseEvalArm;
  status: 'success';
  metrics: CaseMetrics;
  retrievedIds: string[];
  similarity: DirectionSimilarity[];
};

export type DirectionSimilarity = SimilarityFinding & {
  mode: CompileResponse['directions'][number]['mode'];
};

type ArmSummary = {
  recordCount: number;
  schemaSuccess: RatioMetric;
  mandatoryTextPreservation: RatioMetric;
  forbiddenLeakage: RatioMetric;
  conflictCount: number;
  distinctDirections: RatioMetric;
};

export type CaseEvalReport = {
  run: {
    runId: string;
    timestamp: string;
    inputCaseCount: number;
    armCount: 2;
    casePatternCount: number;
    schemaVersion: string;
    promptVersion: string;
    evaluationVersion: string;
    model: 'deterministic-fake-planner';
  };
  records: CaseEvalRecord[];
  summary: {
    retrievalCoverage: RatioMetric;
    flaggedDirections: RatioMetric;
    byArm: Record<CaseEvalArm, ArmSummary>;
  };
  recommendation: {
    value: 'keep_optional' | 'remove';
    reason: string;
    automaticChange: false;
  };
};

const ratio = (numerator: number, denominator: number): RatioMetric => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

const summarize = (records: CaseEvalRecord[]) => ({
  recordCount: records.length,
  schemaSuccess: ratio(
    records.filter(({ metrics }) => metrics.schemaSuccess).length,
    records.length,
  ),
  mandatoryTextPreservation: ratio(
    records.reduce(
      (sum, { metrics }) => sum + metrics.mandatoryTextPreservation.numerator,
      0,
    ),
    records.reduce(
      (sum, { metrics }) => sum + metrics.mandatoryTextPreservation.denominator,
      0,
    ),
  ),
  forbiddenLeakage: ratio(
    records.reduce(
      (sum, { metrics }) => sum + metrics.forbiddenLeakage.numerator,
      0,
    ),
    records.reduce(
      (sum, { metrics }) => sum + metrics.forbiddenLeakage.denominator,
      0,
    ),
  ),
  conflictCount: records.reduce(
    (sum, { metrics }) => sum + metrics.conflictCount,
    0,
  ),
  distinctDirections: ratio(
    records.filter(({ metrics }) => metrics.directionsDistinct).length,
    records.length,
  ),
});

export const createCaseAwarePlanner = (): Planner => {
  const base = createDeterministicFakePlanner();
  return {
    ...base,
    planDirections: async (spec, context) => {
      const directions = await base.planDirections(spec, context);
      const summaries =
        context?.casePatterns?.map(({ patternSummary }) => patternSummary) ??
        [];
      if (summaries.length === 0) return directions;
      const instruction = `案例模式启发：${summaries.join('；')}`;
      return directions.map((direction) => ({
        ...direction,
        concept: `${direction.concept}；${instruction}`,
        instructions: [...direction.instructions, instruction],
      }));
    },
  };
};

export const evaluateDirectionSimilarities = (
  response: CompileResponse,
  patterns: ReturnType<typeof retrieveCasePatterns>,
): DirectionSimilarity[] =>
  response.directions.map(({ mode, fullPrompt, compactPrompt }) => {
    const best = [fullPrompt, compactPrompt]
      .map((prompt) => checkPatternSimilarity(prompt, patterns))
      .sort(
        (left, right) =>
          right.max - left.max ||
          ((left.sourceId ?? '') < (right.sourceId ?? '')
            ? -1
            : (left.sourceId ?? '') > (right.sourceId ?? '')
              ? 1
              : 0),
      )[0] ?? { max: 0, sourceId: null, flagged: false };
    return { mode, ...best };
  });

const rate = (metric: RatioMetric): number =>
  metric.rate ?? (metric.denominator === 0 ? 1 : 0);

export const recommendCaseRetrieval = (
  inputCaseCount: number,
  without: ArmSummary,
  withRetrieval: ArmSummary,
  coverage: RatioMetric,
  flaggedDirections: RatioMetric,
): CaseEvalReport['recommendation'] => {
  const regressed =
    rate(withRetrieval.schemaSuccess) < rate(without.schemaSuccess) ||
    rate(withRetrieval.mandatoryTextPreservation) <
      rate(without.mandatoryTextPreservation) ||
    rate(withRetrieval.forbiddenLeakage) > rate(without.forbiddenLeakage) ||
    withRetrieval.conflictCount > without.conflictCount ||
    rate(withRetrieval.distinctDirections) < rate(without.distinctDirections);
  const similarityRisk = flaggedDirections.numerator > 0;
  const value = regressed || similarityRisk ? 'remove' : 'keep_optional';
  const noun = inputCaseCount === 1 ? 'case' : 'cases';
  return {
    value,
    reason: `${inputCaseCount} benchmark ${noun}; retrieval coverage ${coverage.numerator}/${coverage.denominator}; similarity flags ${flaggedDirections.numerator}/${flaggedDirections.denominator}; no human preference data. ${
      regressed
        ? 'Hard metrics regressed.'
        : similarityRisk
          ? 'Similarity risk was flagged.'
          : 'No hard-metric regression or similarity flag was observed, but evidence is insufficient for default enablement.'
    }`,
    automaticChange: false,
  };
};

export const parseCasePatternJsonl = (source: string): CasePattern[] => {
  const values = source
    .split(/\r?\n/u)
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as unknown);
  const report = importCasePatterns(values);
  if (report.rejected.length > 0 || report.cases.length === 0)
    throw new Error('CASE_FIXTURE_INVALID');
  return report.cases;
};

export const executeCaseEvaluation = async (options: {
  benchmarkSource: string;
  caseSource: string;
  runId: string;
  now: string;
  strength?: RetrievalStrength;
}): Promise<CaseEvalReport> => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(options.runId))
    throw new Error('EVAL_INVALID_RUN_ID');
  const benchmarks = parseBenchmarkJsonl(options.benchmarkSource);
  const patterns = parseCasePatternJsonl(options.caseSource);
  const records: CaseEvalRecord[] = [];
  const planner = createCaseAwarePlanner();

  for (const [index, benchmark] of benchmarks.entries()) {
    for (const arm of [
      'compiler-no-retrieval',
      'compiler-retrieval',
    ] as const) {
      const enabled = arm === 'compiler-retrieval';
      const retrieved = retrieveCasePatterns(benchmark.request, patterns, {
        enabled,
        strength: options.strength ?? 'medium',
      });
      const response = await compileBrief(benchmark.request, {
        planner,
        requestId: () =>
          `00000000-0000-4000-8001-${(index * 2 + (enabled ? 2 : 1))
            .toString(16)
            .padStart(12, '0')}`,
        retrieval: {
          cases: patterns,
          config: {
            enabled,
            strength: options.strength ?? 'medium',
          },
        },
      });
      records.push({
        caseId: benchmark.id,
        arm,
        status: 'success',
        metrics: evaluateMetrics(benchmark.request, response),
        retrievedIds: retrieved.map(({ id }) => id),
        similarity: evaluateDirectionSimilarities(response, retrieved),
      });
    }
  }

  const without = records.filter(({ arm }) => arm === 'compiler-no-retrieval');
  const withRetrieval = records.filter(
    ({ arm }) => arm === 'compiler-retrieval',
  );
  const retrievalCoverage = ratio(
    withRetrieval.filter(({ retrievedIds }) => retrievedIds.length > 0).length,
    withRetrieval.length,
  );
  const flaggedDirections = ratio(
    withRetrieval.reduce(
      (sum, { similarity }) =>
        sum + similarity.filter(({ flagged }) => flagged).length,
      0,
    ),
    withRetrieval.reduce((sum, { similarity }) => sum + similarity.length, 0),
  );
  const byArm = {
    'compiler-no-retrieval': summarize(without),
    'compiler-retrieval': summarize(withRetrieval),
  };
  return {
    run: {
      runId: options.runId,
      timestamp: options.now,
      inputCaseCount: benchmarks.length,
      armCount: 2,
      casePatternCount: patterns.length,
      schemaVersion: SCHEMA_VERSION,
      promptVersion: PROMPT_VERSION,
      evaluationVersion: EVALUATION_VERSION,
      model: 'deterministic-fake-planner',
    },
    records,
    summary: {
      retrievalCoverage,
      flaggedDirections,
      byArm,
    },
    recommendation: recommendCaseRetrieval(
      benchmarks.length,
      byArm['compiler-no-retrieval'],
      byArm['compiler-retrieval'],
      retrievalCoverage,
      flaggedDirections,
    ),
  };
};

export const serializeCaseEvalJson = (report: CaseEvalReport): string =>
  `${JSON.stringify(report, null, 2)}\n`;

const formatRatio = (value: RatioMetric): string =>
  `${value.numerator}/${value.denominator} (${value.rate === null ? 'n/a' : value.rate.toFixed(3)})`;

export const renderCaseEvalMarkdown = (report: CaseEvalReport): string => {
  const rows = (['compiler-no-retrieval', 'compiler-retrieval'] as const).map(
    (arm) => {
      const item = report.summary.byArm[arm];
      return `| ${arm} | ${item.recordCount} | ${formatRatio(item.schemaSuccess)} | ${formatRatio(item.mandatoryTextPreservation)} | ${formatRatio(item.forbiddenLeakage)} | ${item.conflictCount} | ${formatRatio(item.distinctDirections)} |`;
    },
  );
  return [
    `# Case retrieval evaluation ${report.run.runId}`,
    '',
    `- Timestamp: ${report.run.timestamp}`,
    `- Cases: ${report.run.inputCaseCount}`,
    `- Synthetic patterns: ${report.run.casePatternCount}`,
    `- Retrieval coverage: ${formatRatio(report.summary.retrievalCoverage)}`,
    `- Flagged directions: ${formatRatio(report.summary.flaggedDirections)}`,
    '',
    '| Arm | Records | Schema | Mandatory text | Forbidden leakage | Conflicts | Distinct directions |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `- Recommendation: ${report.recommendation.value}`,
    `- Reason: ${report.recommendation.reason}`,
    '- This recommendation does not change the default switch.',
    '',
    '> Mock metrics do not measure visual quality or human preference.',
    '',
  ].join('\n');
};

export const writeCaseEvalArtifacts = async (
  report: CaseEvalReport,
  outDir: string,
): Promise<{ jsonPath: string; markdownPath: string }> => {
  const jsonPath = join(outDir, `${report.run.runId}.json`);
  const markdownPath = join(outDir, `${report.run.runId}.md`);
  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(jsonPath, serializeCaseEvalJson(report), 'utf8');
  await writeFile(markdownPath, renderCaseEvalMarkdown(report), 'utf8');
  return { jsonPath, markdownPath };
};

export const runCaseEvaluationFromFiles = async (options: {
  benchmarkPath: string;
  casePath: string;
  outDir: string;
  runId: string;
  now: string;
}): Promise<{
  report: CaseEvalReport;
  jsonPath: string;
  markdownPath: string;
}> => {
  const report = await executeCaseEvaluation({
    benchmarkSource: await readFile(options.benchmarkPath, 'utf8'),
    caseSource: await readFile(options.casePath, 'utf8'),
    runId: options.runId,
    now: options.now,
  });
  return {
    report,
    ...(await writeCaseEvalArtifacts(report, options.outDir)),
  };
};
