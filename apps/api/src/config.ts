import { z } from 'zod';

const positiveInteger = z.coerce.number().int().positive();

export const ApiConfigSchema = z
  .object({
    apiKey: z.string().min(1),
    textModel: z.string().min(1),
    host: z.string().min(1),
    port: z.number().int().min(1).max(65_535),
    allowedOrigins: z.array(z.string().min(1)),
    timeoutMs: positiveInteger,
    rateLimitMax: positiveInteger,
    bodyLimit: positiveInteger,
    reviseBodyLimit: positiveInteger,
    logLevel: z.enum([
      'trace',
      'debug',
      'info',
      'warn',
      'error',
      'fatal',
      'silent',
    ]),
  })
  .strict();

export type ApiConfig = z.infer<typeof ApiConfigSchema>;

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): ApiConfig =>
  ApiConfigSchema.parse({
    apiKey: env.OPENAI_API_KEY,
    textModel: env.OPENAI_TEXT_MODEL,
    host: env.API_HOST ?? '127.0.0.1',
    port: Number(env.API_PORT ?? 8787),
    allowedOrigins: (env.ALLOWED_EXTENSION_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    timeoutMs: env.REQUEST_TIMEOUT_MS ?? 45_000,
    rateLimitMax: env.RATE_LIMIT_MAX ?? 20,
    bodyLimit: env.REQUEST_BODY_LIMIT_BYTES ?? 32_768,
    reviseBodyLimit: env.REVISE_REQUEST_BODY_LIMIT_BYTES ?? 524_288,
    logLevel: env.LOG_LEVEL ?? 'info',
  });
