import type { SupabaseClient } from "@supabase/supabase-js";
import { getHyperframesRenderProfile, DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID } from "../hyperframes/hyperframes-render-profiles";
import { snapshotCompositionDocument } from "./composition-snapshot.service";
import { htmlInitialAnchorScopeSchema, htmlInitialAnchorViewSchema, HTML_INITIAL_ANCHOR_POLICY,
  type HtmlInitialAnchorCommand } from "./composition-html-initial-anchor.contract";

export class HtmlInitialAnchorError extends Error {
  constructor(readonly code: "CONFLICT" | "UNAVAILABLE") { super(`HTML_INITIAL_ANCHOR_${code}`); }
}
export type InitialHtmlAnchorFreezer = (params: Parameters<typeof snapshotCompositionDocument>[0]) => Promise<{ id: string; documentHash: string }>;

/** No GET writes. SQL independently authorizes actor/tenant and saved hash. */
export async function readHtmlInitialAnchor(client: SupabaseClient, input: HtmlInitialAnchorCommand, signal: AbortSignal) {
  const command = htmlInitialAnchorScopeSchema.parse(input); signal.throwIfAborted();
  const { data, error } = await client.rpc("read_initial_html_editing_anchor", {
    p_org: command.organizationId, p_actor: command.actorId, p_draft: command.documentId,
    p_expected_hash: command.expectedDocumentHash,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new HtmlInitialAnchorError(error.message === "HTML_INITIAL_ANCHOR_CONFLICT" ? "CONFLICT" : "UNAVAILABLE");
  if (Buffer.byteLength(JSON.stringify(data) ?? "", "utf8") > HTML_INITIAL_ANCHOR_POLICY.responseBytes)
    throw new HtmlInitialAnchorError("UNAVAILABLE");
  const view = htmlInitialAnchorViewSchema.parse(data);
  if (view.documentId !== command.documentId || view.documentHash !== command.expectedDocumentHash)
    throw new HtmlInitialAnchorError("CONFLICT");
  return view;
}

/** Only the FIRST anchor may be activated. A competing edit/activation wins;
 * a losing ZIP/revision stays inactive, never overwrites the draft or an output.
 * Freeze is the existing native service, without its legacy activation/reuse. */
export async function prepareHtmlInitialAnchor(client: SupabaseClient, input: HtmlInitialAnchorCommand, signal: AbortSignal,
  freeze: InitialHtmlAnchorFreezer = snapshotCompositionDocument) {
  const command = htmlInitialAnchorScopeSchema.parse(input);
  const current = await readHtmlInitialAnchor(client, command, signal);
  if (current.activeRevisionId) return current;
  const frozen = await freeze({ compositionId: current.compositionId, draftId: command.documentId,
    organizationId: command.organizationId, userId: command.actorId, supabase: client,
    renderProfile: getHyperframesRenderProfile(DEFAULT_HYPERFRAMES_RENDER_PROFILE_ID),
    initialEditorialAnchor: { expectedDocumentHash: command.expectedDocumentHash } });
  signal.throwIfAborted();
  if (frozen.documentHash !== command.expectedDocumentHash) throw new HtmlInitialAnchorError("CONFLICT");
  const { error } = await client.rpc("activate_initial_html_editing_anchor", {
    p_org: command.organizationId, p_actor: command.actorId, p_draft: command.documentId,
    p_expected_hash: command.expectedDocumentHash, p_revision: frozen.id,
  }).abortSignal(signal);
  signal.throwIfAborted();
  if (error) throw new HtmlInitialAnchorError(error.message === "HTML_INITIAL_ANCHOR_CONFLICT" ? "CONFLICT" : "UNAVAILABLE");
  // A current authorized read, not an acknowledgment of a particular attempt.
  const available = await readHtmlInitialAnchor(client, command, signal);
  if (!available.activeRevisionId) throw new HtmlInitialAnchorError("UNAVAILABLE");
  return available;
}
