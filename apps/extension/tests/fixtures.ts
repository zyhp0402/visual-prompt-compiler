import type { CompileRequest, CompileResponse } from '@vpc/contracts';

export const validCompileRequest: CompileRequest = {
  brief: '为城市夜跑设计竖版海报',
  taskType: 'poster',
  aspectRatio: '3:4',
  mandatoryText: ['夜行城市'],
  mandatoryElements: ['潮湿街道'],
  forbiddenElements: ['汽车'],
  creativity: 60,
  allowAssumptions: true,
  outputLanguage: 'zh-CN',
};

const visualSpec: CompileResponse['normalizedBrief'] = {
  schemaVersion: '1.1.0',
  taskType: 'poster',
  goal: '城市夜跑活动海报',
  deliverable: '竖版海报',
  aspectRatio: { mode: 'preset', value: '3:4' },
  outputLanguage: 'zh-CN',
  mandatoryText: [
    { text: '夜行城市', mustMatchExactly: true, hierarchy: '主标题' },
  ],
  mandatoryElements: ['潮湿街道'],
  forbiddenElements: ['汽车'],
  subject: { primary: '夜跑者', attributes: ['动态'] },
  sceneGraph: [
    {
      id: 'runner',
      element: '夜跑者',
      region: '画面中央',
      scale: '中景',
      relationships: ['位于潮湿街道上'],
    },
  ],
  visualHierarchy: {
    primaryFocus: '夜跑者',
    secondaryElements: ['标题'],
    readingOrder: ['标题', '夜跑者'],
  },
  composition: ['纵向动线'],
  lighting: ['城市反光'],
  palette: {
    primary: ['深墨色'],
    accent: ['朱红'],
    contrastStrategy: '明暗对比',
  },
  materials: ['湿润沥青'],
  background: ['夜间城市'],
  styleDNA: {
    media: ['摄影'],
    designSystem: ['编辑感'],
    spatialLanguage: ['纵深'],
    mood: ['克制'],
  },
  typography: {
    strategy: '标题优先',
    legibilityRequirements: ['高对比'],
  },
  qualityRequirements: ['文字清晰'],
  assumptions: [
    { statement: '活动发生在夜间', confidence: 0.8, impact: 'medium' },
  ],
  unresolvedQuestions: [],
  riskFlags: [],
  taskSpecific: {},
};

const scores = {
  fidelity: 90,
  subjectClarity: 88,
  composition: 86,
  hierarchy: 87,
  lightingMaterialCoherence: 85,
  typographyFeasibility: 84,
  constraintControl: 92,
  directionDistinctness: 89,
  originalityRisk: 20,
};

const direction = (
  mode: 'faithful' | 'creative' | 'experimental',
  index: number,
): CompileResponse['directions'][number] => ({
  mode,
  name: `${mode}-方向`,
  concept: `第 ${index} 份可执行视觉概念`,
  differenceAxes: [index === 1 ? '构图结构' : '视觉叙事'],
  fullPrompt: `${mode} 完整提示词：夜跑者穿过潮湿街道。`,
  compactPrompt: `${mode} 精简提示词`,
  negativeConstraints: ['不要汽车'],
  assumptions: [],
  riskFlags: [],
  scores,
});

export const validCompileResponse: CompileResponse = {
  requestId: '123e4567-e89b-12d3-a456-426614174000',
  schemaVersion: '1.1.0',
  promptVersion: 'prompt-2',
  normalizedBrief: visualSpec,
  needsInput: false,
  riskFlags: [],
  directions: [
    direction('faithful', 1),
    direction('creative', 2),
    direction('experimental', 3),
  ],
  usage: { model: 'mock-model', latencyMs: 12 },
};
