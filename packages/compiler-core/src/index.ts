import type {
  CompileRequest,
  CompileResponse,
  ReviseRequest,
  ReviseResponse,
  VisualSpec,
} from '@vpc/contracts';

export const PROMPT_VERSION = 'prompt-1';

export type NormalizedInput = Omit<
  CompileRequest,
  'brief' | 'mandatoryText' | 'mandatoryElements' | 'forbiddenElements'
> & {
  brief: string;
  mandatoryText: string[];
  mandatoryElements: string[];
  forbiddenElements: string[];
};

export type DirectionPlan = {
  mode: CompileResponse['directions'][number]['mode'];
  name: string;
  concept: string;
  differenceAxes: string[];
  instructions: string[];
  scores: CompileResponse['directions'][number]['scores'];
};

export type Change = ReviseResponse['changes'][number];

export type RepairResult = {
  spec?: VisualSpec;
  directions?: DirectionPlan[];
};

export type PlanningContext = {
  revision?: {
    instruction: string;
    targetMode: ReviseRequest['targetMode'];
    preserveOtherDirections: boolean;
  };
};

export interface Planner {
  readonly model: string;
  buildVisualSpec(input: NormalizedInput): Promise<VisualSpec>;
  planDirections(
    spec: VisualSpec,
    context?: PlanningContext,
  ): Promise<DirectionPlan[]>;
  reviseSpec(input: ReviseRequest): Promise<{
    spec: VisualSpec;
    changes: Change[];
  }>;
  repair(
    spec: VisualSpec,
    directions: DirectionPlan[],
    issues: LintIssue[],
  ): Promise<RepairResult>;
}

export type CompilerDependencies = {
  planner: Planner;
  requestId: () => string;
};

export class InvalidCompilationError extends Error {
  readonly code = 'INVALID_COMPILATION_SHAPE';

  constructor() {
    super('Compilation must contain exactly one direction for each v1 mode.');
    this.name = 'InvalidCompilationError';
  }
}

export type LintIssue = {
  code:
    | 'DIRECTIONS_NOT_DISTINCT'
    | 'LOW_DIRECTION_SCORE'
    | 'MANDATORY_TEXT_MISSING'
    | 'MANDATORY_ELEMENT_MISSING'
    | 'FORBIDDEN_ELEMENT_LEAK'
    | 'LIGHTING_CONFLICT'
    | 'CAMERA_CONFLICT'
    | 'STYLE_CONFLICT'
    | 'IMAGE_EDIT_PRESERVE_MISSING'
    | 'UNREQUESTED_ARTIST';
  severity: 'error' | 'warning';
  message: string;
};

const normalizeList = (items: string[]): string[] => [
  ...new Set(items.map((item) => item.trim()).filter(Boolean)),
];

export const normalizeInput = (input: CompileRequest): NormalizedInput => ({
  ...input,
  brief: input.brief.trim().replace(/\s+/g, ' '),
  mandatoryText: normalizeList(input.mandatoryText),
  mandatoryElements: normalizeList(input.mandatoryElements),
  forbiddenElements: normalizeList(input.forbiddenElements),
});

const structuralAxes = new Set([
  '构图结构',
  '视觉叙事',
  '媒介',
  '空间组织',
  '镜头策略',
  '材料系统',
  '图形语言',
]);

const contains = (text: string, phrase: string): boolean =>
  text.toLocaleLowerCase().includes(phrase.toLocaleLowerCase());

const hasPositiveMention = (text: string, phrase: string): boolean => {
  const normalizedText = text.toLocaleLowerCase();
  const normalizedPhrase = phrase.toLocaleLowerCase();
  let index = normalizedText.indexOf(normalizedPhrase);

  // ponytail: 否定词距启发式；出现真实误报或漏报时再升级为分词或规则解析。
  while (index !== -1) {
    const prefix = normalizedText.slice(Math.max(0, index - 16), index);
    const suffix = normalizedText.slice(
      index + normalizedPhrase.length,
      index + normalizedPhrase.length + 12,
    );
    if (
      !/(?:不要|禁止|不得|避免|不出现|不能出现|勿|无|没有)[^。；;，,!?！？]{0,10}$/u.test(
        prefix,
      ) &&
      !/^(?:不要|禁止|不得|避免|不出现|不能出现|勿)/u.test(suffix)
    ) {
      return true;
    }
    index = normalizedText.indexOf(
      normalizedPhrase,
      index + normalizedPhrase.length,
    );
  }
  return false;
};

const hasLightingConflict = (text: string): boolean =>
  (contains(text, '阴天散射光') || contains(text, '柔光')) &&
  contains(text, '硬光') &&
  (contains(text, '无阴影') || contains(text, '没有阴影'));

const hasCameraConflict = (text: string): boolean =>
  (contains(text, '俯视') && contains(text, '仰视')) ||
  (contains(text, '超广角') && contains(text, '长焦'));

const hasStyleConflict = (text: string): boolean =>
  (contains(text, '极简') && contains(text, '繁复')) ||
  (contains(text, '写实') && contains(text, '扁平插画'));

const artistPattern =
  /(?:模仿|in the style of|inspired by)\s*[\p{L}\p{N}·.-]+/iu;

export const lintCompilation = (
  spec: VisualSpec,
  directions: DirectionPlan[],
  renderedPrompts: string[],
): LintIssue[] => {
  const issues: LintIssue[] = [];
  const structuralSignatures = directions.map(({ differenceAxes }) =>
    [...new Set(differenceAxes.filter((axis) => structuralAxes.has(axis)))]
      .sort()
      .join('|'),
  );
  const modes = new Set(directions.map(({ mode }) => mode));
  const positiveRequirements = [
    spec.goal,
    ...directions.flatMap(({ concept, instructions }) => [
      concept,
      ...instructions,
    ]),
  ];

  if (
    directions.length !== 3 ||
    modes.size !== 3 ||
    structuralSignatures.some((signature) => signature.length === 0) ||
    new Set(structuralSignatures).size !== directions.length
  ) {
    issues.push({
      code: 'DIRECTIONS_NOT_DISTINCT',
      severity: 'error',
      message: '三个方向必须分别使用可验证的结构差异轴。',
    });
  }

  if (directions.some(({ scores }) => scores.directionDistinctness < 70)) {
    issues.push({
      code: 'LOW_DIRECTION_SCORE',
      severity: 'warning',
      message: '方向差异软评分低于 70。',
    });
  }

  if (hasLightingConflict([spec.goal, ...spec.lighting].join(' '))) {
    issues.push({
      code: 'LIGHTING_CONFLICT',
      severity: 'error',
      message: '光线要求互相冲突。',
    });
  }
  if (
    hasCameraConflict(
      [spec.goal, ...Object.values(spec.camera ?? {})].join(' '),
    )
  ) {
    issues.push({
      code: 'CAMERA_CONFLICT',
      severity: 'error',
      message: '镜头要求互相冲突。',
    });
  }
  if (
    hasStyleConflict(
      [spec.goal, ...spec.styleDNA.media, ...spec.styleDNA.designSystem].join(
        ' ',
      ),
    )
  ) {
    issues.push({
      code: 'STYLE_CONFLICT',
      severity: 'error',
      message: '风格要求互相冲突。',
    });
  }

  for (const prompt of renderedPrompts) {
    for (const { text } of spec.mandatoryText) {
      if (!prompt.includes(text)) {
        issues.push({
          code: 'MANDATORY_TEXT_MISSING',
          severity: 'error',
          message: `固定文字未原样保留：${text}`,
        });
      }
    }
    for (const element of spec.mandatoryElements) {
      if (!contains(prompt, element)) {
        issues.push({
          code: 'MANDATORY_ELEMENT_MISSING',
          severity: 'error',
          message: `必须元素缺失：${element}`,
        });
      }
    }
    if (artistPattern.test(prompt) && !artistPattern.test(spec.goal)) {
      issues.push({
        code: 'UNREQUESTED_ARTIST',
        severity: 'error',
        message: '提示词出现用户未要求的艺术家姓名。',
      });
    }
  }

  for (const forbidden of spec.forbiddenElements) {
    if (
      spec.mandatoryElements.some((element) => contains(element, forbidden)) ||
      positiveRequirements.some((requirement) =>
        hasPositiveMention(requirement, forbidden),
      )
    ) {
      issues.push({
        code: 'FORBIDDEN_ELEMENT_LEAK',
        severity: 'error',
        message: `禁止元素出现在结构化正向要求中：${forbidden}`,
      });
    }
  }

  const preserve = spec.taskSpecific?.preserve;
  if (
    spec.taskType === 'image_edit' &&
    (!Array.isArray(preserve) || preserve.length === 0)
  ) {
    issues.push({
      code: 'IMAGE_EDIT_PRESERVE_MISSING',
      severity: 'error',
      message: '图片编辑任务必须明确保持项。',
    });
  }

  return issues;
};

const joinOr = (items: string[], fallback: string): string =>
  items.length > 0 ? items.join('、') : fallback;

const renderAspectRatio = (aspectRatio: VisualSpec['aspectRatio']): string =>
  aspectRatio.mode === 'auto'
    ? '自动选择适合内容的画幅'
    : `画幅 ${aspectRatio.value}`;

export const renderPrompt = (
  spec: VisualSpec,
  direction: DirectionPlan,
): { fullPrompt: string; compactPrompt: string } => {
  const fixedText =
    spec.mandatoryText.length === 0
      ? '无需生成文字'
      : `逐字呈现文字：${spec.mandatoryText.map(({ text }) => `“${text}”`).join('；')}`;
  const fullPrompt = [
    `创作${spec.deliverable}。目标：${spec.goal}。`,
    `方向：${direction.concept}；差异轴：${direction.differenceAxes.join('、')}。`,
    `主体：${spec.subject.primary}；第一视觉焦点：${spec.visualHierarchy.primaryFocus}。`,
    `构图：${joinOr(spec.composition, '清晰稳定')}。`,
    `光线：${joinOr(spec.lighting, '与主题一致')}；色彩：${joinOr(spec.palette.primary, '协调')}；材质：${joinOr(spec.materials, '符合场景')}。`,
    `背景：${joinOr(spec.background, '服务主体')}；媒介：${joinOr(spec.styleDNA.media, '数字视觉')}。`,
    `必须包含：${joinOr(spec.mandatoryElements, '无额外指定')}。${fixedText}。`,
    `${renderAspectRatio(spec.aspectRatio)}。${direction.instructions.join('；')}。`,
    `禁止出现：${joinOr(spec.forbiddenElements, '无额外指定')}。`,
  ].join('');
  const compactPrompt = [
    spec.goal,
    direction.concept,
    direction.differenceAxes.join('、'),
    fixedText,
    `必须包含：${joinOr(spec.mandatoryElements, '无额外指定')}`,
    `禁止出现：${joinOr(spec.forbiddenElements, '无额外指定')}`,
    renderAspectRatio(spec.aspectRatio),
  ].join('；');

  return { fullPrompt, compactPrompt };
};

const scoreTemplate = (
  directionDistinctness: number,
): DirectionPlan['scores'] => ({
  fidelity: 90,
  subjectClarity: 88,
  composition: 86,
  hierarchy: 86,
  lightingMaterialCoherence: 84,
  typographyFeasibility: 82,
  constraintControl: 92,
  directionDistinctness,
  originalityRisk: 15,
});

const aspectRatioSpec = (value: string): VisualSpec['aspectRatio'] =>
  value === 'auto'
    ? { mode: 'auto', value: null }
    : {
        mode: ['1:1', '4:3', '3:4', '16:9', '9:16'].includes(value)
          ? 'preset'
          : 'custom',
        value,
      };

const taskSpecificFor = (
  taskType: VisualSpec['taskType'],
  mandatoryElements: string[],
): Record<string, unknown> | undefined => {
  if (taskType === 'poster') {
    return {
      informationHierarchy: ['标题', '主体', '辅助信息'],
      readingOrder: ['标题', '主体', '辅助信息'],
    };
  }
  if (taskType === 'image_edit') {
    return {
      preserve: mandatoryElements.filter((item) => item.includes('保持')),
      modify: ['按简报修改指定区域'],
    };
  }
  if (taskType === 'storyboard') {
    return {
      continuityAnchors: mandatoryElements.filter(
        (item) => item.includes('一致') || item.includes('连续'),
      ),
      shotProgression: ['建立', '发展', '完成'],
    };
  }
  return undefined;
};

export const createDeterministicFakePlanner = (): Planner => ({
  model: 'deterministic-fake-planner',

  async buildVisualSpec(input) {
    const taskType = input.taskType === 'auto' ? 'general' : input.taskType;
    const taskSpecific = taskSpecificFor(taskType, input.mandatoryElements);
    return {
      schemaVersion: '1.0.0',
      taskType,
      goal: input.brief,
      deliverable: `${taskType}视觉`,
      aspectRatio: aspectRatioSpec(input.aspectRatio),
      outputLanguage: input.outputLanguage,
      mandatoryText: input.mandatoryText.map((text) => ({
        text,
        mustMatchExactly: true,
      })),
      mandatoryElements: input.mandatoryElements,
      forbiddenElements: input.forbiddenElements,
      subject: { primary: input.brief, attributes: [] },
      sceneGraph: input.mandatoryElements.map((element, index) => ({
        id: `element-${index + 1}`,
        element,
        region: '按视觉层级安排',
        scale: '清晰可辨',
        relationships: [],
      })),
      visualHierarchy: {
        primaryFocus: input.mandatoryElements[0] ?? input.brief,
        secondaryElements: input.mandatoryElements.slice(1),
        readingOrder: input.mandatoryElements,
      },
      composition: ['单一第一视觉焦点', '层级清楚'],
      camera: null,
      lighting: [input.brief],
      palette: {
        primary: ['与简报一致'],
        accent: [],
        contrastStrategy: '主体与背景清晰分离',
      },
      materials: ['与交付物类型一致'],
      background: ['不干扰主体'],
      styleDNA: {
        media: ['数字视觉'],
        designSystem: ['一致的视觉语言'],
        spatialLanguage: ['明确前中后关系'],
        mood: ['符合目标'],
      },
      qualityRequirements: ['硬约束逐项保留', '避免互相冲突'],
      assumptions:
        input.allowAssumptions && input.brief.length < 20
          ? [
              {
                statement: '未指定细节由系统采用中性默认值',
                confidence: 0.5,
                impact: 'medium',
              },
            ]
          : [],
      unresolvedQuestions: [],
      riskFlags: [],
      ...(taskSpecific ? { taskSpecific } : {}),
    };
  },

  async planDirections(_spec, context) {
    const revision = context?.revision;
    const directions: DirectionPlan[] = [
      {
        mode: 'faithful',
        name: '稳妥',
        concept: '忠实呈现需求并减少额外假设',
        differenceAxes: ['构图结构'],
        instructions: ['采用清晰稳定的中心层级'],
        scores: scoreTemplate(88),
      },
      {
        mode: 'creative',
        name: '创意',
        concept: '保留硬约束并改变视觉叙事',
        differenceAxes: ['视觉叙事'],
        instructions: ['用前景到背景的叙事路径组织画面'],
        scores: scoreTemplate(90),
      },
      {
        mode: 'experimental',
        name: '实验',
        concept: '在硬约束内尝试跨媒介表达',
        differenceAxes: ['媒介'],
        instructions: ['结合空间装置与图形化视觉语言'],
        scores: scoreTemplate(92),
      },
    ];
    return directions.map((direction) =>
      revision &&
      (revision.targetMode === null || revision.targetMode === direction.mode)
        ? {
            ...direction,
            concept: `${direction.concept}；${revision.instruction}`,
            instructions: [...direction.instructions, revision.instruction],
          }
        : direction,
    );
  },

  async reviseSpec(input) {
    const instruction = input.instruction.trim();
    const targeted = input.targetMode !== null && input.preserveOtherDirections;
    const goal = targeted
      ? input.previousSpec.goal
      : `${input.previousSpec.goal}；修改要求：${instruction}`;
    return {
      spec: { ...input.previousSpec, goal },
      changes: [
        targeted
          ? {
              path: `directions.${input.targetMode}`,
              before: null,
              after: instruction,
            }
          : {
              path: 'goal',
              before: input.previousSpec.goal,
              after: goal,
            },
      ],
    };
  },

  async repair() {
    return {};
  },
});

const issueCodes = (issues: LintIssue[]): string[] => [
  ...new Set(issues.map(({ code }) => code)),
];

const hasValidDirectionShape = (directions: DirectionPlan[]): boolean => {
  const modes = directions.map(({ mode }) => mode);
  const requiredModes: DirectionPlan['mode'][] = [
    'faithful',
    'creative',
    'experimental',
  ];
  return (
    directions.length === 3 &&
    new Set(modes).size === 3 &&
    requiredModes.every((mode) => modes.includes(mode))
  );
};

const assembleResponse = (
  spec: VisualSpec,
  plans: DirectionPlan[],
  dependencies: CompilerDependencies,
): CompileResponse => {
  const needsInput = spec.unresolvedQuestions.some(({ blocking }) => blocking);
  const rendered = plans.map((plan) => renderPrompt(spec, plan));
  const issues = needsInput
    ? []
    : lintCompilation(
        spec,
        plans,
        rendered.map(({ fullPrompt }) => fullPrompt),
      );
  const risks = [...new Set([...spec.riskFlags, ...issueCodes(issues)])];
  return {
    requestId: dependencies.requestId(),
    schemaVersion: '1.0.0',
    promptVersion: PROMPT_VERSION,
    normalizedBrief: { ...spec, riskFlags: risks },
    needsInput,
    riskFlags: risks,
    directions: needsInput
      ? []
      : plans.map((plan, index) => ({
          mode: plan.mode,
          name: plan.name,
          concept: plan.concept,
          differenceAxes: plan.differenceAxes,
          fullPrompt: rendered[index]?.fullPrompt ?? '',
          compactPrompt: rendered[index]?.compactPrompt ?? '',
          negativeConstraints: spec.forbiddenElements,
          assumptions: spec.assumptions.map(({ statement }) => statement),
          riskFlags: risks,
          scores: plan.scores,
        })),
    usage: { model: dependencies.planner.model, latencyMs: 0 },
  };
};

const runPipeline = async (
  spec: VisualSpec,
  dependencies: CompilerDependencies,
  context?: PlanningContext,
): Promise<CompileResponse> => {
  let currentSpec = spec;
  if (currentSpec.unresolvedQuestions.some(({ blocking }) => blocking)) {
    return assembleResponse(currentSpec, [], dependencies);
  }
  let directions = await dependencies.planner.planDirections(
    currentSpec,
    context,
  );
  const rendered = directions.map(
    (direction) => renderPrompt(currentSpec, direction).fullPrompt,
  );
  const issues = lintCompilation(currentSpec, directions, rendered);

  if (issues.some(({ severity }) => severity === 'error')) {
    const repaired = await dependencies.planner.repair(
      currentSpec,
      directions,
      issues,
    );
    currentSpec = repaired.spec ?? currentSpec;
    directions = repaired.directions ?? directions;
  }

  if (!hasValidDirectionShape(directions)) {
    throw new InvalidCompilationError();
  }

  return assembleResponse(currentSpec, directions, dependencies);
};

export const compileBrief = async (
  input: CompileRequest,
  dependencies: CompilerDependencies,
): Promise<CompileResponse> => {
  const spec = await dependencies.planner.buildVisualSpec(
    normalizeInput(input),
  );
  return runPipeline(spec, dependencies);
};

export const reviseCompilation = async (
  input: ReviseRequest,
  dependencies: CompilerDependencies,
): Promise<ReviseResponse> => {
  const { spec, changes } = await dependencies.planner.reviseSpec(input);
  const context: PlanningContext = {
    revision: {
      instruction: input.instruction.trim(),
      targetMode: input.targetMode,
      preserveOtherDirections: input.preserveOtherDirections,
    },
  };
  return { result: await runPipeline(spec, dependencies, context), changes };
};
