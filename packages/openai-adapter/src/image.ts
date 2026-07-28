import OpenAI from 'openai';

import type { GenerateRequest, GenerateResponse } from '@vpc/contracts/image';

import { OpenAIAdapterError, normalizeOpenAIError } from './index.js';

type ImageApiResponse = {
  data?: Array<{ b64_json?: string | null }>;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
};

export type ImagesClient = {
  images: {
    generate(
      input: {
        model: string;
        prompt: string;
        n: 1;
        size: GenerateRequest['size'];
        quality: 'low';
        output_format: 'png';
      },
      options: { timeout: number },
    ): Promise<ImageApiResponse>;
  };
};

export type GeneratedImage = GenerateResponse['image'] & {
  usage: GenerateResponse['usage'];
};

export type ImageGenerator = {
  readonly model: string;
  generate(input: GenerateRequest): Promise<GeneratedImage>;
};

type ImageGeneratorOptions = {
  timeoutMs: number;
  now: () => number;
};

const MAX_IMAGE_BYTES = 16 * 1024 * 1024;
const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;

const expectedDimensions = {
  '1024x1024': [1024, 1024],
  '1536x1024': [1536, 1024],
  '1024x1536': [1024, 1536],
} as const;

const validPngChunks = (
  bytes: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): boolean => {
  let offset = 8;
  let sawHeader = false;
  let sawImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
    const next = offset + 12 + length;
    if (next > bytes.length) return false;
    if (!sawHeader) {
      if (
        type !== 'IHDR' ||
        length !== 13 ||
        bytes.readUInt32BE(offset + 8) !== expectedWidth ||
        bytes.readUInt32BE(offset + 12) !== expectedHeight
      ) {
        return false;
      }
      sawHeader = true;
    } else if (type === 'IDAT' && length > 0) {
      sawImageData = true;
    } else if (type === 'IEND') {
      return length === 0 && next === bytes.length && sawImageData;
    }
    offset = next;
  }
  return false;
};

const validPngBase64 = (
  value: unknown,
  size: GenerateRequest['size'],
): value is string => {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_IMAGE_BASE64_LENGTH ||
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return false;
  }
  const bytes = Buffer.from(value, 'base64');
  const [width, height] = expectedDimensions[size];
  return (
    bytes.length >= 58 &&
    bytes.length <= MAX_IMAGE_BYTES &&
    bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) &&
    validPngChunks(bytes, width, height)
  );
};

const normalizeImageError = (error: unknown): OpenAIAdapterError => {
  let code: unknown;
  try {
    code =
      (typeof error === 'object' && error !== null) ||
      typeof error === 'function'
        ? Reflect.get(error, 'code')
        : undefined;
  } catch {
    code = undefined;
  }
  if (code === 'moderation_blocked' || code === 'content_policy_violation') {
    return new OpenAIAdapterError('CONTENT_REJECTED', false);
  }
  return normalizeOpenAIError(error);
};

export class OpenAIImageGenerator implements ImageGenerator {
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly client: ImagesClient,
    readonly model: string,
    options: Partial<ImageGeneratorOptions> = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.now = options.now ?? Date.now;
  }

  async generate(input: GenerateRequest): Promise<GeneratedImage> {
    const started = this.now();
    let response: ImageApiResponse;
    try {
      response = await this.client.images.generate(
        {
          model: this.model,
          prompt: input.source.prompt,
          n: 1,
          size: input.size,
          quality: 'low',
          output_format: 'png',
        },
        { timeout: this.timeoutMs },
      );
    } catch (error) {
      throw normalizeImageError(error);
    }
    const base64 = response.data?.[0]?.b64_json;
    if (!validPngBase64(base64, input.size)) {
      throw new OpenAIAdapterError('MODEL_OUTPUT_INVALID', true);
    }
    return {
      base64,
      mimeType: 'image/png',
      size: input.size,
      usage: {
        model: this.model,
        latencyMs: Math.max(0, this.now() - started),
        ...(response.usage?.input_tokens === undefined
          ? {}
          : { inputTokens: response.usage.input_tokens }),
        ...(response.usage?.output_tokens === undefined
          ? {}
          : { outputTokens: response.usage.output_tokens }),
        ...(response.usage?.total_tokens === undefined
          ? {}
          : { totalTokens: response.usage.total_tokens }),
      },
    };
  }
}

export const createOpenAIImageGenerator = (config: {
  apiKey: string;
  model: string;
  timeoutMs: number;
  now?: () => number;
}): OpenAIImageGenerator =>
  new OpenAIImageGenerator(
    new OpenAI({
      apiKey: config.apiKey,
      timeout: config.timeoutMs,
      maxRetries: 0,
      logLevel: 'off',
    }) as unknown as ImagesClient,
    config.model,
    { timeoutMs: config.timeoutMs, ...(config.now ? { now: config.now } : {}) },
  );
