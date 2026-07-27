import { z } from 'zod';

export const SCHEMA_VERSION = '1.0.0';

export const TaskTypeSchema = z.enum([
  'poster',
  'photography',
  'product_concept',
  'three_d_scene',
  'infographic',
  'character_design',
  'image_edit',
  'storyboard',
  'general',
]);

export const DirectionModeSchema = z.enum([
  'faithful',
  'creative',
  'experimental',
]);

const nonEmptyString = z.string().min(1);
const stringList = z.array(z.string());
const nonEmptyStringList = z.array(nonEmptyString);
const uniqueNonEmptyStringList = nonEmptyStringList.refine(
  (items) => new Set(items).size === items.length,
  'Items must be unique',
);

const AspectRatioSchema = z.discriminatedUnion('mode', [
  z
    .object({
      mode: z.literal('auto'),
      value: z.null(),
    })
    .strict(),
  z
    .object({
      mode: z.enum(['preset', 'custom']),
      value: nonEmptyString,
    })
    .strict(),
]);

const CameraSchema = z
  .object({
    viewpoint: z.string().optional(),
    lens: z.string().optional(),
    framing: z.string().optional(),
    depth: z.string().optional(),
  })
  .strict();

const TypographySchema = z
  .object({
    strategy: z.string().optional(),
    fontClass: z.string().optional(),
    alignment: z.string().optional(),
    legibilityRequirements: stringList.optional(),
  })
  .strict();

export const VisualSpecSchema = z
  .object({
    schemaVersion: z.literal('1.0.0'),
    taskType: TaskTypeSchema,
    goal: nonEmptyString,
    audience: z.string().optional(),
    deliverable: nonEmptyString,
    aspectRatio: AspectRatioSchema,
    outputLanguage: z.string().min(2),
    mandatoryText: z.array(
      z
        .object({
          text: nonEmptyString,
          mustMatchExactly: z.boolean(),
          placement: z.string().optional(),
          hierarchy: z.string().optional(),
        })
        .strict(),
    ),
    mandatoryElements: nonEmptyStringList,
    forbiddenElements: nonEmptyStringList,
    subject: z
      .object({
        primary: nonEmptyString,
        attributes: stringList,
        actions: stringList.optional(),
      })
      .strict(),
    sceneGraph: z.array(
      z
        .object({
          id: nonEmptyString,
          element: nonEmptyString,
          region: nonEmptyString,
          scale: nonEmptyString,
          relationships: stringList,
        })
        .strict(),
    ),
    visualHierarchy: z
      .object({
        primaryFocus: nonEmptyString,
        secondaryElements: stringList,
        readingOrder: stringList,
      })
      .strict(),
    composition: stringList,
    camera: CameraSchema.nullable().optional(),
    lighting: stringList,
    palette: z
      .object({
        primary: stringList,
        accent: stringList,
        contrastStrategy: z.string(),
      })
      .strict(),
    materials: stringList,
    background: stringList,
    styleDNA: z
      .object({
        media: stringList,
        designSystem: stringList,
        spatialLanguage: stringList,
        timeCharacter: stringList.optional(),
        graphicLanguage: stringList.optional(),
        mood: stringList,
      })
      .strict(),
    typography: TypographySchema.nullable().optional(),
    qualityRequirements: stringList,
    assumptions: z.array(
      z
        .object({
          statement: nonEmptyString,
          confidence: z.number().min(0).max(1),
          impact: z.enum(['low', 'medium', 'high']),
        })
        .strict(),
    ),
    unresolvedQuestions: z.array(
      z
        .object({
          question: nonEmptyString,
          blocking: z.boolean(),
        })
        .strict(),
    ),
    riskFlags: stringList,
    taskSpecific: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

const aspectRatioInputPattern =
  /^(?:auto|1:1|4:3|3:4|16:9|9:16|[1-9][0-9]*(?:\.[0-9]+)?:[1-9][0-9]*(?:\.[0-9]+)?)$/;

export const CompileRequestSchema = z
  .object({
    brief: z.string().min(1).max(10_000),
    taskType: z.union([z.literal('auto'), TaskTypeSchema]),
    aspectRatio: z.string().regex(aspectRatioInputPattern),
    mandatoryText: uniqueNonEmptyStringList,
    mandatoryElements: uniqueNonEmptyStringList,
    forbiddenElements: uniqueNonEmptyStringList,
    creativity: z.number().int().min(0).max(100),
    allowAssumptions: z.boolean(),
    outputLanguage: z.string().min(2),
  })
  .strict();

const ScoresSchema = z
  .object({
    fidelity: z.number().min(0).max(100),
    subjectClarity: z.number().min(0).max(100),
    composition: z.number().min(0).max(100),
    hierarchy: z.number().min(0).max(100),
    lightingMaterialCoherence: z.number().min(0).max(100),
    typographyFeasibility: z.number().min(0).max(100),
    constraintControl: z.number().min(0).max(100),
    directionDistinctness: z.number().min(0).max(100),
    originalityRisk: z.number().min(0).max(100),
  })
  .strict();

export const DirectionSchema = z
  .object({
    mode: DirectionModeSchema,
    name: nonEmptyString,
    concept: nonEmptyString,
    differenceAxes: z.array(z.string()).min(1),
    fullPrompt: nonEmptyString,
    compactPrompt: nonEmptyString,
    negativeConstraints: stringList,
    assumptions: stringList,
    riskFlags: stringList,
    scores: ScoresSchema,
  })
  .strict();

export const DirectionsSchema = z
  .array(DirectionSchema)
  .length(3)
  .superRefine((directions, context) => {
    const modes = new Set(directions.map(({ mode }) => mode));
    if (
      modes.size !== 3 ||
      !DirectionModeSchema.options.every((mode) => modes.has(mode))
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Directions require one entry per mode',
      });
    }
  });

export const CompileResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    schemaVersion: z.literal('1.0.0'),
    promptVersion: nonEmptyString,
    normalizedBrief: VisualSpecSchema,
    needsInput: z.boolean(),
    riskFlags: stringList,
    directions: z.array(DirectionSchema).max(3),
    usage: z
      .object({
        model: nonEmptyString,
        latencyMs: z.number().int().min(0),
        inputTokens: z.number().int().min(0).optional(),
        outputTokens: z.number().int().min(0).optional(),
        estimatedCost: z.number().min(0).optional(),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.needsInput) {
      if (value.directions.length !== 0) {
        context.addIssue({
          code: 'custom',
          path: ['directions'],
          message: 'Blocking responses must not contain directions',
        });
      }
      return;
    }

    const modes = new Set(value.directions.map(({ mode }) => mode));
    if (
      value.directions.length !== 3 ||
      modes.size !== 3 ||
      !DirectionModeSchema.options.every((mode) => modes.has(mode))
    ) {
      context.addIssue({
        code: 'custom',
        path: ['directions'],
        message: 'Non-blocking responses require one direction per mode',
      });
    }
  });

export const ReviseRequestSchema = z
  .object({
    previousSpec: VisualSpecSchema,
    previousDirections: DirectionsSchema,
    instruction: z.string().min(1).max(4000),
    targetMode: DirectionModeSchema.nullable(),
    preserveOtherDirections: z.boolean(),
  })
  .strict();

const ChangeSchema = z
  .object({
    path: nonEmptyString,
    before: z.string().nullable(),
    after: z.string().nullable(),
  })
  .strict();

export const ReviseResponseSchema = z
  .object({
    result: CompileResponseSchema,
    changes: z.array(ChangeSchema),
  })
  .strict();

export const ErrorCodeSchema = z.enum([
  'INVALID_REQUEST',
  'CONFLICTING_CONSTRAINTS',
  'MODEL_OUTPUT_INVALID',
  'MODEL_TIMEOUT',
  'RATE_LIMITED',
  'UPSTREAM_ERROR',
  'CONTENT_REJECTED',
  'PAYLOAD_TOO_LARGE',
  'SERVICE_UNAVAILABLE',
]);

export const ErrorResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    error: z
      .object({
        code: ErrorCodeSchema,
        message: nonEmptyString,
        retryable: z.boolean(),
        details: nonEmptyStringList,
      })
      .strict(),
  })
  .strict();

export type VisualSpec = z.infer<typeof VisualSpecSchema>;
export type CompileRequest = z.infer<typeof CompileRequestSchema>;
export type CompileResponse = z.infer<typeof CompileResponseSchema>;
export type ReviseRequest = z.infer<typeof ReviseRequestSchema>;
export type ReviseResponse = z.infer<typeof ReviseResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
