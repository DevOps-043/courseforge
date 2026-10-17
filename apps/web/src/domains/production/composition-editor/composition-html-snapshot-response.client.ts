import {z} from "zod";
import {htmlSnapshotRecoverySummarySchema} from "./composition-html-snapshot-recovery.contract";
import {readBoundedCompositionJson} from "./composition-bounded-json-response.client";

const envelopeSchema=z.object({success:z.literal(true),data:htmlSnapshotRecoverySummarySchema,
  requestId:z.string().uuid(),correlationId:z.string().uuid()}).strict();
const maximumResponseBytes=16*1024;
/** Shared bounded decoder for publication and recovery, no raw error exposure. */
export async function readHtmlSnapshotHttpSummary(response:Response,operationId:string,signal:AbortSignal) {
  const parsed=envelopeSchema.parse(await readBoundedCompositionJson(response,maximumResponseBytes,signal));
  if (parsed.data.operationId !== operationId || parsed.requestId !== parsed.correlationId) throw new Error();
  return parsed.data;
}
