import { z } from "zod";
import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { HTML_SNAPSHOT_INSPECTION_POLICY, htmlSnapshotInspectionReadRequestSchema, htmlSnapshotInspectionResultSchema,
  matchesHtmlSnapshotInspection, type HtmlSnapshotInspectionReadRequest } from "./composition-html-editing-snapshot-inspection.contract";

const envelope = z.object({ success: z.literal(true), requestId: z.string().uuid(), correlationId: z.string().uuid(),
  data: htmlSnapshotInspectionResultSchema }).strict();
/** Explicit single read. No source, storage path, mutation, retries or history persistence. */
export async function consultHtmlSnapshotInspection(input: {
  request: HtmlSnapshotInspectionReadRequest; signal: AbortSignal; fetcher?: typeof fetch;
}) {
  try {
    const request = htmlSnapshotInspectionReadRequestSchema.parse(input.request);
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(HTML_SNAPSHOT_INSPECTION_POLICY.timeoutMs)]); signal.throwIfAborted();
    const query = new URLSearchParams({ compositionId: request.compositionId });
    const response = await (input.fetcher ?? fetch)(`/api/production/hyperframes/drafts/${request.draftId}/html-snapshot-history/${request.revisionId}/inspection?${query}`,
      { method: "GET", credentials: "same-origin", redirect: "error", cache: "no-store", signal });
    if (response.status !== 200) throw new Error();
    const result = envelope.parse(await readBoundedCompositionJson(response, HTML_SNAPSHOT_INSPECTION_POLICY.responseBytes + 1024, signal));
    signal.throwIfAborted();
    if (result.requestId !== result.correlationId || !matchesHtmlSnapshotInspection(result.data, request)) throw new Error();
    return result.data;
  } catch { throw new Error("HTML_SNAPSHOT_INSPECTION_READ_UNAVAILABLE"); }
}
