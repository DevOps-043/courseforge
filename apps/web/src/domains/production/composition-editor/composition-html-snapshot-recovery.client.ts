import { z } from "zod";
import { HTML_SNAPSHOT_RECOVERY_HTTP_POLICY } from "./composition-html-editing-snapshot-recovery-policy";
import { readHtmlSnapshotHttpSummary } from "./composition-html-snapshot-response.client";

export async function consultHtmlSnapshotRecovery(input:{draftId:string;operationId:string;signal?:AbortSignal;fetchImpl?:typeof fetch}) {
  const ids = z.object({draftId:z.string().uuid(),operationId:z.string().uuid()}).parse(input);
  const timeout = AbortSignal.timeout(HTML_SNAPSHOT_RECOVERY_HTTP_POLICY.timeoutMs);const signal = input.signal ? AbortSignal.any([input.signal,timeout]) : timeout;
  signal.throwIfAborted();
  try {
    const response = await (input.fetchImpl ?? fetch)(`/api/production/hyperframes/drafts/${ids.draftId}/html-snapshots/${ids.operationId}`,
      {method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal});
    return await readHtmlSnapshotHttpSummary(response,ids.operationId,signal);
  } catch {throw new Error("No se pudo confirmar la publicación. No se ha repetido la operación.");}
}
