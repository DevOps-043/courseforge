import { createHash } from "node:crypto";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "./hyperframes.types";

const DEFAULT_HEYGEN_API_BASE_URL = "https://api.heygen.com";
const COMPLETION_RETRY_DELAYS_MS = [250, 500, 1_000] as const;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9_:.-]{1,255}$/;

export type HyperframesCloudRenderStatus =
  | "queued"
  | "rendering"
  | "completed"
  | "failed";

export interface HyperframesCloudRenderDetail {
  duration?: number | null;
  failure_message?: string | null;
  format: "mp4" | "webm" | "mov";
  render_id: string;
  status: HyperframesCloudRenderStatus;
  thumbnail_url?: string | null;
  video_url?: string | null;
}

export class HyperframesCloudApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "HyperframesCloudApiError";
  }
}

export class HyperframesCloudClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(params: {
    apiKey: string;
    baseUrl?: string;
    fetchImpl?: typeof fetch;
  }) {
    if (!params.apiKey.trim()) {
      throw new Error("Se requiere una API key de HeyGen para HyperFrames Cloud.");
    }

    this.apiKey = params.apiKey;
    this.baseUrl = (params.baseUrl || DEFAULT_HEYGEN_API_BASE_URL).replace(/\/+$/, "");
    this.fetchImpl = params.fetchImpl || fetch;
  }

  private readonly apiKey: string;

  async uploadProjectArchive(params: {
    bytes: Uint8Array;
    fileName: string;
    idempotencyKey: string;
  }) {
    validateIdempotencyKey(params.idempotencyKey);
    if (params.bytes.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) {
      throw new Error("El archivo HyperFrames supera el límite de 200 MiB.");
    }

    const checksum = createHash("sha256").update(params.bytes).digest("hex");
    const upload = await this.request<DirectUploadResponse>("POST", "/v3/assets/direct-uploads", {
      body: {
        checksum_sha256: checksum,
        content_type: "application/zip",
        filename: params.fileName,
        size_bytes: params.bytes.byteLength,
      },
      idempotencyKey: params.idempotencyKey,
    });

    if (upload.max_bytes < params.bytes.byteLength) {
      throw new Error("HeyGen rechazo el tamaño del archivo HyperFrames antes de cargarlo.");
    }

    const putResponse = await this.fetchImpl(upload.upload_url, {
      body: params.bytes as unknown as BodyInit,
      headers: normalizeHeaders(upload.upload_headers),
      method: "PUT",
    });
    if (!putResponse.ok) {
      throw new HyperframesCloudApiError(
        "No se pudo cargar el archivo HyperFrames al storage temporal de HeyGen.",
        putResponse.status,
      );
    }

    await this.completeAssetUpload(upload.asset_id, checksum);
    return { assetId: upload.asset_id, checksum, sizeBytes: params.bytes.byteLength };
  }

  async createRender(params: {
    aspectRatio: "16:9" | "9:16" | "1:1";
    assetId: string;
    callbackId?: string;
    callbackUrl?: string;
    composition?: string;
    format?: "mp4" | "webm" | "mov";
    fps?: number;
    idempotencyKey: string;
    quality?: "draft" | "standard" | "high";
    resolution?: "1080p" | "4k";
    title?: string;
    variables?: Record<string, unknown>;
  }) {
    validateIdempotencyKey(params.idempotencyKey);
    return this.request<{ render_id: string }>("POST", "/v3/hyperframes/renders", {
      body: {
        aspect_ratio: params.aspectRatio,
        callback_id: params.callbackId,
        callback_url: params.callbackUrl,
        composition: params.composition,
        format: params.format || "mp4",
        fps: params.fps,
        project: { asset_id: params.assetId, type: "asset_id" },
        quality: params.quality || "high",
        resolution: params.resolution || "1080p",
        title: params.title,
        variables: params.variables,
      },
      idempotencyKey: params.idempotencyKey,
    });
  }

  async getRender(renderId: string) {
    return this.request<HyperframesCloudRenderDetail>(
      "GET",
      `/v3/hyperframes/renders/${encodeURIComponent(renderId)}`,
    );
  }

  private async completeAssetUpload(assetId: string, checksum: string) {
    for (let attempt = 0; attempt <= COMPLETION_RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.request("POST", `/v3/assets/${encodeURIComponent(assetId)}/complete`, {
          body: { checksum_sha256: checksum },
        });
        return;
      } catch (error) {
        const canRetry =
          error instanceof HyperframesCloudApiError &&
          error.status === 409 &&
          attempt < COMPLETION_RETRY_DELAYS_MS.length;
        if (!canRetry) throw error;
        await sleep(COMPLETION_RETRY_DELAYS_MS[attempt]!);
      }
    }
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    options: { body?: unknown; idempotencyKey?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "X-Api-Key": this.apiKey,
    };
    if (options.body !== undefined) headers["Content-Type"] = "application/json";
    if (options.idempotencyKey) headers["Idempotency-Key"] = options.idempotencyKey;

    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      headers,
      method,
    });
    if (!response.ok) throw await toApiError(response);

    const payload = (await response.json()) as unknown;
    if (payload && typeof payload === "object" && "data" in payload) {
      return (payload as { data: T }).data;
    }
    return payload as T;
  }
}

interface DirectUploadResponse {
  asset_id: string;
  max_bytes: number;
  upload_headers: Record<string, unknown>;
  upload_url: string;
}

function normalizeHeaders(headers: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(headers).flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? [[key, String(value)]]
        : [],
    ),
  );
}

async function toApiError(response: Response) {
  const fallbackMessage = `HeyGen rechazó la solicitud (${response.status}).`;
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    return new HyperframesCloudApiError(
      typeof body.error?.message === "string" ? body.error.message : fallbackMessage,
      response.status,
      typeof body.error?.code === "string" ? body.error.code : undefined,
    );
  } catch {
    return new HyperframesCloudApiError(fallbackMessage, response.status);
  }
}

function validateIdempotencyKey(key: string) {
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new Error("La clave de idempotencia de HyperFrames no es válida.");
  }
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
