import { describe, expect, it } from 'vitest';
import type { CasePattern, CompileRequest } from '@vpc/contracts';

import {
  checkPatternSimilarity,
  compileBrief,
  computeCaseContentHash,
  createDeterministicFakePlanner,
  importCasePatterns,
  retrieveCasePatterns,
  type Planner,
} from '../src/index.js';

const content = (
  id: string,
  taskType: CasePattern['taskType'] = 'poster',
): Omit<CasePattern, 'contentHash' | 'importedAt'> => ({
  id,
  taskType,
  designGoal: '建立清晰的中文海报阅读层级',
  visualStructure: ['标题区', '主体区', '辅助信息区'],
  designPatterns: ['单一主焦点', '三级网格'],
  successFactors: ['阅读顺序明确'],
  failureRisks: ['模块权重接近'],
  applicability: ['中文活动海报'],
  patternSummary: '使用单一主焦点和三级网格组织中文活动海报。',
  sourceName: 'Visual Prompt Compiler synthetic fixture',
  sourceUrl:
    'https://github.com/zyhp0402/visual-prompt-compiler/tree/main/fixtures',
  license: 'CC0-1.0',
  attribution: 'Visual Prompt Compiler contributors',
  rightsStatus: 'approved',
});

const pattern = (
  id: string,
  taskType: CasePattern['taskType'] = 'poster',
): CasePattern => {
  const value = content(id, taskType);
  return {
    ...value,
    contentHash: computeCaseContentHash(value),
    importedAt: '2026-07-28T00:00:00.000Z',
  };
};

const request: CompileRequest = {
  brief: '制作中文活动海报，标题清晰',
  taskType: 'poster',
  aspectRatio: '3:4',
  mandatoryText: [],
  mandatoryElements: ['标题'],
  forbiddenElements: [],
  creativity: 50,
  allowAssumptions: true,
  outputLanguage: 'zh-CN',
};

describe('case import boundary', () => {
  it('hashes canonical content without importedAt and rejects rights, licenses, hashes, and duplicates', () => {
    const first = pattern('first');
    const pendingContent = {
      ...content('pending'),
      rightsStatus: 'pending' as const,
    };
    const pending = {
      ...pendingContent,
      contentHash: computeCaseContentHash(pendingContent),
      importedAt: '2026-07-28T00:00:00.000Z',
    };
    const noAssertionContent = {
      ...content('unclear'),
      license: 'NOASSERTION',
    };
    const unclear = {
      ...noAssertionContent,
      contentHash: computeCaseContentHash(noAssertionContent),
      importedAt: '2026-07-28T00:00:00.000Z',
    };
    const duplicate = { ...first, id: 'duplicate' };
    const sourceTamper = {
      ...first,
      id: 'source-tamper',
      sourceName: 'changed source',
    };
    const licenseTamper = {
      ...first,
      id: 'license-tamper',
      license: 'CC-BY-4.0',
    };
    const attributionTamper = {
      ...first,
      id: 'attribution-tamper',
      attribution: 'changed attribution',
    };
    const rightsTamper = {
      ...pending,
      id: 'rights-tamper',
      rightsStatus: 'approved' as const,
    };
    const conflictContent = { ...content('first'), designGoal: '不同内容' };
    const conflict = {
      ...conflictContent,
      contentHash: computeCaseContentHash(conflictContent),
      importedAt: '2026-07-28T00:00:00.000Z',
    };
    const report = importCasePatterns([
      first,
      pending,
      unclear,
      { ...pattern('bad-hash'), contentHash: `sha256:${'0'.repeat(64)}` },
      sourceTamper,
      licenseTamper,
      attributionTamper,
      rightsTamper,
      duplicate,
      conflict,
    ]);

    expect(report.cases).toEqual([first]);
    expect(report.rejected.map(({ code }) => code)).toEqual([
      'CASE_RIGHTS_NOT_APPROVED',
      'CASE_LICENSE_NOT_ALLOWED',
      'CASE_HASH_MISMATCH',
      'CASE_HASH_MISMATCH',
      'CASE_HASH_MISMATCH',
      'CASE_HASH_MISMATCH',
      'CASE_HASH_MISMATCH',
      'CASE_DUPLICATE_CONTENT',
      'CASE_ID_CONFLICT',
    ]);
    expect(
      computeCaseContentHash({ ...content('first'), sourceName: 'changed' }),
    ).not.toBe(first.contentHash);
  });

  it('normalizes Unicode canonically and deduplicates identical content across ids', () => {
    const decomposed = { ...content('decomposed'), designGoal: 'Cafe\u0301' };
    const composed = { ...content('composed'), designGoal: 'Café' };
    expect(computeCaseContentHash(decomposed)).toBe(
      computeCaseContentHash(composed),
    );

    const first = {
      ...decomposed,
      contentHash: computeCaseContentHash(decomposed),
      importedAt: '2026-07-28T00:00:00.000Z',
    };
    const second = {
      ...composed,
      contentHash: computeCaseContentHash(composed),
      importedAt: '2026-07-29T00:00:00.000Z',
    };
    expect(importCasePatterns([first, second]).rejected).toEqual([
      {
        index: 1,
        id: 'composed',
        code: 'CASE_DUPLICATE_CONTENT',
      },
    ]);
  });
});

describe('local retrieval', () => {
  it('returns nothing when disabled and uses deterministic strength limits and id ties', () => {
    const cases = [pattern('b'), pattern('a'), pattern('c')];
    expect(
      retrieveCasePatterns(request, cases, {
        enabled: false,
        strength: 'high',
      }),
    ).toEqual([]);
    expect(
      retrieveCasePatterns(request, cases, {
        enabled: true,
        strength: 'low',
      }).map(({ id }) => id),
    ).toEqual(['a']);
    expect(
      retrieveCasePatterns(request, cases, {
        enabled: true,
        strength: 'high',
      }).map(({ id }) => id),
    ).toEqual(['a', 'b', 'c']);
  });

  it('never retrieves pending, rejected, unclear-license, or tampered cases', () => {
    const approved = pattern('approved');
    expect(
      retrieveCasePatterns(
        request,
        [
          approved,
          { ...pattern('pending'), rightsStatus: 'pending' },
          { ...pattern('rejected'), rightsStatus: 'rejected' },
          { ...pattern('unclear'), license: 'NOASSERTION' },
          { ...pattern('tampered'), patternSummary: 'modified' },
        ],
        { enabled: true, strength: 'high' },
      ).map(({ id }) => id),
    ).toEqual(['approved']);
  });

  it('passes only id, license, and patternSummary to planner context and preserves disabled output byte-for-byte', async () => {
    const base = createDeterministicFakePlanner();
    let received: Parameters<Planner['planDirections']>[1];
    const planner: Planner = {
      ...base,
      planDirections: async (spec, context) => {
        received = context;
        return base.planDirections(spec, context);
      },
    };
    const without = await compileBrief(request, {
      planner: createDeterministicFakePlanner(),
      requestId: () => '123e4567-e89b-12d3-a456-426614174000',
    });
    const disabled = await compileBrief(request, {
      planner: createDeterministicFakePlanner(),
      requestId: () => '123e4567-e89b-12d3-a456-426614174000',
      retrieval: {
        cases: [pattern('approved')],
        config: { enabled: false, strength: 'high' },
      },
    });
    await compileBrief(request, {
      planner,
      requestId: () => '123e4567-e89b-12d3-a456-426614174000',
      retrieval: {
        cases: [pattern('approved')],
        config: { enabled: true, strength: 'medium' },
      },
    });

    expect(JSON.stringify(disabled)).toBe(JSON.stringify(without));
    expect(received?.casePatterns).toEqual([
      {
        id: 'approved',
        license: 'CC0-1.0',
        patternSummary: '使用单一主焦点和三级网格组织中文活动海报。',
      },
    ]);
    expect(JSON.stringify(received)).not.toContain('visualStructure');
    expect(JSON.stringify(received)).not.toContain('sourceUrl');
  });
});

describe('similarity check', () => {
  it('flags substring copies and close copies without flagging unrelated prompts', () => {
    const cases = [
      {
        id: 'one',
        patternSummary: '使用单一主焦点和三级网格组织中文活动海报。',
      },
    ];
    expect(
      checkPatternSimilarity(
        '生成完整提示词。案例模式启发：使用单一主焦点和三级网格组织中文活动海报。继续补充执行细节。',
        cases,
      ),
    ).toEqual({ max: 1, sourceId: 'one', flagged: true });

    const closeCopy = checkPatternSimilarity(
      '案例模式启发：使用单一主焦点和三级网格组织中文峰会海报。',
      cases,
    );
    expect(closeCopy.max).toBeGreaterThanOrEqual(0.72);
    expect(closeCopy.max).toBeLessThan(1);
    expect(closeCopy.flagged).toBe(true);

    expect(
      checkPatternSimilarity('活动海报采用清晰中心标题与分层布局。', cases),
    ).toMatchObject({ flagged: false });
    expect(checkPatternSimilarity('anything', [])).toEqual({
      max: 0,
      sourceId: null,
      flagged: false,
    });
  });
});
