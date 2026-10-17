import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import {
  compositionEditorPatchOperationSchema,
  type CompositionEditorPatchOperation,
} from "./editor-patch.types";

const DOCUMENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECOVERY_SCHEMA_VERSION = 1;
const RECOVERY_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_RECOVERY_ENTRY_BYTES = 2 * 1024 * 1024;
const RECOVERY_KEY_PREFIX = "courseforge:composition-recovery:v1:";

const compositionRecoveryEntrySchema = z.object({
  baseDocumentHash: z.string().regex(DOCUMENT_HASH_PATTERN),
  createdAtMs: z.number().int().nonnegative(),
  draftId: z.string().uuid(),
  entryId: z.string().uuid(),
  expiresAtMs: z.number().int().positive(),
  operations: z.array(compositionEditorPatchOperationSchema).min(1).max(100),
  schemaVersion: z.literal(RECOVERY_SCHEMA_VERSION),
  source: z.enum(["AGENT", "USER"]),
  summary: z.string().trim().min(3).max(300),
  targetDocumentHash: z.string().regex(DOCUMENT_HASH_PATTERN),
}).strict();

export type CompositionRecoveryEntry = z.infer<typeof compositionRecoveryEntrySchema>;

export type CompositionRecoveryResolution =
  | { status: "ALREADY_COMMITTED"; entry: CompositionRecoveryEntry }
  | { status: "CONFLICT"; entry: CompositionRecoveryEntry }
  | { status: "NONE" }
  | { status: "REPLAY"; entry: CompositionRecoveryEntry };

export interface CompositionRecoveryStorage {
  getItem(key: string): string | null;
  removeItem(key: string): void;
  setItem(key: string, value: string): void;
}

export async function createCompositionRecoveryEntry(params: {
  baseDocumentHash: string;
  draftId: string;
  entryId?: string;
  nowMs?: number;
  operations: CompositionEditorPatchOperation[];
  source: "AGENT" | "USER";
  summary: string;
  targetDocument: CompositionEditorDocument;
}): Promise<CompositionRecoveryEntry> {
  const createdAtMs = params.nowMs ?? Date.now();
  return compositionRecoveryEntrySchema.parse({
    baseDocumentHash: params.baseDocumentHash,
    createdAtMs,
    draftId: params.draftId,
    entryId: params.entryId || crypto.randomUUID(),
    expiresAtMs: createdAtMs + RECOVERY_TTL_MS,
    operations: params.operations,
    schemaVersion: RECOVERY_SCHEMA_VERSION,
    source: params.source,
    summary: params.summary,
    targetDocumentHash: await hashCompositionDocumentInBrowser(params.targetDocument),
  });
}

export function clearCompositionRecoveryEntry(
  storage: CompositionRecoveryStorage,
  draftId: string,
  expectedEntryId?: string,
) {
  const key = recoveryStorageKey(draftId);
  if (expectedEntryId) {
    const current = readCompositionRecoveryEntry(storage, draftId);
    if (!current || current.entryId !== expectedEntryId) return false;
  }
  storage.removeItem(key);
  return true;
}

export function readCompositionRecoveryEntry(
  storage: CompositionRecoveryStorage,
  draftId: string,
  nowMs = Date.now(),
) {
  const key = recoveryStorageKey(draftId);
  const serialized = storage.getItem(key);
  if (!serialized) return null;
  try {
    const parsed = compositionRecoveryEntrySchema.parse(JSON.parse(serialized));
    if (parsed.draftId !== draftId || parsed.expiresAtMs <= nowMs) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function resolveCompositionRecovery(
  storage: CompositionRecoveryStorage,
  draftId: string,
  currentDocumentHash: string,
  nowMs = Date.now(),
): CompositionRecoveryResolution {
  const entry = readCompositionRecoveryEntry(storage, draftId, nowMs);
  if (!entry) return { status: "NONE" };
  if (entry.targetDocumentHash === currentDocumentHash) return { entry, status: "ALREADY_COMMITTED" };
  if (entry.baseDocumentHash === currentDocumentHash) return { entry, status: "REPLAY" };
  return { entry, status: "CONFLICT" };
}

export function writeCompositionRecoveryEntry(
  storage: CompositionRecoveryStorage,
  entry: CompositionRecoveryEntry,
) {
  const parsed = compositionRecoveryEntrySchema.parse(entry);
  const serialized = JSON.stringify(parsed);
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;
  if (serializedBytes > MAX_RECOVERY_ENTRY_BYTES) {
    throw new Error("El cambio excede el límite de recuperación automática de 2 MB.");
  }
  storage.setItem(recoveryStorageKey(parsed.draftId), serialized);
}

export async function hashCompositionDocumentInBrowser(document: CompositionEditorDocument) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(stableStringify(document)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function recoveryStorageKey(draftId: string) {
  return `${RECOVERY_KEY_PREFIX}${z.string().uuid().parse(draftId)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
