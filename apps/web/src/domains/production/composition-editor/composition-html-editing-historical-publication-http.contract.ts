import { z } from "zod";
import { htmlHistoricalPublicationRequestSchema } from "./composition-html-editing-historical-publication.contract";
import { htmlSnapshotHistoryEnabled } from "./composition-html-editing-snapshot-history-http.contract";

export const HTML_HISTORICAL_PUBLICATION_HTTP_POLICY = Object.freeze({
  maximumUrlBytes: 2048, maximumRequestBytes: 1024, maximumResponseBytes: 5120,
  timeoutMs: 20_000, bodyTimeoutMs: 5000, windowSeconds: 60,
  organizationRequests: 60, actorRequests: 10, maximumRateResponseBytes: 4096,
});
export const htmlHistoricalPublicationHttpRequestSchema = htmlHistoricalPublicationRequestSchema.extend({compositionId: z.string().uuid()}).strict();
export const htmlHistoricalPublicationHttpQuerySchema = htmlHistoricalPublicationHttpRequestSchema.extend({
  requestSha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export function htmlHistoricalPublicationEnabled(method: "GET" | "POST", environment: Record<string, string | undefined>) {
  return htmlSnapshotHistoryEnabled(environment) && (method === "GET"
    || environment.COMPOSITION_HTML_SNAPSHOT_PUBLICATION_ENABLED === "true"
      && environment.COMPOSITION_HTML_EDITING_MUTATIONS_ENABLED === "true");
}
