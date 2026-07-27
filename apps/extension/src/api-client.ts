import {
  CompileResponseSchema,
  ErrorResponseSchema,
  ReviseResponseSchema,
  type CompileRequest,
  type CompileResponse,
  type ErrorResponse,
  type ReviseRequest,
  type ReviseResponse,
} from '@vpc/contracts';

export const DEFAULT_API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') ||
  'http://127.0.0.1:8787';

export type ClientErrorKind =
  | 'timeout'
  | 'offline'
  | 'rate_limited'
  | 'invalid_output'
  | 'upstream'
  | 'invalid_request';

export class ApiClientError extends Error {
  constructor(
    readonly kind: ClientErrorKind,
    readonly retryable: boolean,
    readonly requestId?: string,
  ) {
    super(kind);
    this.name = 'ApiClientError';
  }
}

type Fetcher = typeof fetch;

const mappedKind = (
  response: ErrorResponse,
): Pick<ApiClientError, 'kind' | 'retryable'> => {
  switch (response.error.code) {
    case 'MODEL_TIMEOUT':
      return { kind: 'timeout', retryable: response.error.retryable };
    case 'RATE_LIMITED':
      return { kind: 'rate_limited', retryable: response.error.retryable };
    case 'MODEL_OUTPUT_INVALID':
      return { kind: 'invalid_output', retryable: response.error.retryable };
    case 'INVALID_REQUEST':
    case 'CONFLICTING_CONSTRAINTS':
    case 'PAYLOAD_TOO_LARGE':
    case 'CONTENT_REJECTED':
      return { kind: 'invalid_request', retryable: response.error.retryable };
    case 'UPSTREAM_ERROR':
    case 'SERVICE_UNAVAILABLE':
      return { kind: 'upstream', retryable: response.error.retryable };
  }
};

async function requestJson<T>(
  path: string,
  body: unknown,
  schema: { safeParse(value: unknown): { success: boolean; data?: T } },
  options: {
    baseUrl?: string;
    timeoutMs?: number;
    fetcher?: Fetcher;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  const timeout = globalThis.setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 48_000,
  );

  try {
    const response = await (options.fetcher ?? fetch)(
      `${options.baseUrl ?? DEFAULT_API_BASE_URL}${path}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      },
    );
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      throw new ApiClientError(
        response.ok ? 'invalid_output' : 'upstream',
        !response.ok,
      );
    }

    if (!response.ok) {
      const errorResult = ErrorResponseSchema.safeParse(payload);
      if (!errorResult.success) {
        throw new ApiClientError('upstream', true);
      }
      const mapped = mappedKind(errorResult.data);
      throw new ApiClientError(
        mapped.kind,
        mapped.retryable,
        errorResult.data.requestId,
      );
    }

    const result = schema.safeParse(payload);
    if (!result.success || result.data === undefined) {
      throw new ApiClientError('invalid_output', false);
    }
    return result.data;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiClientError('timeout', true);
    }
    throw new ApiClientError('offline', true);
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export const compileRequest = (
  input: CompileRequest,
  options?: {
    baseUrl?: string;
    timeoutMs?: number;
    fetcher?: Fetcher;
  },
): Promise<CompileResponse> =>
  requestJson('/v1/compile', input, CompileResponseSchema, options);

export const reviseRequest = (
  input: ReviseRequest,
  options?: {
    baseUrl?: string;
    timeoutMs?: number;
    fetcher?: Fetcher;
  },
): Promise<ReviseResponse> =>
  requestJson('/v1/revise', input, ReviseResponseSchema, options);
