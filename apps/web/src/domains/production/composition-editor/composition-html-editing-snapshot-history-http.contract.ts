import { z } from "zod";
import { HTML_SNAPSHOT_HISTORY_POLICY } from "./composition-html-editing-snapshot-history.contract";

const integer = z.string().regex(/^(?:0|[1-9][0-9]{0,9})$/).transform(Number).pipe(z.number().int().max(2_147_483_647));
export const htmlSnapshotHistoryQuerySchema = z.object({ compositionId: z.string().uuid(),
  ceilingRevision: integer.optional(), afterRevision: integer.optional() }).strict()
  .refine(query => query.ceilingRevision === undefined ? query.afterRevision === undefined
    : query.afterRevision !== undefined && query.afterRevision <= query.ceilingRevision);
export const HTML_SNAPSHOT_HISTORY_HTTP_POLICY = Object.freeze({ maximumUrlBytes: 2048, timeoutMs: HTML_SNAPSHOT_HISTORY_POLICY.timeoutMs,
  windowSeconds: 60, organizationRequests: 300, actorRequests: 30, maximumRateResponseBytes: 4096 });
export function htmlSnapshotHistoryEnabled(environment: Record<string, string | undefined>) {
  return environment.COMPOSITION_HTML_EDITING_INSPECTOR_ENABLED === "true"
    && environment.COMPOSITION_HTML_SNAPSHOT_RECOVERY_ENABLED === "true";
}
