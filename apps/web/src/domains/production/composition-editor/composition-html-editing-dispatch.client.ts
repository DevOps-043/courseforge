import { z } from "zod";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingMutationRequestSchema, HTML_EDITING_MUTATION_HTTP_POLICY, type HtmlEditingMutationRequest } from "./composition-html-editing-mutation.contract";
import { sendHtmlEditingMutation } from "./composition-html-editing-http.client";
import { beginHtmlEditingJournal, acknowledgeHtmlEditingJournal, recordHtmlEditingJournalReceipt, closeRebasedHtmlEditingJournal, readHtmlEditingJournal } from "./composition-html-editing-journal.client";
import { computeHtmlEditingOperationRequestSha256InBrowser, sendHtmlEditingOperation } from "./composition-html-editing-operation-http.client";
import { htmlSnapshotLocatorScopeSchema, type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";

type MutationAcknowledgment = Awaited<ReturnType<typeof sendHtmlEditingMutation>>;
export class HtmlEditingDispatchError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: "NOT_DISPATCHED" | "PENDING_OPERATION" | "TRACKING_UNAVAILABLE" | "OUTCOME_UNKNOWN" | "REFRESH_REQUIRED",
    readonly operationId?: string) { super(`HTML_EDITING_${code}`); this.name = "HtmlEditingDispatchError"; }
}

/** Trusted UI coordination ports, never request authority. The reservation must
 * fence native queue AND bypassing mutations. Rebase must revalidate owner/base,
 * authorized native document and inspector pointers before adopting any payload.
 * Legacy local IDs are tracking only. Durable opt-in sends ID and records a
 * server receipt bound to the persisted digest; no implicit fallback/retry.
 * Admission inside the reservation must exclude this workflow's own busy flag,
 * but still reject owner/base drift and all other outstanding mutations. */
export async function dispatchTrackedHtmlEditingMutation(input: {
  scope: HtmlSnapshotLocatorScope; clipId: string; body: HtmlEditingMutationRequest;
  storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  reserveNative: <T>(task: () => Promise<T>) => Promise<T>;
  isCurrentAndEditable: () => boolean;
  rebase: (ack: MutationAcknowledgment, signal: AbortSignal) => Promise<boolean>;
  signal?: AbortSignal; fetcher?: typeof fetch; createOperationId?: () => string;
  durable?: boolean;
}): Promise<MutationAcknowledgment> {
  let operationId: string | undefined, dispatched = false, acknowledged = false;
  try {
    const scope = htmlSnapshotLocatorScopeSchema.parse(input.scope);
    const clipId = htmlEditingBindingSchema.shape.clipId.parse(input.clipId);
    const body = htmlEditingMutationRequestSchema.parse(input.body);
    if (new TextEncoder().encode(JSON.stringify(body)).byteLength > HTML_EDITING_MUTATION_HTTP_POLICY.maximumRequestBytes
      || !input.storage || !input.lock || input.signal?.aborted) throw new HtmlEditingDispatchError("NOT_DISPATCHED");
    return await input.lock.runExclusive(scope, () => input.reserveNative(async () => {
      input.signal?.throwIfAborted();
      if (!input.isCurrentAndEditable()) throw new HtmlEditingDispatchError("NOT_DISPATCHED");
      const existing = readHtmlEditingJournal(input.storage, scope);
      if (existing.status !== "EMPTY") throw new HtmlEditingDispatchError(
        existing.status === "PENDING" ? "PENDING_OPERATION" : "TRACKING_UNAVAILABLE");
      operationId = z.string().uuid().parse((input.createOperationId ?? (() => crypto.randomUUID()))());
      const requestSha256 = input.durable ? await computeHtmlEditingOperationRequestSha256InBrowser(body) : undefined;
      input.signal?.throwIfAborted();
      if (!input.isCurrentAndEditable()) throw new HtmlEditingDispatchError("NOT_DISPATCHED", operationId);
      if (!beginHtmlEditingJournal(input.storage, { scope, clipId, operationId, createdAt: Date.now(),
        expected: body.expected, expectedCompositionDocumentHash: body.expectedCompositionDocumentHash,
        ...(requestSha256 ? { requestSha256 } : {}) })) {
        throw new HtmlEditingDispatchError("TRACKING_UNAVAILABLE", operationId);
      }
      // Recheck synchronous guards after storage callbacks, before actual dispatch.
      input.signal?.throwIfAborted();
      if (!input.isCurrentAndEditable()) throw new HtmlEditingDispatchError("NOT_DISPATCHED", operationId);
      const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_MUTATION_HTTP_POLICY.timeoutMs)])
        : AbortSignal.timeout(HTML_EDITING_MUTATION_HTTP_POLICY.timeoutMs);
      dispatched = true;
      const receipt = requestSha256 ? await boundedWait(() => sendHtmlEditingOperation({ scope, clipId, operationId: operationId!,
        requestSha256, body, signal, fetcher: input.fetcher }), signal) : null;
      const ack = receipt ? receipt.acknowledgment : await boundedWait(() => sendHtmlEditingMutation({ scope: { organizationId: scope.organizationId,
        documentId: scope.draftId, clipId }, body, signal, fetcher: input.fetcher }), signal);
      signal.throwIfAborted();
      if (!(receipt ? recordHtmlEditingJournalReceipt(input.storage, scope, operationId, receipt)
        : acknowledgeHtmlEditingJournal(input.storage, scope, operationId, ack))) throw new Error();
      acknowledged = true;
      if (!input.isCurrentAndEditable() || !await boundedWait(() => input.rebase(ack, signal), signal)
        || signal.aborted || !input.isCurrentAndEditable()
        || !closeRebasedHtmlEditingJournal(input.storage, scope, operationId, ack.next)) {
        throw new HtmlEditingDispatchError("REFRESH_REQUIRED", operationId);
      }
      return ack;
    }));
  } catch (error) {
    if (acknowledged) throw new HtmlEditingDispatchError("REFRESH_REQUIRED", operationId);
    if (dispatched) throw new HtmlEditingDispatchError("OUTCOME_UNKNOWN", operationId);
    if (error instanceof HtmlEditingDispatchError) throw error;
    throw new HtmlEditingDispatchError("NOT_DISPATCHED", operationId);
  }
}

/** Bound client waiting even if a dependency ignores abort; observe late errors.
 * Late rebase callbacks must themselves guard owner/base/signal before adoption. */
export function boundedWait<T>(task: () => Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    const onAbort = () => { cleanup(); reject(new Error("HTML_EDITING_WAIT_ABORTED")); };
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) { onAbort(); return; }
    Promise.resolve().then(() => { signal.throwIfAborted(); return task(); })
      .then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
