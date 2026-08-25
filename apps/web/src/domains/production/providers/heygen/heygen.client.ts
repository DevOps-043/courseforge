import { getHeygenApiKey } from "../../../../lib/server/env";
import {
  HEYGEN_API_BASE_URL,
  HEYGEN_DEFAULT_PAGE_SIZE,
  HEYGEN_REQUEST_TIMEOUT_MS,
  type HeygenCreateVideoRequest,
  type HeygenCreateVideoResponse,
  type HeygenGeneratedSpeech,
  type HeygenGenerateSpeechRequest,
  type HeygenVideoDetails,
} from "./heygen.types";
import {
  heygenApiErrorPayloadSchema,
  heygenCreateVideoProviderResponseSchema,
  heygenGenerateSpeechProviderResponseSchema,
  heygenVideoDetailsProviderResponseSchema,
  toRecord,
} from "./heygen.validators";

export class HeygenApiError extends Error {
  readonly providerCode?: string;
  readonly retryAfterSeconds?: number;
  readonly status: number;

  constructor(params: {
    message: string;
    providerCode?: string;
    retryAfterSeconds?: number;
    status: number;
  }) {
    super(params.message);
    this.name = "HeygenApiError";
    this.providerCode = params.providerCode;
    this.retryAfterSeconds = params.retryAfterSeconds;
    this.status = params.status;
  }
}

export interface HeygenClientOptions {
  accessToken?: string;
  apiKey?: string;
  baseUrl?: string;
  createVideoMaxAttempts?: number;
  createVideoRetryDelayMs?: number;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HeygenClient {
  private readonly accessToken?: string;
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly createVideoMaxAttempts: number;
  private readonly createVideoRetryDelayMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(options: HeygenClientOptions = {}) {
    this.accessToken = options.accessToken;
    this.apiKey = options.accessToken ? options.apiKey : options.apiKey || getHeygenApiKey();
    this.baseUrl = (options.baseUrl || HEYGEN_API_BASE_URL).replace(/\/$/, "");
    this.createVideoMaxAttempts = Math.max(
      1,
      Math.min(options.createVideoMaxAttempts ?? 1, 3),
    );
    this.createVideoRetryDelayMs = Math.max(
      0,
      options.createVideoRetryDelayMs ?? 500,
    );
    this.fetchImpl = options.fetchImpl || fetch;
    this.timeoutMs = options.timeoutMs ?? HEYGEN_REQUEST_TIMEOUT_MS;
  }

  async listAvatarLooks() {
    return this.requestJson({
      method: "GET",
      path: `/v3/avatars/looks?ownership=private&limit=${HEYGEN_DEFAULT_PAGE_SIZE}`,
    });
  }

  async listVoices() {
    return this.requestJson({
      method: "GET",
      path: `/v3/voices?type=private&engine=starfish&limit=${HEYGEN_DEFAULT_PAGE_SIZE}`,
    });
  }

  async createAvatarVideo(
    payload: HeygenCreateVideoRequest,
    idempotencyKey: string,
  ): Promise<HeygenCreateVideoResponse> {
    let raw: unknown;
    for (let attempt = 1; attempt <= this.createVideoMaxAttempts; attempt += 1) {
      try {
        raw = await this.requestJson({
          body: payload,
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          method: "POST",
          path: "/v3/videos",
        });
        break;
      } catch (error) {
        const retryable =
          error instanceof HeygenApiError &&
          (error.status === 408 ||
            error.status === 429 ||
            error.status >= 500);
        if (!retryable || attempt >= this.createVideoMaxAttempts) throw error;

        const providerDelay = (error.retryAfterSeconds || 0) * 1_000;
        await sleep(
          Math.min(
            Math.max(providerDelay, this.createVideoRetryDelayMs),
            5_000,
          ),
        );
      }
    }

    const parsed = heygenCreateVideoProviderResponseSchema.parse(raw);

    return {
      outputFormat: parsed.data.output_format || null,
      providerStatus: parsed.data.status || null,
      raw: toRecord(raw) || {},
      videoId: parsed.data.video_id,
    };
  }

  async generateSpeech(
    payload: HeygenGenerateSpeechRequest,
  ): Promise<HeygenGeneratedSpeech> {
    const raw = await this.requestJson({
      body: payload,
      headers: { "Content-Type": "application/json" },
      method: "POST",
      path: "/v3/voices/speech",
    });
    const parsed = heygenGenerateSpeechProviderResponseSchema.parse(raw);

    return {
      audioUrl: parsed.data.audio_url,
      durationSeconds: parsed.data.duration,
      raw: toRecord(raw) || {},
      requestId: parsed.data.request_id || null,
      wordTimestamps: parsed.data.word_timestamps || [],
    };
  }

  async getVideo(videoId: string): Promise<HeygenVideoDetails> {
    const raw = await this.requestJson({
      method: "GET",
      path: `/v3/videos/${encodeURIComponent(videoId)}`,
    });
    const parsed = heygenVideoDetailsProviderResponseSchema.parse(raw);
    const details = toRecord(parsed.data) || toRecord(raw) || {};
    const errorPayload = toRecord(details.error);

    return {
      captionedVideoUrl: readString(details.captioned_video_url),
      durationSeconds:
        readNumber(details.duration) ?? readNumber(details.duration_seconds),
      failureCode:
        readString(details.error_code) ||
        readString(details.failure_code) ||
        readString(errorPayload?.code),
      failureMessage:
        readString(details.error_message) ||
        readString(details.failure_message) ||
        readString(errorPayload?.message),
      gifUrl: readString(details.gif_url),
      outputFormat: readString(details.output_format),
      raw: details,
      status: readString(details.status) || "unknown",
      subtitleUrl: readString(details.subtitle_url),
      thumbnailUrl: readString(details.thumbnail_url),
      videoId: readString(details.video_id) || readString(details.id) || videoId,
      videoPageUrl: readString(details.video_page_url),
      videoUrl: readString(details.video_url),
    };
  }

  private async requestJson(params: {
    body?: unknown;
    headers?: Record<string, string>;
    method: "GET" | "POST";
    path: string;
  }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}${params.path}`, {
        body:
          params.body === undefined ? undefined : JSON.stringify(params.body),
        headers: {
          Accept: "application/json",
          ...this.buildAuthHeader(),
          ...params.headers,
        } as Record<string, string>,
        method: params.method,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw await this.buildApiError(response);
      }

      return response.json() as Promise<unknown>;
    } catch (error) {
      if (error instanceof HeygenApiError) {
        throw error;
      }

      if (error instanceof Error && error.name === "AbortError") {
        throw new HeygenApiError({
          message: "La solicitud a HeyGen excedio el tiempo limite.",
          status: 408,
        });
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildAuthHeader(): Record<string, string> {
    if (this.accessToken) {
      return { Authorization: `Bearer ${this.accessToken}` };
    }

    return { "X-Api-Key": this.apiKey || "" };
  }

  private async buildApiError(response: Response) {
    const retryAfterSeconds = parseRetryAfter(
      response.headers.get("Retry-After"),
    );
    const rawBody = await response.text();
    const parsedBody = parseErrorPayload(rawBody);

    return new HeygenApiError({
      message: buildSafeProviderMessage(response.status, parsedBody),
      providerCode: parsedBody.providerCode,
      retryAfterSeconds,
      status: response.status,
    });
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const retryAfterSeconds = Number.parseInt(value, 10);
  return Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined;
}

function parseErrorPayload(rawBody: string) {
  try {
    const parsed = heygenApiErrorPayloadSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      return { message: null, providerCode: undefined };
    }

    const payload = parsed.data;
    const providerCode =
      typeof payload.code === "string" || typeof payload.code === "number"
        ? String(payload.code)
        : undefined;
    const nestedError = toRecord(payload.error);
    const nestedMessage =
      typeof nestedError?.message === "string" ? nestedError.message : null;

    return {
      message: payload.message || nestedMessage || null,
      providerCode,
    };
  } catch {
    return { message: null, providerCode: undefined };
  }
}

function buildSafeProviderMessage(
  status: number,
  parsedBody: { message: string | null },
) {
  if (parsedBody.message) {
    return `HeyGen rechazo la solicitud (${status}): ${parsedBody.message}`;
  }

  return `HeyGen rechazo la solicitud (${status}).`;
}
