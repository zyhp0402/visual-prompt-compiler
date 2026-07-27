import {
  createDeterministicFakePlanner,
  type Planner,
} from '@vpc/compiler-core';
import {
  CompileResponseSchema,
  ErrorResponseSchema,
  ReviseResponseSchema,
} from '@vpc/contracts';
import { OpenAIAdapterError } from '@vpc/openai-adapter';
import type { Writable } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';

import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

const request = {
  brief: '未来城市海报',
  taskType: 'poster',
  aspectRatio: '3:4',
  mandatoryText: [],
  mandatoryElements: [],
  forbiddenElements: [],
  creativity: 50,
  allowAssumptions: true,
  outputLanguage: 'zh-CN',
};

const createApp = (planner: Planner, config = {}, logStream?: Writable) => {
  const app = buildApp({
    plannerFactory: () => planner,
    config: {
      allowedOrigins: ['chrome-extension://test'],
      logLevel: 'silent',
      ...config,
    },
    ...(logStream ? { logStream } : {}),
    requestId: () => '123e4567-e89b-12d3-a456-426614174000',
  });
  apps.push(app);
  return app;
};

describe('API integration', () => {
  it('compiles with an injected planner and validates input', async () => {
    const app = createApp(createDeterministicFakePlanner());
    const success = await app.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });
    expect(success.statusCode).toBe(200);
    expect(success.json().directions).toHaveLength(3);
    expect(CompileResponseSchema.safeParse(success.json()).success).toBe(true);
    const revised = await app.inject({
      method: 'POST',
      url: '/v1/revise',
      payload: {
        previousSpec: success.json().normalizedBrief,
        previousDirections: success.json().directions,
        instruction: '改为蓝白色',
        targetMode: 'creative',
        preserveOtherDirections: true,
      },
    });
    expect(revised.statusCode).toBe(200);
    expect(revised.json().changes).toHaveLength(1);
    expect(ReviseResponseSchema.safeParse(revised.json()).success).toBe(true);

    const invalid = await app.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: {},
    });
    expect(invalid.statusCode).toBe(400);
    expect(ErrorResponseSchema.safeParse(invalid.json()).success).toBe(true);
  });

  it('requires server credentials and model configuration', () => {
    expect(() => loadConfig({})).toThrow();
    expect(
      loadConfig({
        OPENAI_API_KEY: 'test-key',
        OPENAI_TEXT_MODEL: 'configured-model',
      }),
    ).toMatchObject({
      timeoutMs: 45_000,
      rateLimitMax: 20,
      bodyLimit: 32_768,
      reviseBodyLimit: 524_288,
    });
  });

  it.each([
    [new OpenAIAdapterError('MODEL_TIMEOUT', true), 504, 'MODEL_TIMEOUT'],
    [new OpenAIAdapterError('RATE_LIMITED', true), 429, 'RATE_LIMITED'],
    [new OpenAIAdapterError('UPSTREAM_ERROR', true), 502, 'UPSTREAM_ERROR'],
    [
      new OpenAIAdapterError('MODEL_OUTPUT_INVALID', false),
      502,
      'MODEL_OUTPUT_INVALID',
    ],
  ] as const)('normalizes planner errors', async (error, status, code) => {
    const planner: Planner = {
      ...createDeterministicFakePlanner(),
      buildVisualSpec: async () => {
        throw error;
      },
    };
    const response = await createApp(planner).inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });
    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
  });

  it.each([
    [new OpenAIAdapterError('MODEL_TIMEOUT', true), 504, 'MODEL_TIMEOUT'],
    [new OpenAIAdapterError('RATE_LIMITED', true), 429, 'RATE_LIMITED'],
  ] as const)(
    'preserves revise planner error mapping',
    async (error, status, code) => {
      const base = createDeterministicFakePlanner();
      const planner: Planner = {
        ...base,
        reviseSpec: async () => {
          throw error;
        },
      };
      const app = createApp(planner);
      const compiled = await app.inject({
        method: 'POST',
        url: '/v1/compile',
        payload: request,
      });
      const revised = await app.inject({
        method: 'POST',
        url: '/v1/revise',
        payload: {
          previousSpec: compiled.json().normalizedBrief,
          previousDirections: compiled.json().directions,
          instruction: '修改',
          targetMode: null,
          preserveOtherDirections: false,
        },
      });

      expect(revised.statusCode).toBe(status);
      expect(revised.json().error.code).toBe(code);
    },
  );

  it('enforces CORS, rate limit, and payload size', async () => {
    const app = createApp(createDeterministicFakePlanner(), {
      rateLimitMax: 1,
    });
    const cors = await app.inject({
      method: 'OPTIONS',
      url: '/v1/compile',
      headers: {
        origin: 'https://not-allowed.example',
        'access-control-request-method': 'POST',
      },
    });
    expect(cors.headers['access-control-allow-origin']).toBeUndefined();
    const allowedCors = await app.inject({
      method: 'OPTIONS',
      url: '/v1/compile',
      headers: {
        origin: 'chrome-extension://test',
        'access-control-request-method': 'POST',
      },
    });
    expect(allowedCors.headers['access-control-allow-origin']).toBe(
      'chrome-extension://test',
    );

    await app.inject({ method: 'GET', url: '/health' });
    await app.inject({ method: 'GET', url: '/missing' });
    const firstPaid = await app.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });
    const limited = await app.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });
    expect(firstPaid.statusCode).toBe(200);
    expect(limited.statusCode).toBe(429);
    expect(
      (await app.inject({ method: 'GET', url: '/health' })).statusCode,
    ).toBe(200);

    const payloadApp = createApp(createDeterministicFakePlanner(), {
      rateLimitMax: 20,
      bodyLimit: 128,
    });
    const oversized = await payloadApp.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: { ...request, brief: 'x'.repeat(500) },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('creates isolated planners for sequential and concurrent requests', async () => {
    const usages: number[] = [];
    let created = 0;
    const app = buildApp({
      plannerFactory: () => {
        const planner = createDeterministicFakePlanner();
        const token = ++created;
        return { ...planner, usage: () => ({ latencyMs: token }) };
      },
      config: {
        allowedOrigins: ['chrome-extension://test'],
        logLevel: 'silent',
      },
      requestId: () => crypto.randomUUID(),
    });
    apps.push(app);

    const responses = await Promise.all([
      app.inject({ method: 'POST', url: '/v1/compile', payload: request }),
      app.inject({ method: 'POST', url: '/v1/compile', payload: request }),
    ]);
    usages.push(
      ...responses.map((response) => response.json().usage.latencyMs),
    );
    const third = await app.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });
    usages.push(third.json().usage.latencyMs);

    expect(created).toBe(3);
    expect(usages.sort()).toEqual([1, 2, 3]);
  });

  it('accepts a large valid revise payload while keeping the compile limit small', async () => {
    const app = createApp(createDeterministicFakePlanner());
    const nearLimitRequest = {
      ...request,
      brief: 'x'.repeat(9_000),
      mandatoryText: Array.from(
        { length: 10 },
        (_, index) => `${index}-${'y'.repeat(1_400)}`,
      ),
    };
    const compileBytes = Buffer.byteLength(JSON.stringify(nearLimitRequest));
    expect(compileBytes).toBeGreaterThan(20_000);
    expect(compileBytes).toBeLessThan(32_768);

    const compiled = await app.inject({
      method: 'POST',
      url: '/v1/compile',
      payload: nearLimitRequest,
    });
    expect(compiled.statusCode).toBe(200);
    const revisePayload = {
      previousSpec: compiled.json().normalizedBrief,
      previousDirections: compiled.json().directions,
      instruction: '只改创意方向',
      targetMode: 'creative',
      preserveOtherDirections: true,
    };
    expect(Buffer.byteLength(JSON.stringify(revisePayload))).toBeGreaterThan(
      32_768,
    );
    const revised = await app.inject({
      method: 'POST',
      url: '/v1/revise',
      payload: revisePayload,
    });
    expect(revised.statusCode).toBe(200);

    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/revise',
      payload: {
        ...revisePayload,
        instruction: 'z'.repeat(530_000),
      },
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('maps invalid assembled responses to MODEL_OUTPUT_INVALID', async () => {
    const invalidPlanner: Planner = {
      ...createDeterministicFakePlanner(),
      usage: () => ({ latencyMs: -1 }),
    };
    const compile = await createApp(invalidPlanner).inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });
    expect(compile.statusCode).toBe(502);
    expect(compile.json().error.code).toBe('MODEL_OUTPUT_INVALID');
  });

  it('logs successful model requests with repair telemetry', async () => {
    const chunks: string[] = [];
    const stream = new (await import('node:stream')).Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const planner: Planner = {
      ...createDeterministicFakePlanner(),
      usage: () => ({ latencyMs: 7, repairAttempts: 1 }),
    };
    const response = await createApp(
      planner,
      { logLevel: 'info' },
      stream,
    ).inject({
      method: 'POST',
      url: '/v1/compile',
      payload: request,
    });

    expect(response.statusCode).toBe(200);
    const record = chunks
      .map((chunk) => JSON.parse(chunk) as Record<string, unknown>)
      .find(({ status }) => status === 'success');
    expect(record).toMatchObject({
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      model: 'deterministic-fake-planner',
      promptVersion: 'prompt-1',
      schemaVersion: '1.0.0',
      status: 'success',
      latencyMs: 7,
      repairStatus: 'attempted',
    });
    expect(record).not.toHaveProperty('route');
  });

  it('emits allowlisted logs without sensitive request or error content', async () => {
    const chunks: string[] = [];
    const stream = new (await import('node:stream')).Writable({
      write(chunk, _encoding, callback) {
        chunks.push(String(chunk));
        callback();
      },
    });
    const secret = 'SENSITIVE-BRIEF-AND-KEY';
    const planner: Planner = {
      ...createDeterministicFakePlanner(),
      usage: () => ({
        latencyMs: 12,
        inputTokens: 34,
        outputTokens: 56,
        repairAttempts: 0,
      }),
      buildVisualSpec: async () => {
        throw new Error(secret);
      },
    };
    const response = await createApp(
      planner,
      { logLevel: 'info' },
      stream,
    ).inject({
      method: 'POST',
      url: '/v1/compile',
      payload: { ...request, brief: secret },
    });
    expect(response.statusCode).toBe(503);
    const logs = chunks.join('');
    expect(logs).not.toContain(secret);
    expect(logs).not.toContain('brief');
    expect(logs).not.toContain('mandatoryText');
    expect(logs).not.toContain('"err"');
    const record = chunks
      .map((chunk) => JSON.parse(chunk) as Record<string, unknown>)
      .find(({ errorCode }) => errorCode === 'SERVICE_UNAVAILABLE');
    expect(record).toMatchObject({
      requestId: '123e4567-e89b-12d3-a456-426614174000',
      model: 'deterministic-fake-planner',
      promptVersion: 'prompt-1',
      schemaVersion: '1.0.0',
      status: 'failure',
      errorCode: 'SERVICE_UNAVAILABLE',
      latencyMs: 12,
      inputTokens: 34,
      outputTokens: 56,
      repairStatus: 'not_completed',
    });
    expect(record).not.toHaveProperty('route');
    expect(record).not.toHaveProperty('statusCode');
    expect(record).not.toHaveProperty('retryable');
  });
});
