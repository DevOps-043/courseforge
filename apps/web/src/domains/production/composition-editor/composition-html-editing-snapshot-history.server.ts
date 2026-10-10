import type { SupabaseClient } from "@supabase/supabase-js";
import { HTML_SNAPSHOT_HISTORY_POLICY as policy, htmlSnapshotHistoryRequestSchema, htmlSnapshotHistoryPageSchema,
  matchesHtmlSnapshotHistoryPage, type HtmlSnapshotHistoryRequest } from "./composition-html-editing-snapshot-history.contract";

/** Metadata inventory only. Service-only RPC reauthorizes actor/draft/composition
 * on EACH page without invoking any compiler. No per-revision N+1 reads, writes,
 * download, signing, execution, restore or implicit historical upgrade. Trusted
 * host must derive actor/org from authentication, never request-supplied identity. */
export async function readAuthorizedHtmlSnapshotHistory(input: {
  request: HtmlSnapshotHistoryRequest; supabase: SupabaseClient; signal?: AbortSignal;
}) {
  try {
    const request = htmlSnapshotHistoryRequestSchema.parse(input.request);
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]) : AbortSignal.timeout(policy.timeoutMs);
    signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_editing_snapshot_history", {
      p_org: request.organizationId, p_actor: request.actorId, p_composition: request.compositionId, p_draft: request.draftId,
      p_ceiling_revision: request.cursor?.ceilingRevision ?? null, p_after_revision: request.cursor?.afterRevision ?? 0,
    }).abortSignal(signal);
    signal.throwIfAborted();
    if (result.error || Buffer.byteLength(JSON.stringify(result.data) ?? "", "utf8") > policy.responseBytes) throw new Error();
    const page = htmlSnapshotHistoryPageSchema.parse(result.data);
    if (!matchesHtmlSnapshotHistoryPage(page, request)) throw new Error();
    return page;
  } catch { throw new Error("HTML_SNAPSHOT_HISTORY_UNAVAILABLE"); }
}
