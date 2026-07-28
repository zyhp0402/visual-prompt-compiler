import { z } from 'zod';

import { DirectionModeSchema } from './index.js';

export const IMAGE_CONTRACT_VERSION = 'image-1';

export const ImageSizeSchema = z.enum(['1024x1024', '1536x1024', '1024x1536']);

export const GenerateRequestSchema = z
  .object({
    imageContractVersion: z.literal(IMAGE_CONTRACT_VERSION),
    source: z
      .object({
        kind: z.literal('text'),
        prompt: z.string().min(1).max(10_000),
      })
      .strict(),
    n: z.literal(1),
    size: ImageSizeSchema,
    quality: z.literal('low'),
    outputFormat: z.literal('png'),
  })
  .strict();

const tokenUsage = z.number().int().min(0).optional();

export const GenerateResponseSchema = z
  .object({
    requestId: z.string().uuid(),
    imageContractVersion: z.literal(IMAGE_CONTRACT_VERSION),
    image: z
      .object({
        base64: z.string().min(1),
        mimeType: z.literal('image/png'),
        size: ImageSizeSchema,
      })
      .strict(),
    usage: z
      .object({
        model: z.string().min(1),
        latencyMs: z.number().int().min(0),
        inputTokens: tokenUsage,
        outputTokens: tokenUsage,
        totalTokens: tokenUsage,
      })
      .strict(),
  })
  .strict();

export const ImageFeedbackSchema = z
  .object({
    targetMode: DirectionModeSchema,
    issues: z.array(z.string().min(1)).min(1).max(5),
    note: z.string().max(1000),
  })
  .strict();

export const ImageFeedbackRevisionSchema = z
  .object({
    instruction: z.string().min(1).max(4000),
    targetMode: DirectionModeSchema,
    preserveOtherDirections: z.literal(true),
  })
  .strict();

export type ImageFeedback = z.infer<typeof ImageFeedbackSchema>;
export type ImageFeedbackRevision = z.infer<typeof ImageFeedbackRevisionSchema>;

export const buildImageFeedbackRevision = (
  feedback: ImageFeedback,
): ImageFeedbackRevision =>
  ImageFeedbackRevisionSchema.parse({
    instruction: `根据图片预览反馈修正这个方向：${feedback.issues.join('；')}。${
      feedback.note.trim() ? `补充说明：${feedback.note.trim()}。` : ''
    }保留既有用户硬约束，不得改写固定文字或引入禁止元素。`,
    targetMode: feedback.targetMode,
    preserveOtherDirections: true,
  });

export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;
export type GenerateResponse = z.infer<typeof GenerateResponseSchema>;
