import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';

import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import {
  compileBrief,
  InvalidCompilationError,
  PROMPT_VERSION,
  reviseCompilation,
  type Planner,
} from '@vpc/compiler-core';
import {
  CompileRequestSchema,
  CompileResponseSchema,
  ErrorResponseSchema,
  ReviseRequestSchema,
  ReviseResponseSchema,
  type CompileResponse,
  type ErrorResponse,
  type ReviseResponse,
} from '@vpc/contracts';
import { OpenAIAdapterError } from '@vpc/openai-adapter';
import Fastify, {
  LogController,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';
import { ZodError } from 'zod';

import type { ApiConfig } from './config.js';

const defaultConfig: Omit<ApiConfig, 'apiKey' | 'textModel'> = {
  host: '127.0.0.1',
  port: 8787,
  allowedOrigins: [],
  timeoutMs: 45_000,
  rateLimitMax: 20,
  bodyLimit: 32_768,
  reviseBodyLimit: 524_288,
  logLevel: 'info',
};

type BuildOptions = {
  plannerFactory?: () => Planner;
  config?: Partial<ApiConfig>;
  requestId?: () => string;
  logStream?: Writable;
};

const errorResponse = (
  requestId: string,
  code: ErrorResponse['error']['code'],
  retryable: boolean,
  details: string[] = [],
): ErrorResponse =>
  ErrorResponseSchema.parse({
    requestId,
    error: { code, message: code, retryable, details },
  });

const parseCompileResponse = (value: unknown): CompileResponse => {
  const parsed = CompileResponseSchema.safeParse(value);
  if (!parsed.success) throw new InvalidCompilationError();
  return parsed.data;
};

const parseReviseResponse = (value: unknown): ReviseResponse => {
  const parsed = ReviseResponseSchema.safeParse(value);
  if (!parsed.success) throw new InvalidCompilationError();
  return parsed.data;
};

export function buildApp(options: BuildOptions = {}): FastifyInstance {
  const config = { ...defaultConfig, ...options.config };
  const logger = {
    level: config.logLevel,
    ...(options.logStream ? { stream: options.logStream } : {}),
  };
  const app = Fastify({
    logger,
    logController: new LogController({ disableRequestLogging: true }),
    bodyLimit: config.bodyLimit,
  });
  const nextRequestId = options.requestId ?? randomUUID;
  const requestIds = new WeakMap<object, string>();
  const requestPlanners = new WeakMap<object, Planner>();
  const idFor = (request: FastifyRequest): string =>
    requestIds.get(request.raw) ?? nextRequestId();

  app.addHook('onRequest', async (request) => {
    requestIds.set(request.raw, nextRequestId());
  });

  void app.register(cors, {
    origin: config.allowedOrigins.length === 0 ? false : config.allowedOrigins,
  });
  void app.register(rateLimit, { global: false });

  app.after(() => {
    app.get('/health', async () => ({ status: 'ok' as const }));

    if (!options.plannerFactory) return;
    const paidRouteConfig = {
      rateLimit: { max: config.rateLimitMax, timeWindow: '1 minute' },
    };

    app.post('/v1/compile', { config: paidRouteConfig }, async (request) => {
      const input = CompileRequestSchema.parse(request.body);
      const planner = options.plannerFactory!();
      const requestId = idFor(request);
      requestPlanners.set(request.raw, planner);
      const result = parseCompileResponse(
        await compileBrief(input, {
          planner,
          requestId: () => requestId,
        }),
      );
      request.log.info(
        {
          requestId,
          model: result.usage.model,
          promptVersion: result.promptVersion,
          schemaVersion: result.schemaVersion,
          status: 'success',
          latencyMs: result.usage.latencyMs,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          repairStatus:
            (planner.usage?.().repairAttempts ?? 0) > 0
              ? 'attempted'
              : 'not_needed',
        },
        'model request completed',
      );
      return result;
    });

    app.post(
      '/v1/revise',
      {
        bodyLimit: config.reviseBodyLimit,
        config: paidRouteConfig,
      },
      async (request) => {
        const input = ReviseRequestSchema.parse(request.body);
        const planner = options.plannerFactory!();
        const requestId = idFor(request);
        requestPlanners.set(request.raw, planner);
        const result = parseReviseResponse(
          await reviseCompilation(input, {
            planner,
            requestId: () => requestId,
          }),
        );
        request.log.info(
          {
            requestId,
            model: result.result.usage.model,
            promptVersion: result.result.promptVersion,
            schemaVersion: result.result.schemaVersion,
            status: 'success',
            latencyMs: result.result.usage.latencyMs,
            inputTokens: result.result.usage.inputTokens,
            outputTokens: result.result.usage.outputTokens,
            repairStatus:
              (planner.usage?.().repairAttempts ?? 0) > 0
                ? 'attempted'
                : 'not_needed',
          },
          'model request completed',
        );
        return result;
      },
    );
  });

  app.setErrorHandler((error, request, reply) => {
    const requestId = idFor(request);
    const statusCode =
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : undefined;

    let status = 503;
    let code: ErrorResponse['error']['code'] = 'SERVICE_UNAVAILABLE';
    let retryable = true;
    let details: string[] = [];
    if (error instanceof ZodError) {
      status = 400;
      code = 'INVALID_REQUEST';
      retryable = false;
      details = ['Invalid request'];
    } else if (error instanceof OpenAIAdapterError) {
      status =
        error.code === 'RATE_LIMITED'
          ? 429
          : error.code === 'MODEL_TIMEOUT'
            ? 504
            : error.code === 'CONTENT_REJECTED'
              ? 422
              : 502;
      code = error.code;
      retryable = error.retryable;
    } else if (error instanceof InvalidCompilationError) {
      status = 502;
      code = 'MODEL_OUTPUT_INVALID';
      retryable = false;
    } else if (statusCode === 413) {
      status = 413;
      code = 'PAYLOAD_TOO_LARGE';
      retryable = false;
    } else if (statusCode === 429) {
      status = 429;
      code = 'RATE_LIMITED';
      retryable = true;
    }

    const planner = requestPlanners.get(request.raw);
    const usage = planner?.usage?.();
    request.log.error(
      {
        requestId,
        model: planner?.model ?? config.textModel,
        promptVersion: PROMPT_VERSION,
        schemaVersion: '1.0.0',
        status: 'failure',
        errorCode: code,
        latencyMs: usage?.latencyMs,
        inputTokens: usage?.inputTokens,
        outputTokens: usage?.outputTokens,
        repairStatus:
          (usage?.repairAttempts ?? 0) > 0 ? 'attempted' : 'not_completed',
      },
      'request failed',
    );
    void reply
      .status(status)
      .send(errorResponse(requestId, code, retryable, details));
  });

  return app;
}
