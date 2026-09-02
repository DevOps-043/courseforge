import { getSupabaseServiceRoleKey, requireEnv } from "./env.ts";

export const TUS_CHUNK_BYTES = 6 * 1024 * 1024;
export const MAX_FINAL_VIDEO_BYTES = 2 * 1024 * 1024 * 1024;

interface TusUploadInput {
  bucket: string;
  contentType: string;
  objectPath: string;
  size: number;
}

export async function createTusUpload(input: TusUploadInput): Promise<string> {
  const response = await fetch(`${getStorageOrigin()}/storage/v1/upload/resumable`, {
    headers: storageHeaders({
      "Upload-Length": String(input.size),
      "Upload-Metadata": [
        metadata("bucketName", input.bucket),
        metadata("objectName", input.objectPath),
        metadata("contentType", input.contentType),
        metadata("cacheControl", "3600"),
      ].join(","),
      "X-Upsert": "true",
    }),
    method: "POST",
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new StorageHttpError(`Storage create upload: HTTP ${response.status}.`, response.status);
  const location = response.headers.get("location");
  if (!location) throw new Error("Storage did not return a resumable upload location.");
  return new URL(location, getStorageOrigin()).toString();
}

export async function readTusOffset(uploadUrl: string): Promise<number> {
  assertSupabaseUploadUrl(uploadUrl);
  const response = await fetch(uploadUrl, {
    headers: storageHeaders(),
    method: "HEAD",
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404 || response.status === 410) throw new TusUploadExpiredError();
  if (!response.ok) throw new StorageHttpError(`Storage inspect upload: HTTP ${response.status}.`, response.status);
  const offset = Number(response.headers.get("upload-offset"));
  if (!Number.isSafeInteger(offset) || offset < 0) throw new Error("Storage returned an invalid upload offset.");
  return offset;
}

export async function appendTusChunk(uploadUrl: string, offset: number, bytes: Uint8Array): Promise<number> {
  assertSupabaseUploadUrl(uploadUrl);
  const response = await fetch(uploadUrl, {
    body: toArrayBuffer(bytes),
    headers: storageHeaders({ "Content-Type": "application/offset+octet-stream", "Upload-Offset": String(offset) }),
    method: "PATCH",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new StorageHttpError(`Storage upload chunk: HTTP ${response.status}.`, response.status);
  const nextOffset = Number(response.headers.get("upload-offset"));
  if (!Number.isSafeInteger(nextOffset) || nextOffset !== offset + bytes.byteLength) {
    throw new Error("Storage returned an unexpected upload offset.");
  }
  return nextOffset;
}

export function getPublicStorageUrl(bucket: string, objectPath: string): string {
  const encodedPath = objectPath.split("/").map(encodeURIComponent).join("/");
  return `${requireEnv("SUPABASE_URL")}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`;
}

function storageHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const key = getSupabaseServiceRoleKey();
  return {
    Authorization: `Bearer ${key}`,
    "Tus-Resumable": "1.0.0",
    apikey: key,
    ...extra,
  };
}

function metadata(name: string, value: string): string {
  return `${name} ${btoa(value)}`;
}

function assertSupabaseUploadUrl(rawUrl: string): void {
  const upload = new URL(rawUrl);
  const project = new URL(requireEnv("SUPABASE_URL"));
  const allowedOrigins = new Set([project.origin, getStorageOrigin()]);
  if (upload.protocol !== "https:" || !allowedOrigins.has(upload.origin) || !upload.pathname.startsWith("/storage/v1/upload/resumable/")) {
    throw new Error("Refusing an untrusted resumable upload URL.");
  }
}

function getStorageOrigin(): string {
  const project = new URL(requireEnv("SUPABASE_URL"));
  const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(project.hostname);
  return match ? `https://${match[1]}.storage.supabase.co` : project.origin;
}

export class TusUploadExpiredError extends Error {
  constructor() {
    super("Resumable Storage upload expired.");
  }
}

export class StorageHttpError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}
