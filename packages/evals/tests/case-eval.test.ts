import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';
import {
  compileBrief,
  createDeterministicFakePlanner,
} from '@vpc/compiler-core';

import {
  createCaseAwarePlanner,
  evaluateDirectionSimilarities,
  executeCaseEvaluation,
  parseCasePatternJsonl,
  renderCaseEvalMarkdown,
  serializeCaseEvalJson,
} from '../src/case-eval.js';

const benchmarkPath = resolve('../../fixtures/benchmark-cases.jsonl');
const casePath = resolve('../../fixtures/case-patterns.jsonl');

describe('M6 case A/B evaluation', () => {
  it('validates four approved synthetic fixtures and their hashes', async () => {
    const patterns = parseCasePatternJsonl(await readFile(casePath, 'utf8'));
    expect(patterns).toHaveLength(4);
    expect(
      patterns.every(
        ({ rightsStatus, license }) =>
          rightsStatus === 'approved' && license === 'CC0-1.0',
      ),
    ).toBe(true);
  });

  it('produces deterministic private 10x2 reports and reports copied summaries', async () => {
    const benchmarkSource = await readFile(benchmarkPath, 'utf8');
    const caseSource = await readFile(casePath, 'utf8');
    const options = {
      benchmarkSource,
      caseSource,
      runId: 'fixed-cases',
      now: '2026-07-28T00:00:00.000Z',
    };
    const first = await executeCaseEvaluation(options);
    const second = await executeCaseEvaluation(options);

    expect(first.records).toHaveLength(20);
    expect(serializeCaseEvalJson(first)).toBe(serializeCaseEvalJson(second));
    expect(first.recommendation).toEqual(
      expect.objectContaining({
        value: 'remove',
        automaticChange: false,
      }),
    );
    expect(first.summary.byArm['compiler-no-retrieval']).toEqual(
      first.summary.byArm['compiler-retrieval'],
    );
    expect(
      first.records
        .filter(({ arm }) => arm === 'compiler-no-retrieval')
        .every(({ retrievedIds }) => retrievedIds.length === 0),
    ).toBe(true);
    expect(first.summary.retrievalCoverage.denominator).toBe(10);
    expect(first.summary.flaggedDirections.numerator).toBe(18);
    expect(first.summary.flaggedDirections.denominator).toBe(30);
    expect(
      first.records
        .filter(({ arm }) => arm === 'compiler-retrieval')
        .every(({ similarity }) => similarity.length === 3),
    ).toBe(true);

    for (const output of [
      serializeCaseEvalJson(first),
      renderCaseEvalMarkdown(first),
    ]) {
      for (const benchmark of benchmarkSource
        .trim()
        .split(/\r?\n/u)
        .map((line) => JSON.parse(line) as Record<string, unknown>)) {
        expect(output).not.toContain(String(benchmark.brief));
        for (const key of [
          'mandatoryText',
          'mandatoryElements',
          'forbiddenElements',
        ]) {
          for (const value of (benchmark[key] as string[] | undefined) ?? [])
            expect(output).not.toContain(value);
        }
      }
      for (const pattern of parseCasePatternJsonl(caseSource))
        expect(output).not.toContain(pattern.patternSummary);
      expect(output).not.toContain('"fullPrompt"');
      expect(output).not.toContain('"compactPrompt"');
    }
  });

  it('uses one case-aware planner for both arms and changes prompts only when summaries exist', async () => {
    const benchmarkSource = await readFile(benchmarkPath, 'utf8');
    const caseSource = await readFile(casePath, 'utf8');
    const benchmark = JSON.parse(benchmarkSource.split(/\r?\n/u)[0]!) as Record<
      string,
      unknown
    >;
    const request = {
      brief: String(benchmark.brief),
      taskType: benchmark.category as 'poster',
      aspectRatio: String(benchmark.aspectRatio),
      mandatoryText: (benchmark.mandatoryText as string[]) ?? [],
      mandatoryElements: (benchmark.mandatoryElements as string[]) ?? [],
      forbiddenElements: (benchmark.forbiddenElements as string[]) ?? [],
      creativity: 50,
      allowAssumptions: true,
      outputLanguage: 'zh-CN',
    };
    const patterns = parseCasePatternJsonl(caseSource);
    const plain = await compileBrief(request, {
      planner: createDeterministicFakePlanner(),
      requestId: () => '123e4567-e89b-12d3-a456-426614174000',
    });
    const disabled = await compileBrief(request, {
      planner: createCaseAwarePlanner(),
      requestId: () => '123e4567-e89b-12d3-a456-426614174000',
      retrieval: {
        cases: patterns,
        config: { enabled: false, strength: 'medium' },
      },
    });
    const enabled = await compileBrief(request, {
      planner: createCaseAwarePlanner(),
      requestId: () => '123e4567-e89b-12d3-a456-426614174000',
      retrieval: {
        cases: patterns,
        config: { enabled: true, strength: 'medium' },
      },
    });

    expect(JSON.stringify(disabled)).toBe(JSON.stringify(plain));
    expect(enabled.directions.map(({ fullPrompt }) => fullPrompt)).not.toEqual(
      disabled.directions.map(({ fullPrompt }) => fullPrompt),
    );
    expect(
      enabled.directions.map(({ compactPrompt }) => compactPrompt),
    ).not.toEqual(
      disabled.directions.map(({ compactPrompt }) => compactPrompt),
    );
  });

  it('reports similarity per direction across full and compact prompts', async () => {
    const benchmarkSource = await readFile(benchmarkPath, 'utf8');
    const caseSource = await readFile(casePath, 'utf8');
    const report = await executeCaseEvaluation({
      benchmarkSource,
      caseSource,
      runId: 'direction-similarity',
      now: '2026-07-28T00:00:00.000Z',
    });
    const retrieval = report.records.find(
      ({ arm, retrievedIds }) =>
        arm === 'compiler-retrieval' && retrievedIds.length > 0,
    );
    expect(retrieval?.similarity.map(({ mode }) => mode)).toEqual([
      'faithful',
      'creative',
      'experimental',
    ]);
    expect(
      report.records
        .filter(({ arm }) => arm === 'compiler-no-retrieval')
        .every(({ similarity }) =>
          similarity.every(
            ({ max, sourceId, flagged }) =>
              max === 0 && sourceId === null && flagged === false,
          ),
        ),
    ).toBe(true);

    const response = await compileBrief(
      {
        brief: '测试海报',
        taskType: 'poster',
        aspectRatio: '1:1',
        mandatoryText: [],
        mandatoryElements: [],
        forbiddenElements: [],
        creativity: 50,
        allowAssumptions: true,
        outputLanguage: 'zh-CN',
      },
      {
        planner: createDeterministicFakePlanner(),
        requestId: () => '123e4567-e89b-12d3-a456-426614174000',
      },
    );
    const patternSummary = '完全相同的案例模式摘要';
    response.directions[1]!.compactPrompt = patternSummary;
    const findings = evaluateDirectionSimilarities(response, [
      {
        id: 'source',
        license: 'CC0-1.0',
        patternSummary,
        score: 1,
      },
    ]);
    expect(findings).toEqual([
      expect.objectContaining({ mode: 'faithful', flagged: false }),
      {
        mode: 'creative',
        max: 1,
        sourceId: 'source',
        flagged: true,
      },
      expect.objectContaining({ mode: 'experimental', flagged: false }),
    ]);
  });

  it('uses actual sample count and recommends removal on regression or similarity flags', async () => {
    const caseSource = await readFile(casePath, 'utf8');
    const oneCase = (await readFile(benchmarkPath, 'utf8')).split(/\r?\n/u)[0]!;
    const current = await executeCaseEvaluation({
      benchmarkSource: oneCase,
      caseSource,
      runId: 'one-case',
      now: '2026-07-28T00:00:00.000Z',
    });
    expect(current.recommendation.value).toBe('remove');
    expect(current.recommendation.reason).toContain('1 benchmark case');

    const harmful = structuredClone(current);
    harmful.summary.byArm['compiler-retrieval'].mandatoryTextPreservation = {
      numerator: 0,
      denominator: 1,
      rate: 0,
    };
    const { recommendCaseRetrieval } = await import('../src/case-eval.js');
    expect(
      recommendCaseRetrieval(
        harmful.run.inputCaseCount,
        harmful.summary.byArm['compiler-no-retrieval'],
        harmful.summary.byArm['compiler-retrieval'],
        harmful.summary.retrievalCoverage,
        harmful.summary.flaggedDirections,
      ).value,
    ).toBe('remove');
    expect(
      recommendCaseRetrieval(
        current.run.inputCaseCount,
        current.summary.byArm['compiler-no-retrieval'],
        current.summary.byArm['compiler-retrieval'],
        current.summary.retrievalCoverage,
        { numerator: 0, denominator: 3, rate: 0 },
      ).value,
    ).toBe('keep_optional');
  });
});
