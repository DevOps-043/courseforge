import {htmlSnapshotPublicationRequestSchema} from "./composition-html-snapshot-publication-http.contract";
import {dispatchTrackedHtmlSnapshotPublication} from "./composition-html-snapshot-publication.client";
import {readHtmlSnapshotHttpSummary} from "./composition-html-snapshot-response.client";
import type {z} from "zod";

type Tracking=Omit<Parameters<typeof dispatchTrackedHtmlSnapshotPublication>[0],"dispatch">;
type Settings=Omit<z.infer<typeof htmlSnapshotPublicationRequestSchema>,"operationId">;
/** Actual transport wiring, still not a UI action/rollout. Tracking is persisted
 * before this one POST; only operation/hash/CAS/profile leave the browser.
 * Actor/org, permissions, source bytes and execution settings are server-owned. */
export async function sendTrackedHtmlSnapshotPublication(params:Tracking & Settings & {fetchImpl?:typeof fetch}) {
  const settings=htmlSnapshotPublicationRequestSchema.omit({operationId:true}).parse({documentHash:params.documentHash,
    expectedActiveRevisionId:params.expectedActiveRevisionId,renderProfileId:params.renderProfileId});
  const fetchImpl=params.fetchImpl ?? fetch;
  return dispatchTrackedHtmlSnapshotPublication({...params,dispatch:async input => {
    const body=htmlSnapshotPublicationRequestSchema.parse({...settings,operationId:input.operationId});
    const response=await fetchImpl(`/api/production/hyperframes/drafts/${input.draftId}/html-snapshots`,{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body),signal:input.signal,
      credentials:"same-origin",cache:"no-store",redirect:"error",
    });
    return readHtmlSnapshotHttpSummary(response,input.operationId,input.signal);
  }});
}
