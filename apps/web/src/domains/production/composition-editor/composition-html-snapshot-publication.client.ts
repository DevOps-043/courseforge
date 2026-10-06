import { z } from "zod";
import { htmlSnapshotLocatorScopeSchema, readHtmlSnapshotLocator, rememberHtmlSnapshotLocator,
  type HtmlSnapshotLocatorScope, type HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { htmlSnapshotRecoverySummarySchema, type HtmlSnapshotRecoverySummary } from "./composition-html-snapshot-recovery.contract";
import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";

export const HTML_SNAPSHOT_CLIENT_PUBLICATION_POLICY = Object.freeze({ deadlineMs: 120_000 });
type FailureCode = "NOT_DISPATCHED" | "PENDING_OPERATION" | "TRACKING_UNAVAILABLE" | "OUTCOME_UNKNOWN";
export class HtmlSnapshotClientPublicationError extends Error {
  readonly automaticRetryAllowed = false;
  constructor(readonly code: FailureCode, readonly operationId?: string) {
    super(code === "OUTCOME_UNKNOWN" ? "No se pudo confirmar la publicación. Consulta su estado antes de continuar."
      : "La publicación no se envió. Revisa el seguimiento pendiente y la disponibilidad del navegador.");
    this.name = "HtmlSnapshotClientPublicationError";
  }
}

/** Before-dispatch lifecycle for the future authenticated publication transport.
 * No endpoint is installed here. The host callback must implement a single
 * attempt, strict bounded HTTP parsing and server-derived actor/tenant authority.
 * Saved scope is local routing only, never permissions sent to the server.
 * Successful or uncertain outcomes retain their locator for explicit recovery.
 */
export async function dispatchTrackedHtmlSnapshotPublication(params: {
  scope: HtmlSnapshotLocatorScope;
  storage: HtmlSnapshotLocatorStorage | null;
  lock: HtmlSnapshotPublicationLock | null;
  signal?: AbortSignal;
  createOperationId?: () => string;
  dispatch: (input: { operationId: string; draftId: string; signal: AbortSignal }) => Promise<unknown>;
}): Promise<HtmlSnapshotRecoverySummary> {
  const scope = htmlSnapshotLocatorScopeSchema.parse(params.scope);
  if (!params.lock || !params.storage || params.signal?.aborted)
    throw new HtmlSnapshotClientPublicationError("NOT_DISPATCHED");
  // Local retry/id reuse is forbidden even after the Web Lock has been released.
  // A lock acquisition failure cannot be treated as permission to dispatch.
  let operationId: string | undefined;
  let dispatched = false;
  try {
    return await params.lock.runExclusive(scope, async () => {
      params.signal?.throwIfAborted();
      const existing = readHtmlSnapshotLocator(params.storage, scope);
      if (existing) throw new HtmlSnapshotClientPublicationError("PENDING_OPERATION", existing.operationId);
      operationId = z.string().uuid().parse((params.createOperationId ?? (() => crypto.randomUUID()))());
      const remembered = rememberHtmlSnapshotLocator(params.storage, scope, operationId);
      if (remembered !== "SAVED") throw new HtmlSnapshotClientPublicationError("TRACKING_UNAVAILABLE", operationId);
      params.signal?.throwIfAborted();
      const deadline = AbortSignal.timeout(HTML_SNAPSHOT_CLIENT_PUBLICATION_POLICY.deadlineMs);
      const signal = params.signal ? AbortSignal.any([params.signal, deadline]) : deadline;
      signal.throwIfAborted();
      // Treat sync throws and invalid/lost ACKs as uncertain once dispatch starts.
      dispatched = true;
      const raw = await awaitDispatch(params.dispatch, { operationId, draftId: scope.draftId, signal });
      signal.throwIfAborted();
      const summary = htmlSnapshotRecoverySummarySchema.parse(raw);
      if (summary.operationId !== operationId || !["COMMITTED_ACTIVE", "COMMITTED_SUPERSEDED"].includes(summary.status))
        throw new Error("HTML_SNAPSHOT_PUBLICATION_ACK_INVALID");
      return summary;
    });
  } catch (error) {
    if (dispatched) throw new HtmlSnapshotClientPublicationError("OUTCOME_UNKNOWN", operationId);
    if (error instanceof HtmlSnapshotClientPublicationError) throw error;
    throw new HtmlSnapshotClientPublicationError("NOT_DISPATCHED", operationId);
  }
}

/** Abort bounds client waiting even for a non-cooperative transport. It cannot
 * undo a server commit; retain locator and observe late rejection safely. */
function awaitDispatch(dispatch: (input: {operationId:string;draftId:string;signal:AbortSignal}) => Promise<unknown>,
  input: {operationId:string;draftId:string;signal:AbortSignal}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const onAbort = () => { cleanup(); reject(new Error("HTML_SNAPSHOT_PUBLICATION_ABORTED")); };
    const cleanup = () => input.signal.removeEventListener("abort", onAbort);
    input.signal.addEventListener("abort", onAbort, {once:true});
    if (input.signal.aborted) { onAbort(); return; }
    Promise.resolve().then(() => {
      input.signal.throwIfAborted();
      return dispatch(input);
    }).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}
