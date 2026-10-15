import { createHash } from "node:crypto";
import { z } from "zod";
import { narrativeExtractionApplyRequestSchema, type NarrativeExtractionApplyRequest } from "./composition-narrative-extraction-contract";
import { fingerprintNarrativeVoiceExtractionPlan, loadNarrativeVoiceExtractionPlan, type NarrativeExtractionReadRepository } from "./composition-narrative-extraction-query";
import type { NarrativeVoiceExtractionPlan } from "./composition-narrative-extraction.service";

export const narrativeExtractionReceiptSchema = z.object({
  commandId: z.string().uuid(), requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), version: z.number().int().positive(),
  newClipId: z.string().regex(/^[a-z][a-z0-9-]{0,127}$/i),
}).strict();
export type NarrativeExtractionReceipt = z.infer<typeof narrativeExtractionReceiptSchema>;
type CommandScope = { draftId: string; organizationId: string; userId: string; commandId: string };

export class NarrativeExtractionCommitUnconfirmedError extends Error {
  constructor(readonly commandId: string, cause: unknown) {
    super("El resultado del guardado no está confirmado. Consulta el recibo antes de reintentar.", { cause });
    this.name = "NarrativeExtractionCommitUnconfirmedError";
  }
}

/** Required persistence boundary; a generic append followed by a receipt insert is NOT an implementation. */
export interface NarrativeExtractionCommandRepository {
  readReceipt(scope: CommandScope): Promise<unknown | null>;
  /** Atomically deduplicates the scoped command, rechecks asset binding and base hash, appends document/audit,
   * and inserts the immutable receipt in the SAME transaction. Different payload must return COMMAND_REUSED. */
  commit(scope: CommandScope & { requestFingerprint: string; plan: NarrativeVoiceExtractionPlan }): Promise<
    { status: "COMMITTED" | "REPLAYED"; receipt: unknown }
    | { status: "CONFLICT" | "ASSET_CHANGED" | "COMMAND_REUSED" | "BUSY" }>;
}

export function fingerprintNarrativeExtractionRequest(request: NarrativeExtractionApplyRequest) {
  const parsed = narrativeExtractionApplyRequestSchema.parse(request);
  const selection = parsed.selection;
  return createHash("sha256").update(JSON.stringify([parsed.contract, parsed.commandId, parsed.reviewFingerprint,
    selection.documentHash, selection.occurrenceId, selection.firstSourceIndex, selection.lastSourceIndex,
    selection.adjustedStartSeconds ?? null, selection.adjustedEndSeconds ?? null])).digest("hex");
}

function resolveReceipt(receipt: unknown, commandId: string, requestFingerprint: string) {
  const parsed = narrativeExtractionReceiptSchema.safeParse(receipt);
  if (!parsed.success || parsed.data.commandId !== commandId
    || parsed.data.newClipId !== `voice-extract-${commandId}`) return { ok: false, reason: "INVALID_RECEIPT" } as const;
  if (parsed.data.requestFingerprint !== requestFingerprint) return { ok: false, reason: "COMMAND_REUSED" } as const;
  return { ok: true, receipt: parsed.data } as const;
}

/** Authenticated route must supply the scope. Not wired to HTTP or a DB writer until the atomic boundary exists. */
export async function applyNarrativeVoiceExtraction(params: {
  draftId: string; organizationId: string; userId: string; request: NarrativeExtractionApplyRequest;
  reads: NarrativeExtractionReadRepository; commands: NarrativeExtractionCommandRepository;
}) {
  const uuid = z.string().uuid();
  uuid.parse(params.draftId); uuid.parse(params.organizationId); uuid.parse(params.userId);
  const request = narrativeExtractionApplyRequestSchema.parse(params.request);
  const scope: CommandScope = { draftId: params.draftId, organizationId: params.organizationId,
    userId: params.userId, commandId: request.commandId };
  const requestFingerprint = fingerprintNarrativeExtractionRequest(request);
  const priorReceipt = await params.commands.readReceipt(scope);
  if (priorReceipt !== null) {
    const resolved = resolveReceipt(priorReceipt, request.commandId, requestFingerprint);
    return resolved.ok ? { ok: true, outcome: "REPLAYED", receipt: resolved.receipt } as const : resolved;
  }
  const planned = await loadNarrativeVoiceExtractionPlan({ draftId: params.draftId, organizationId: params.organizationId,
    selection: request.selection, repository: params.reads, identity: request.commandId });
  if (!planned.ok) return planned;
  if (fingerprintNarrativeVoiceExtractionPlan(planned.plan) !== request.reviewFingerprint) {
    return { ok: false, reason: "REVIEW_STALE" } as const;
  }
  let committed: Awaited<ReturnType<NarrativeExtractionCommandRepository["commit"]>>;
  try { committed = await params.commands.commit({ ...scope, requestFingerprint, plan: planned.plan }); }
  catch (error) {
    // A transport failure after commit may mean the write succeeded. Never retry or report "not saved".
    throw new NarrativeExtractionCommitUnconfirmedError(request.commandId, error);
  }
  if (committed.status !== "COMMITTED" && committed.status !== "REPLAYED") {
    return { ok: false, reason: committed.status } as const;
  }
  const resolved = resolveReceipt(committed.receipt, request.commandId, requestFingerprint);
  if (!resolved.ok) throw new NarrativeExtractionCommitUnconfirmedError(request.commandId, new Error(resolved.reason));
  return { ok: true, outcome: committed.status, receipt: resolved.receipt } as const;
}

/** A missing receipt can still mean an in-flight transaction; it never proves the write failed. */
export async function recoverNarrativeVoiceExtraction(params: {
  draftId: string; organizationId: string; userId: string; request: NarrativeExtractionApplyRequest;
  commands: Pick<NarrativeExtractionCommandRepository, "readReceipt">;
}) {
  const uuid = z.string().uuid();
  uuid.parse(params.draftId); uuid.parse(params.organizationId); uuid.parse(params.userId);
  const request = narrativeExtractionApplyRequestSchema.parse(params.request);
  const receipt = await params.commands.readReceipt({ draftId: params.draftId, organizationId: params.organizationId,
    userId: params.userId, commandId: request.commandId });
  if (receipt === null) return { ok: false, reason: "COMMIT_UNCONFIRMED", commandId: request.commandId } as const;
  return resolveReceipt(receipt, request.commandId, fingerprintNarrativeExtractionRequest(request));
}
