import { z } from "zod";
import { compositionEditorPatchOperationSchema } from "./editor-patch.types";
import type { CompositionRecoveryStorage } from "./composition-recovery-journal";

const MAX_PENDING_BYTES = 2 * 1024 * 1024;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;
const pendingEditSchema = z.object({
  id: z.string().uuid(), baseHash: z.string().regex(/^[a-f0-9]{64}$/),
  createdAt: z.number().int(), operations: z.array(compositionEditorPatchOperationSchema).min(1).max(100),
  source: z.enum(["USER", "AGENT"]), summary: z.string().min(3).max(300),
}).strict();
export type CompositionPendingEdit = z.infer<typeof pendingEditSchema>;
const key = (draftId: string) => `courseforge:composition-pending:v1:${z.string().uuid().parse(draftId)}`;

export function readCompositionPendingEdits(storage: CompositionRecoveryStorage, draftId: string, now = Date.now()) {
  const raw = storage.getItem(key(draftId));
  if (!raw) return [];
  if (new TextEncoder().encode(raw).byteLength > MAX_PENDING_BYTES) throw new Error("La copia de cambios pendientes excede el límite permitido.");
  return pendingEditSchema.array().max(50).parse(JSON.parse(raw)).filter((entry) => now - entry.createdAt < PENDING_TTL_MS);
}

export function writeCompositionPendingEdits(storage: CompositionRecoveryStorage, draftId: string, entries: CompositionPendingEdit[]) {
  const serialized = JSON.stringify(pendingEditSchema.array().max(50).parse(entries));
  if (new TextEncoder().encode(serialized).byteLength > MAX_PENDING_BYTES) throw new Error("Hay demasiados cambios pendientes para conservarlos en este navegador.");
  if (entries.length) storage.setItem(key(draftId), serialized); else storage.removeItem(key(draftId));
}

/** Sólo retira comandos confirmados o transferidos al journal de la escritura en curso. */
export function settleCompositionPendingEdit(storage: CompositionRecoveryStorage, draftId: string, id: string, nextHash?: string) {
  const entries = readCompositionPendingEdits(storage, draftId);
  const confirmed = entries.find((entry) => entry.id === id);
  const remaining = entries.filter((entry) => entry.id !== id);
  writeCompositionPendingEdits(storage, draftId, remaining.map((entry) => nextHash && confirmed && entry.baseHash === confirmed.baseHash ? { ...entry, baseHash: nextHash } : entry));
}
