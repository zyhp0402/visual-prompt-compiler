import { readFileSync } from 'node:fs';

import { Ajv2020 } from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import {
  CompileRequestSchema,
  CompileResponseSchema,
  ErrorResponseSchema,
  ReviseRequestSchema,
  ReviseResponseSchema,
  VisualSpecSchema,
} from '../src/index.js';

const schemas = [
  ['visual-spec.schema.json', VisualSpecSchema],
  ['compile-request.schema.json', CompileRequestSchema],
  ['compile-response.schema.json', CompileResponseSchema],
  ['revise-request.schema.json', ReviseRequestSchema],
  ['revise-response.schema.json', ReviseResponseSchema],
  ['error-response.schema.json', ErrorResponseSchema],
] as const;

const visualSpec = {
  schemaVersion: '1.0.0',
  taskType: 'general',
  goal: '测试视觉',
  deliverable: '图片',
  aspectRatio: { mode: 'auto', value: null },
  outputLanguage: 'zh-CN',
  mandatoryText: [],
  mandatoryElements: [],
  forbiddenElements: [],
  subject: { primary: '主题', attributes: [] },
  sceneGraph: [],
  visualHierarchy: {
    primaryFocus: '主题',
    secondaryElements: [],
    readingOrder: ['主题'],
  },
  composition: [],
  lighting: [],
  palette: { primary: [], accent: [], contrastStrategy: '未指定' },
  materials: [],
  background: [],
  styleDNA: {
    media: [],
    designSystem: [],
    spatialLanguage: [],
    mood: [],
  },
  qualityRequirements: [],
  assumptions: [],
  unresolvedQuestions: [],
  riskFlags: [],
};

const scores = {
  fidelity: 50,
  subjectClarity: 50,
  composition: 50,
  hierarchy: 50,
  lightingMaterialCoherence: 50,
  typographyFeasibility: 50,
  constraintControl: 50,
  directionDistinctness: 50,
  originalityRisk: 50,
};

const direction = (mode: 'faithful' | 'creative' | 'experimental') => ({
  mode,
  name: mode,
  concept: '概念',
  differenceAxes: ['构图'],
  fullPrompt: '完整提示词',
  compactPrompt: '精简提示词',
  negativeConstraints: [],
  assumptions: [],
  riskFlags: [],
  scores,
});

const compileResponse = {
  requestId: '123e4567-e89b-12d3-a456-426614174000',
  schemaVersion: '1.0.0',
  promptVersion: 'prompt-1',
  normalizedBrief: visualSpec,
  needsInput: false,
  riskFlags: [],
  directions: [
    direction('faithful'),
    direction('creative'),
    direction('experimental'),
  ],
  usage: { model: 'mock-model', latencyMs: 1 },
};

const validSamples: Record<string, unknown> = {
  'visual-spec.schema.json': visualSpec,
  'compile-request.schema.json': {
    brief: '生成一张海报',
    taskType: 'auto',
    aspectRatio: '3:4',
    mandatoryText: [],
    mandatoryElements: [],
    forbiddenElements: [],
    creativity: 50,
    allowAssumptions: true,
    outputLanguage: 'zh-CN',
  },
  'compile-response.schema.json': compileResponse,
  'revise-request.schema.json': {
    previousSpec: visualSpec,
    instruction: '改为蓝白配色',
    targetMode: 'creative',
    preserveOtherDirections: true,
  },
  'revise-response.schema.json': {
    result: compileResponse,
    changes: [{ path: 'palette.primary', before: null, after: '蓝白' }],
  },
  'error-response.schema.json': {
    requestId: '123e4567-e89b-12d3-a456-426614174000',
    error: {
      code: 'INVALID_REQUEST',
      message: '请求无效',
      retryable: false,
      details: [],
    },
  },
};

const invalidSamples: Record<string, unknown> = {
  'visual-spec.schema.json': {
    ...visualSpec,
    aspectRatio: { mode: 'auto', value: 'auto' },
  },
  'compile-request.schema.json': {
    ...(validSamples['compile-request.schema.json'] as Record<string, unknown>),
    creativity: 101,
  },
  'compile-response.schema.json': {
    ...compileResponse,
    directions: [
      direction('faithful'),
      direction('creative'),
      direction('creative'),
    ],
  },
  'revise-request.schema.json': {
    ...(validSamples['revise-request.schema.json'] as Record<string, unknown>),
    instruction: '',
  },
  'revise-response.schema.json': {
    ...(validSamples['revise-response.schema.json'] as Record<string, unknown>),
    extra: true,
  },
  'error-response.schema.json': {
    ...(validSamples['error-response.schema.json'] as Record<string, unknown>),
    error: {
      code: 'UNKNOWN',
      message: '错误',
      retryable: false,
      details: [],
    },
  },
};

describe('JSON Schema and Zod parity', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  ajv.addFormat(
    'uuid',
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  for (const [file] of schemas) {
    const url = new URL(`../../../schemas/${file}`, import.meta.url);
    ajv.addSchema(JSON.parse(readFileSync(url, 'utf8')));
  }

  for (const [file, zodSchema] of schemas) {
    const validate = ajv.getSchema(`https://example.local/schemas/${file}`);

    it(`${file} accepts the shared valid sample`, () => {
      expect(validate?.(validSamples[file]), validate?.errors?.join()).toBe(
        true,
      );
      expect(zodSchema.safeParse(validSamples[file]).success).toBe(true);
    });

    it(`${file} rejects the shared invalid sample`, () => {
      expect(validate?.(invalidSamples[file])).toBe(false);
      expect(zodSchema.safeParse(invalidSamples[file]).success).toBe(false);
    });
  }
});
