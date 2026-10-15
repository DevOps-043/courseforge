import { createHash } from "node:crypto";
import { z } from "zod";
import { narrativeFragmentApplyRequestSchema, narrativeFragmentReceiptSchema,
  type NarrativeFragmentApplyRequest, type NarrativeFragmentReceipt } from "./composition-narrative-fragment-command-contract";
import { loadNarrativeFragmentPlan, type NarrativeFragmentReadRepository } from "./composition-narrative-fragment-query.server";
import { fingerprintNarrativeFragmentPlan } from "./composition-narrative-fragment-review.server";
import type { NarrativeFragmentPlan } from "./composition-narrative-fragment.types";
import { NarrativeExtractionCommitUnconfirmedError } from "./composition-narrative-extraction-apply.service";

const commandScopeSchema = z.object({ draftId: z.string().uuid(), organizationId: z.string().uuid(),
  userId: z.string().uuid(), commandId: z.string().uuid() }).strict();
export type NarrativeFragmentCommandScope = z.infer<typeof commandScopeSchema>;
export interface NarrativeFragmentCommandRepository {
  readReceipt(scope: NarrativeFragmentCommandScope): Promise<unknown | null>;
  /** One transaction: deduplicate, validate all sources/fonts/links and base hash, append full batch/audit/receipt.
   * NEVER implement with the voice-only RPC or individual clip commits. */
  commit(scope: NarrativeFragmentCommandScope & { requestFingerprint: string; plan: NarrativeFragmentPlan }): Promise<
    { status: "COMMITTED" | "REPLAYED"; receipt: unknown }
    | { status: "CONFLICT" | "ASSET_CHANGED" | "FONT_CHANGED" | "COMMAND_REUSED" | "BUSY" }>;
}

export function fingerprintNarrativeFragmentRequest(request: NarrativeFragmentApplyRequest) {
  const parsed = narrativeFragmentApplyRequestSchema.parse(request);
  const selection = parsed.query.selection;
  return createHash("sha256").update(JSON.stringify([parsed.contract, parsed.commandId, parsed.reviewFingerprint,
    parsed.query.contract, [...parsed.query.selectedTrackIds].sort(), selection.documentHash, selection.occurrenceId,
    selection.firstSourceIndex, selection.lastSourceIndex, selection.adjustedStartSeconds ?? null,
    selection.adjustedEndSeconds ?? null])).digest("hex");
}

function resolveReceipt(value: unknown, commandId: string, requestFingerprint: string) {
  const parsed = narrativeFragmentReceiptSchema.safeParse(value);
  if (!parsed.success || parsed.data.commandId !== commandId) return { ok: false, reason: "INVALID_RECEIPT" } as const;
  if (parsed.data.requestFingerprint !== requestFingerprint) return { ok: false, reason: "COMMAND_REUSED" } as const;
  return { ok: true, receipt: parsed.data } as const;
}
type Parameters = { draftId: string; organizationId: string; userId: string; request: NarrativeFragmentApplyRequest;
  commands: NarrativeFragmentCommandRepository; reads: NarrativeFragmentReadRepository; signal: AbortSignal };
function parseIntent(params: Pick<Parameters, "draftId" | "organizationId" | "userId" | "request">) {
  const request = narrativeFragmentApplyRequestSchema.parse(params.request);
  const scope = commandScopeSchema.parse({ draftId: params.draftId, organizationId: params.organizationId,
    userId: params.userId, commandId: request.commandId });
  return { request, scope, fingerprint: fingerprintNarrativeFragmentRequest(request) };
}

/** Authenticated caller supplies scope; the HTTP writer uses independent closed-by-default gates. */
export async function applyNarrativeFragment(params: Parameters) {
  const { request, scope, fingerprint } = parseIntent(params);
  params.signal.throwIfAborted();
  const prior = await params.commands.readReceipt(scope); params.signal.throwIfAborted();
  if (prior !== null) {
    const resolved = resolveReceipt(prior, request.commandId, fingerprint);
    return resolved.ok ? { ...resolved, outcome: "REPLAYED" } as const : resolved;
  }
  const planned = await loadNarrativeFragmentPlan({ draftId: scope.draftId, organizationId: scope.organizationId,
    request: request.query, commandId: request.commandId, repository: params.reads, signal: params.signal });
  if (!planned.ok) return planned;
  if (fingerprintNarrativeFragmentPlan(planned.plan) !== request.reviewFingerprint) return { ok: false, reason: "REVIEW_STALE" } as const;
  params.signal.throwIfAborted();
  let committed: Awaited<ReturnType<NarrativeFragmentCommandRepository["commit"]>>;
  try {
    committed = await params.commands.commit({ ...scope, requestFingerprint: fingerprint, plan: planned.plan });
    params.signal.throwIfAborted();
  } catch (error) {
    // Includes cancellation after dispatch: neither failure nor timeout proves rollback.
    throw new NarrativeExtractionCommitUnconfirmedError(request.commandId, error);
  }
  if (committed.status !== "COMMITTED" && committed.status !== "REPLAYED") return { ok: false, reason: committed.status } as const;
  const resolved = resolveReceipt(committed.receipt, request.commandId, fingerprint);
  if (!resolved.ok || (committed.status === "COMMITTED" && !matchesPlan(resolved.receipt, planned.plan))) {
    throw new NarrativeExtractionCommitUnconfirmedError(request.commandId, new Error("INVALID_RECEIPT"));
  }
  return { ...resolved, outcome: committed.status } as const;
}
function matchesPlan(receipt: NarrativeFragmentReceipt, plan: NarrativeFragmentPlan) {
  const expected = plan.copies.map(copy => copy.newClipId).sort();
  return receipt.anchorClipId === plan.anchor.newClipId && JSON.stringify([...receipt.newClipIds].sort()) === JSON.stringify(expected);
}

/** Missing receipt remains uncertain. Recovery never reloads sources or dispatches another commit. */
export async function recoverNarrativeFragment(params: Omit<Parameters, "reads" | "commands"> & {
  commands: Pick<NarrativeFragmentCommandRepository, "readReceipt"> }) {
  const { request, scope, fingerprint } = parseIntent(params);
  params.signal.throwIfAborted();
  const receipt = await params.commands.readReceipt(scope); params.signal.throwIfAborted();
  return receipt === null ? { ok: false, reason: "COMMIT_UNCONFIRMED", commandId: request.commandId } as const
    : resolveReceipt(receipt, request.commandId, fingerprint);
}
