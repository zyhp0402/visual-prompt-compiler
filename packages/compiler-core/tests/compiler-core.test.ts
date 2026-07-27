import { readFileSync } from 'node:fs';

import {
  CompileResponseSchema,
  ReviseResponseSchema,
  type CompileRequest,
} from '@vpc/contracts';
import { describe, expect, it } from 'vitest';

import {
  compileBrief,
  createDeterministicFakePlanner,
  InvalidCompilationError,
  lintCompilation,
  normalizeInput,
  reviseCompilation,
  type DirectionPlan,
  type Planner,
} from '../src/index.js';

const requestId = () => '123e4567-e89b-12d3-a456-426614174000';

type Fixture = {
  category: CompileRequest['taskType'];
  brief: string;
  aspectRatio: string;
  mandatoryText?: string[];
  mandatoryElements?: string[];
  forbiddenElements?: string[];
};

const fixtures = readFileSync(
  new URL('../../../fixtures/benchmark-cases.jsonl', import.meta.url),
  'utf8',
)
  .trim()
  .split(/\r?\n/)
  .map((line) => JSON.parse(line) as Fixture);

const toRequest = (fixture: Fixture): CompileRequest => ({
  brief: fixture.brief,
  taskType: fixture.category,
  aspectRatio: fixture.aspectRatio,
  mandatoryText: fixture.mandatoryText ?? [],
  mandatoryElements: fixture.mandatoryElements ?? [],
  forbiddenElements: fixture.forbiddenElements ?? [],
  creativity: 50,
  allowAssumptions: true,
  outputLanguage: 'zh-CN',
});

describe('compiler core', () => {
  it('normalizes whitespace and duplicate lists without mutating the input', () => {
    const input = toRequest({
      category: 'poster',
      brief: '  峰会   海报  ',
      aspectRatio: '3:4',
      mandatoryText: [' 标题 ', '标题'],
      mandatoryElements: [' 标志 ', '标志'],
      forbiddenElements: [' 人物 ', '人物'],
    });

    const normalized = normalizeInput(input);

    expect(normalized.brief).toBe('峰会 海报');
    expect(normalized.mandatoryText).toEqual(['标题']);
    expect(normalized.mandatoryElements).toEqual(['标志']);
    expect(normalized.forbiddenElements).toEqual(['人物']);
    expect(input.brief).toBe('  峰会   海报  ');
  });

  it('compiles every fixture into a stable contract-valid result', async () => {
    for (const fixture of fixtures) {
      const input = toRequest(fixture);
      const dependencies = {
        planner: createDeterministicFakePlanner(),
        requestId,
      };
      const first = await compileBrief(input, dependencies);
      const second = await compileBrief(input, dependencies);

      expect(CompileResponseSchema.safeParse(first).success).toBe(true);
      expect(first).toEqual(second);
      expect(first.directions.map(({ mode }) => mode)).toEqual([
        'faithful',
        'creative',
        'experimental',
      ]);
      for (const text of input.mandatoryText) {
        expect(
          first.directions.every(({ fullPrompt }) => fullPrompt.includes(text)),
        ).toBe(true);
      }
    }
  });

  it.each([
    ['poster', 'informationHierarchy'],
    ['image_edit', 'preserve'],
    ['storyboard', 'continuityAnchors'],
  ] as const)(
    'builds the %s task-specific structure',
    async (taskType, key) => {
      const result = await compileBrief(
        toRequest({
          category: taskType,
          brief: `${taskType} brief`,
          aspectRatio: '1:1',
        }),
        { planner: createDeterministicFakePlanner(), requestId },
      );

      expect(result.normalizedBrief.taskSpecific).toHaveProperty(key);
    },
  );

  it('flags incompatible lighting as a deterministic hard issue', async () => {
    const fixture = fixtures.find(({ brief }) => brief.includes('正午硬光'));
    expect(fixture).toBeDefined();

    const result = await compileBrief(toRequest(fixture!), {
      planner: createDeterministicFakePlanner(),
      requestId,
    });

    expect(result.riskFlags).toContain('LIGHTING_CONFLICT');
  });

  it('requires a non-empty preserve list for image edits', async () => {
    const result = await compileBrief(
      toRequest({
        category: 'image_edit',
        brief: '只修改背景',
        aspectRatio: 'auto',
      }),
      { planner: createDeterministicFakePlanner(), requestId },
    );

    expect(result.riskFlags).toContain('IMAGE_EDIT_PRESERVE_MISSING');
  });

  it('does not treat common negative sentences as forbidden leakage', async () => {
    for (const brief of [
      '未来城市海报，不要人物',
      '未来城市海报，人物不要出现',
      '未来城市海报，画面无人物',
      '未来城市海报，没有人物',
    ]) {
      const result = await compileBrief(
        toRequest({
          category: 'poster',
          brief,
          aspectRatio: '3:4',
          forbiddenElements: ['人物'],
        }),
        { planner: createDeterministicFakePlanner(), requestId },
      );

      expect(result.riskFlags).not.toContain('FORBIDDEN_ELEMENT_LEAK');
    }
  });

  it('flags a forbidden element used positively in the goal', async () => {
    const result = await compileBrief(
      toRequest({
        category: 'poster',
        brief: '未来城市海报，前景包含人物',
        aspectRatio: '3:4',
        forbiddenElements: ['人物'],
      }),
      { planner: createDeterministicFakePlanner(), requestId },
    );

    expect(result.riskFlags).toContain('FORBIDDEN_ELEMENT_LEAK');
  });

  it('does not treat a negative direction instruction as forbidden leakage', async () => {
    const base = createDeterministicFakePlanner();
    const planner: Planner = {
      ...base,
      planDirections: async (spec, context) =>
        (await base.planDirections(spec, context)).map((direction) => ({
          ...direction,
          instructions: [...direction.instructions, '避免人物'],
        })),
    };
    const result = await compileBrief(
      toRequest({
        category: 'poster',
        brief: '未来城市海报',
        aspectRatio: '3:4',
        forbiddenElements: ['人物'],
      }),
      { planner, requestId },
    );

    expect(result.riskFlags).not.toContain('FORBIDDEN_ELEMENT_LEAK');
  });

  it('distinguishes hard lint failures from soft score warnings', async () => {
    const result = await compileBrief(toRequest(fixtures[0]!), {
      planner: createDeterministicFakePlanner(),
      requestId,
    });
    const duplicatePlans: DirectionPlan[] = result.directions.map(
      (direction) => ({
        mode: direction.mode,
        name: direction.name,
        concept: direction.concept,
        differenceAxes: ['色彩'],
        instructions: [],
        scores: { ...direction.scores, directionDistinctness: 50 },
      }),
    );

    const issues = lintCompilation(result.normalizedBrief, duplicatePlans, []);

    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'DIRECTIONS_NOT_DISTINCT',
        severity: 'error',
      }),
    );
    expect(issues).toContainEqual(
      expect.objectContaining({
        code: 'LOW_DIRECTION_SCORE',
        severity: 'warning',
      }),
    );
  });

  it('rejects three directions with the same structural-axis signature', async () => {
    const base = createDeterministicFakePlanner();
    const spec = await base.buildVisualSpec(
      normalizeInput(toRequest(fixtures[0]!)),
    );
    const plans = (await base.planDirections(spec)).map((direction) => ({
      ...direction,
      differenceAxes: ['构图结构', '视觉叙事', '媒介'],
    }));

    expect(lintCompilation(spec, plans, [])).toContainEqual(
      expect.objectContaining({
        code: 'DIRECTIONS_NOT_DISTINCT',
        severity: 'error',
      }),
    );
  });

  it('reports planner model metadata in usage', async () => {
    const planner = {
      ...createDeterministicFakePlanner(),
      model: 'test-planner',
    };
    const result = await compileBrief(toRequest(fixtures[0]!), {
      planner,
      requestId,
    });

    expect(result.usage.model).toBe('test-planner');
  });

  it('attempts planner repair no more than once', async () => {
    const base = createDeterministicFakePlanner();
    let repairs = 0;
    const invalidPlans = (
      await base.planDirections(
        await base.buildVisualSpec(normalizeInput(toRequest(fixtures[0]!))),
      )
    ).map((plan) => ({ ...plan, differenceAxes: ['色彩'] }));
    const planner: Planner = {
      ...base,
      planDirections: async () => invalidPlans,
      repair: async () => {
        repairs += 1;
        return { directions: invalidPlans };
      },
    };

    const result = await compileBrief(toRequest(fixtures[0]!), {
      planner,
      requestId,
    });

    expect(repairs).toBe(1);
    expect(result.riskFlags).toContain('DIRECTIONS_NOT_DISTINCT');
  });

  it('throws a stable typed error when one repair cannot restore the direction shape', async () => {
    const base = createDeterministicFakePlanner();
    let repairs = 0;
    const planner: Planner = {
      ...base,
      planDirections: async (spec, context) =>
        (await base.planDirections(spec, context)).slice(0, 2),
      repair: async () => {
        repairs += 1;
        return {};
      },
    };

    const compile = compileBrief(toRequest(fixtures[0]!), {
      planner,
      requestId,
    });

    await expect(compile).rejects.toMatchObject({
      name: 'InvalidCompilationError',
      code: 'INVALID_COMPILATION_SHAPE',
    } satisfies Partial<InvalidCompilationError>);
    expect(repairs).toBe(1);
  });

  it('returns no directions when the planner reports a blocking question', async () => {
    const base = createDeterministicFakePlanner();
    const planner: Planner = {
      ...base,
      buildVisualSpec: async (input) => ({
        ...(await base.buildVisualSpec(input)),
        unresolvedQuestions: [{ question: '请提供待编辑图片', blocking: true }],
      }),
    };

    const result = await compileBrief(toRequest(fixtures[0]!), {
      planner,
      requestId,
    });

    expect(result.needsInput).toBe(true);
    expect(result.directions).toEqual([]);
    expect(CompileResponseSchema.safeParse(result).success).toBe(true);
  });

  it('revises only the target direction when preserving other directions', async () => {
    const initial = await compileBrief(toRequest(fixtures[0]!), {
      planner: createDeterministicFakePlanner(),
      requestId,
    });
    const revised = await reviseCompilation(
      {
        previousSpec: initial.normalizedBrief,
        instruction: '改为更克制的构图',
        targetMode: 'creative',
        preserveOtherDirections: true,
      },
      { planner: createDeterministicFakePlanner(), requestId },
    );

    expect(ReviseResponseSchema.safeParse(revised).success).toBe(true);
    expect(revised.changes).toContainEqual(
      expect.objectContaining({
        path: 'directions.creative',
        after: '改为更克制的构图',
      }),
    );
    expect(revised.result.directions[0]).toEqual(initial.directions[0]);
    expect(revised.result.directions[1]).not.toEqual(initial.directions[1]);
    expect(revised.result.directions[2]).toEqual(initial.directions[2]);
    expect(revised.result.normalizedBrief.taskSpecific).toEqual(
      initial.normalizedBrief.taskSpecific,
    );
  });

  it('applies a revision to the shared goal when other directions are not preserved', async () => {
    const initial = await compileBrief(toRequest(fixtures[0]!), {
      planner: createDeterministicFakePlanner(),
      requestId,
    });
    const revised = await reviseCompilation(
      {
        previousSpec: initial.normalizedBrief,
        instruction: '整体改为更克制的构图',
        targetMode: 'creative',
        preserveOtherDirections: false,
      },
      { planner: createDeterministicFakePlanner(), requestId },
    );

    expect(revised.result.normalizedBrief.goal).toContain(
      '整体改为更克制的构图',
    );
    expect(revised.changes).toContainEqual(
      expect.objectContaining({ path: 'goal' }),
    );
  });
});
