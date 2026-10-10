import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_SNAPSHOT_HISTORY_POLICY, htmlSnapshotHistoryRequestSchema, htmlSnapshotHistoryPageSchema,
  matchesHtmlSnapshotHistoryPage, type HtmlSnapshotHistoryRequest } from "./composition-html-editing-snapshot-history.contract";

const envelopeBytes = 1024;
const envelopeSchema = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(), data: htmlSnapshotHistoryPageSchema }).strict();
/** One read per explicit page. No loop, accumulated history, persistence or retry. */
export async function consultHtmlSnapshotHistory(input: { request: HtmlSnapshotHistoryRequest; signal: AbortSignal; fetcher?: typeof fetch }) {
  try {
    const request = htmlSnapshotHistoryRequestSchema.parse(input.request);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_SNAPSHOT_HISTORY_POLICY.timeoutMs)]); signal.throwIfAborted();
    const query = new URLSearchParams({ compositionId: request.compositionId });
    if (request.cursor) { query.set("ceilingRevision", String(request.cursor.ceilingRevision)); query.set("afterRevision", String(request.cursor.afterRevision)); }
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-snapshot-history?${query}`,
      { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    if (response.status !== 200) throw new Error();
    const envelope = envelopeSchema.parse(await readBoundedCompositionJson(response, HTML_SNAPSHOT_HISTORY_POLICY.responseBytes + envelopeBytes, signal));
    signal.throwIfAborted();
    if (envelope.requestId !== envelope.correlationId || !matchesHtmlSnapshotHistoryPage(envelope.data, request)) throw new Error();
    return envelope.data;
  } catch { throw new Error("HTML_SNAPSHOT_HISTORY_READ_UNAVAILABLE"); }
}
