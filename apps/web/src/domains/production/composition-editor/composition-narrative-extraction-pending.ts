import { z } from "zod";
import { narrativeExtractionApplyRequestSchema, NARRATIVE_EXTRACTION_QUERY_MAX_BYTES,
  type NarrativeExtractionApplyRequest } from "./composition-narrative-extraction-contract";
import { narrativeFragmentApplyRequestSchema } from "./composition-narrative-fragment-command-contract";

export const narrativePendingCommandSchema = z.union([narrativeExtractionApplyRequestSchema, narrativeFragmentApplyRequestSchema]);
export type NarrativePendingCommand = z.infer<typeof narrativePendingCommandSchema>;

export const narrativeExtractionPendingScopeSchema = z.object({
  organizationId: z.string().uuid(), userId: z.string().uuid(), draftId: z.string().uuid(),
}).strict();
export type NarrativeExtractionPendingScope = z.infer<typeof narrativeExtractionPendingScopeSchema>;
const pendingSchema = z.object({ contract: z.literal("NARRATIVE_EXTRACTION_PENDING_V1"),
  scope: narrativeExtractionPendingScopeSchema, command: narrativePendingCommandSchema }).strict();
const MAX_PENDING_BYTES = NARRATIVE_EXTRACTION_QUERY_MAX_BYTES + 1024;
export type NarrativeExtractionPendingStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type NarrativeExtractionPendingRead = { status: "EMPTY" } | { status: "UNAVAILABLE" }
  | { status: "PENDING"; command: NarrativeExtractionApplyRequest };
export type NarrativeCommandPendingRead = { status: "EMPTY" } | { status: "UNAVAILABLE" }
  | { status: "PENDING"; command: NarrativePendingCommand };

export function narrativeExtractionPendingKey(scope: NarrativeExtractionPendingScope): string {
  const parsed = narrativeExtractionPendingScopeSchema.parse(scope);
  return `courseforge:narrative-extraction:v1:${parsed.organizationId}:${parsed.userId}:${parsed.draftId}`;
}

/** Recovery pointer only: no transcript, document, operations, asset URLs or credentials. No automatic TTL. */
export function readNarrativeCommandPending(storage: NarrativeExtractionPendingStorage, scope: NarrativeExtractionPendingScope): NarrativeCommandPendingRead {
  try {
    const raw = storage.getItem(narrativeExtractionPendingKey(scope));
    if (raw === null) return { status: "EMPTY" };
    if (new TextEncoder().encode(raw).byteLength > MAX_PENDING_BYTES) return { status: "UNAVAILABLE" };
    const parsed = pendingSchema.safeParse(JSON.parse(raw));
    if (!parsed.success || narrativeExtractionPendingKey(parsed.data.scope) !== narrativeExtractionPendingKey(scope)) return { status: "UNAVAILABLE" };
    return { status: "PENDING", command: parsed.data.command };
  } catch { return { status: "UNAVAILABLE" }; }
}

/** Legacy voice callers fail closed on an audiovisual pointer instead of overwriting it. */
export function readNarrativeExtractionPending(storage: NarrativeExtractionPendingStorage, scope: NarrativeExtractionPendingScope): NarrativeExtractionPendingRead {
  const pending = readNarrativeCommandPending(storage, scope);
  if (pending.status !== "PENDING") return pending;
  return pending.command.contract === "NARRATIVE_VOICE_EXTRACTION_APPLY_V1" ? { status: "PENDING", command: pending.command }
    : { status: "UNAVAILABLE" };
}

/** Caller must hold the browser's exclusive draft lock across reserve + HTTP + resolution. */
export function reserveNarrativeExtractionPending(storage: NarrativeExtractionPendingStorage, scope: NarrativeExtractionPendingScope,
  command: NarrativeExtractionApplyRequest): boolean {
  return reserveNarrativeCommandPending(storage, scope, command);
}
export function reserveNarrativeCommandPending(storage: NarrativeExtractionPendingStorage, scope: NarrativeExtractionPendingScope,
  command: NarrativePendingCommand): boolean {
  try {
    const entry = pendingSchema.parse({ contract: "NARRATIVE_EXTRACTION_PENDING_V1", scope, command });
    const serialized = JSON.stringify(entry);
    if (new TextEncoder().encode(serialized).byteLength > MAX_PENDING_BYTES
      || readNarrativeCommandPending(storage, scope).status !== "EMPTY") return false;
    const key = narrativeExtractionPendingKey(scope);
    storage.setItem(key, serialized);
    return storage.getItem(key) === serialized;
  } catch { return false; }
}

/** Clear only after confirmed receipt + current document reload, or proven pre-dispatch cancellation. */
export function clearNarrativeExtractionPending(storage: NarrativeExtractionPendingStorage, scope: NarrativeExtractionPendingScope,
  command: NarrativeExtractionApplyRequest): boolean {
  return clearNarrativeCommandPending(storage, scope, command);
}
export function clearNarrativeCommandPending(storage: NarrativeExtractionPendingStorage, scope: NarrativeExtractionPendingScope,
  command: NarrativePendingCommand): boolean {
  try {
    const pending = readNarrativeCommandPending(storage, scope);
    if (pending.status !== "PENDING" || JSON.stringify(pending.command) !== JSON.stringify(narrativePendingCommandSchema.parse(command))) return false;
    storage.removeItem(narrativeExtractionPendingKey(scope));
    return readNarrativeCommandPending(storage, scope).status === "EMPTY";
  } catch { return false; }
}
