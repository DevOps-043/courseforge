import { createHash } from "node:crypto";
import { z } from "zod";
import { prepareCompositionHtmlEditingSnapshotArchive } from "./composition-html-editing-snapshot-archive.server";
import { htmlSnapshotIntentSchema, parseHtmlSnapshotAcknowledgment, type HtmlSnapshotOperationIdentity } from "./composition-html-editing-snapshot-publication.contract";

type Preparation = Omit<Parameters<typeof prepareCompositionHtmlEditingSnapshotArchive>[0], "historicalRepublication">;
type PreparedArchive = Awaited<ReturnType<typeof prepareCompositionHtmlEditingSnapshotArchive>>;
export const HTML_EDITING_SNAPSHOT_STORAGE_BUCKET = "production-assets" as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const scopeSchema = z.object({compositionId: z.string().uuid(), expectedActiveRevisionId: z.string().uuid().nullable(),
  operationId: z.string().uuid()}).strict();
const storedArchiveSchema = z.object({projectHash: hash, sizeBytes: z.number().int().positive(),
  storageBucket: z.literal(HTML_EDITING_SNAPSHOT_STORAGE_BUCKET), storagePath: z.string().min(1).max(1024)}).strict();

export class HtmlEditingSnapshotPublicationError extends Error {
  readonly operationIdentity?:Readonly<HtmlSnapshotOperationIdentity>;
  constructor(readonly code: "INTENT_OUTCOME_UNKNOWN" | "INTENT_ACK_INVALID" | "UPLOAD_OUTCOME_UNKNOWN" | "UPLOAD_ACK_INVALID" | "COMMIT_OUTCOME_UNKNOWN" | "COMMIT_ACK_INVALID",
    identity?:HtmlSnapshotOperationIdentity) {
    super(code); this.name = "HtmlEditingSnapshotPublicationError";
    // Host reconciliation context only; never source, credentials or grants.
    this.operationIdentity = identity ? Object.freeze({...identity}) : undefined;
  }
}

/** These are privileged host ports, never request-supplied callbacks.
 * Storage must implement create-only content-addressed writes and verify an
 * existing object's bytes on collision; a mere path/409 is not an ACK.
 * Repository MUST authorize actor/org/draft/composition, lock current state,
 * refresh templates/grants and all asset/font identities, check native hash
 * and expected active revision, then insert/reuse, link, audit, and activate
 * in ONE transaction. operationId binds the entire payload for reconciliation;
 * reuse must reauthorize and cannot silently switch the active revision.
 * No concrete repository/route is installed by this prepared coordinator. */
export type HtmlEditingSnapshotPublicationPorts = {
  recordPublicationIntent(input:{identity:HtmlSnapshotOperationIdentity; actorId:string;
    expectedActiveRevisionId:string | null; archiveSizeBytes:number; signal:AbortSignal}):Promise<unknown>;
  storeImmutableArchive(input: {organizationId: string; compositionId: string; projectHash: string;
    bytes: Uint8Array; contentType: "application/zip"; signal: AbortSignal}): Promise<unknown>;
  commitSnapshotAtomically(input: {actorId: string; organizationId: string; compositionId: string;
    draftId: string; documentHash: string; expectedActiveRevisionId: string | null; operationId: string;
    archive: z.infer<typeof storedArchiveSchema>; prepared: Omit<PreparedArchive, "archiveBytes">;
    signal: AbortSignal}): Promise<unknown>;
};

export const HTML_EDITING_SNAPSHOT_PUBLICATION_POLICY = Object.freeze({uploadTimeoutMs: 60_000, commitTimeoutMs: 15_000});
function boundedSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

/** Prepared lifecycle only. Storage and PostgreSQL cannot share a transaction:
 * uploaded but uncommitted archives are possible. Never delete on uncertainty,
 * compensate by changing active state, or blindly retry a write here. */
export async function publishCompositionHtmlEditingSnapshot(params: Preparation & z.infer<typeof scopeSchema> & {
  ports: HtmlEditingSnapshotPublicationPorts;
}) {
  if ("historicalRepublication" in params) throw new Error("HTML_HISTORICAL_PUBLICATION_REQUIRES_INACTIVE_WORKFLOW");
  const scope = scopeSchema.parse({compositionId: params.compositionId,
    expectedActiveRevisionId: params.expectedActiveRevisionId, operationId: params.operationId});
  params.signal?.throwIfAborted();
  const prepared = await prepareCompositionHtmlEditingSnapshotArchive(params);
  params.signal?.throwIfAborted();
  const {archiveBytes, ...receipt} = prepared;
  const operationIdentity = {operationId:scope.operationId, organizationId:params.organizationId,
    compositionId:scope.compositionId, draftId:params.documentId, documentHash:params.documentHash, projectHash:prepared.projectHash};
  const intentSignal = boundedSignal(params.signal, HTML_EDITING_SNAPSHOT_PUBLICATION_POLICY.commitTimeoutMs);
  let intentResponse:unknown;
  try {
    intentResponse = await params.ports.recordPublicationIntent({identity:{...operationIdentity},actorId:params.actorId,
      expectedActiveRevisionId:scope.expectedActiveRevisionId,archiveSizeBytes:archiveBytes.length,signal:intentSignal});
    intentSignal.throwIfAborted();
  } catch {throw new HtmlEditingSnapshotPublicationError("INTENT_OUTCOME_UNKNOWN",operationIdentity);}
  const intent = htmlSnapshotIntentSchema.safeParse(intentResponse);
  if (!intent.success || intent.data.archiveSizeBytes !== archiveBytes.length
    || intent.data.expectedActiveRevisionId !== scope.expectedActiveRevisionId
    || Object.entries(operationIdentity).some(([key,value]) => intent.data.identity[key as keyof HtmlSnapshotOperationIdentity] !== value)) {
    throw new HtmlEditingSnapshotPublicationError("INTENT_ACK_INVALID",operationIdentity);
  }
  // A port receives its own copy, so mutation cannot change the prepared hash
  // or leak unverified caller buffers into the subsequent commit.
  const uploadBytes = new Uint8Array(archiveBytes);
  const uploadSignal = boundedSignal(params.signal, HTML_EDITING_SNAPSHOT_PUBLICATION_POLICY.uploadTimeoutMs);
  let uploadResponse: unknown;
  try {
    uploadResponse = await params.ports.storeImmutableArchive({organizationId: params.organizationId,
      compositionId: scope.compositionId, projectHash: prepared.projectHash, bytes: uploadBytes,
      contentType: "application/zip", signal: uploadSignal});
    uploadSignal.throwIfAborted();
  } catch {throw new HtmlEditingSnapshotPublicationError("UPLOAD_OUTCOME_UNKNOWN", operationIdentity);}
  const stored = storedArchiveSchema.safeParse(uploadResponse);
  const expectedPath = `composition-snapshots/${params.organizationId}/${scope.compositionId}/${prepared.projectHash}.zip`;
  if (!stored.success || stored.data.projectHash !== prepared.projectHash || stored.data.sizeBytes !== archiveBytes.length
    || stored.data.storagePath !== expectedPath || createHash("sha256").update(uploadBytes).digest("hex") !== prepared.projectHash) {
    throw new HtmlEditingSnapshotPublicationError("UPLOAD_ACK_INVALID", operationIdentity);
  }
  params.signal?.throwIfAborted();
  const commitSignal = boundedSignal(params.signal, HTML_EDITING_SNAPSHOT_PUBLICATION_POLICY.commitTimeoutMs);
  let commitResponse: unknown;
  try {
    commitResponse = await params.ports.commitSnapshotAtomically({actorId: params.actorId,
      organizationId: params.organizationId, compositionId: scope.compositionId, draftId: params.documentId,
      documentHash: params.documentHash, expectedActiveRevisionId: scope.expectedActiveRevisionId,
      operationId: scope.operationId, archive: stored.data, prepared: receipt, signal: commitSignal});
    commitSignal.throwIfAborted();
  } catch {throw new HtmlEditingSnapshotPublicationError("COMMIT_OUTCOME_UNKNOWN", operationIdentity);}
  try {
    const acknowledgment = parseHtmlSnapshotAcknowledgment(commitResponse, operationIdentity);
    return {...acknowledgment, scope: "REGISTERED_BY_HOST_PORT_NOT_RENDERED" as const};
  } catch {throw new HtmlEditingSnapshotPublicationError("COMMIT_ACK_INVALID", operationIdentity);}
}
