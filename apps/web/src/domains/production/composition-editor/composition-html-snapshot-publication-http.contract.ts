import { z } from "zod";
import { HYPERFRAMES_RENDER_PROFILE_IDS } from "../hyperframes/hyperframes-render-profiles";

export const htmlSnapshotPublicationRequestSchema = z.object({
  operationId:z.string().uuid(),documentHash:z.string().regex(/^[a-f0-9]{64}$/),
  expectedActiveRevisionId:z.string().uuid().nullable(),renderProfileId:z.enum(HYPERFRAMES_RENDER_PROFILE_IDS),
}).strict();
export const HTML_SNAPSHOT_PUBLICATION_HTTP_POLICY = Object.freeze({
  maximumRequestBytes:4096,maximumConfigurationBytes:16*1024,maximumUrlBytes:2048,
  timeoutMs:110_000,bodyTimeoutMs:15_000,windowSeconds:60,actorRequestsPerWindow:3,organizationRequestsPerWindow:10,
  maximumRateResponseBytes:1024,
});
export function htmlSnapshotPublicationEnabled(value:unknown) {return value === "true";}
