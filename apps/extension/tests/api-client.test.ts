import { describe, expect, it, vi } from 'vitest';

import {
  ApiClientError,
  compileRequest,
  type ClientErrorKind,
} from '../src/api-client.js';
import { validCompileRequest, validCompileResponse } from './fixtures.js';

const response = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('extension API client', () => {
  it('accepts a response only after contracts validation', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(response(validCompileResponse)),
    ) as typeof fetch;
    await expect(
      compileRequest(validCompileRequest, { fetcher }),
    ).resolves.toEqual(validCompileResponse);
    expect(fetcher).toHaveBeenCalledWith(
      'http://127.0.0.1:8787/v1/compile',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it.each([
    ['MODEL_TIMEOUT', 504, 'timeout'],
    ['RATE_LIMITED', 429, 'rate_limited'],
    ['MODEL_OUTPUT_INVALID', 502, 'invalid_output'],
    ['UPSTREAM_ERROR', 502, 'upstream'],
    ['INVALID_REQUEST', 400, 'invalid_request'],
  ] as const)('maps %s into a stable UI state', async (code, status, kind) => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        response(
          {
            requestId: '123e4567-e89b-12d3-a456-426614174000',
            error: {
              code,
              message: code,
              retryable: code !== 'INVALID_REQUEST',
              details: [],
            },
          },
          status,
        ),
      ),
    ) as typeof fetch;

    await expect(
      compileRequest(validCompileRequest, { fetcher }),
    ).rejects.toMatchObject({ kind } satisfies { kind: ClientErrorKind });
  });

  it('rejects malformed successful output', async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(response({ directions: [] })),
    ) as typeof fetch;
    await expect(
      compileRequest(validCompileRequest, { fetcher }),
    ).rejects.toMatchObject({ kind: 'invalid_output', retryable: false });
  });

  it('distinguishes abort timeout from network failure', async () => {
    const hanging = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    ) as typeof fetch;
    await expect(
      compileRequest(validCompileRequest, {
        fetcher: hanging,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ kind: 'timeout' });

    const offline = vi.fn(() =>
      Promise.reject(new TypeError('failed to fetch')),
    ) as typeof fetch;
    await expect(
      compileRequest(validCompileRequest, { fetcher: offline }),
    ).rejects.toBeInstanceOf(ApiClientError);
    await expect(
      compileRequest(validCompileRequest, { fetcher: offline }),
    ).rejects.toMatchObject({ kind: 'offline' });
  });

  it('maps an abort while reading the response body to timeout', async () => {
    const headersOnly = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.resolve({
        ok: true,
        json: () =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () =>
              reject(new DOMException('body aborted', 'AbortError')),
            );
          }),
      } as Response),
    ) as typeof fetch;

    await expect(
      compileRequest(validCompileRequest, {
        fetcher: headersOnly,
        timeoutMs: 1,
      }),
    ).rejects.toMatchObject({ kind: 'timeout', retryable: true });
  });
});
