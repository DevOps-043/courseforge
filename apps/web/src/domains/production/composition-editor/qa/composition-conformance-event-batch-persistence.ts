import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { eventBatchMeasurementIdentitySchema, eventBatchMeasurementPacketSchema,
  hashEventBatchMeasurementPacket, persistedEventBatchMeasurementSchema } from "./composition-conformance-event-batch-execution";
import { eventBatchAuthorizationManifestSchema } from "../composition-conformance-batch-contract";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";

export const EVENT_BATCH_PACKET_MAXIMUM_BYTES = 4 * 1024 * 1024;
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
type WorkerDatabase = SupabaseClient<any, any, any>;
const canonicalHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function authorizeIdentity(supabase: WorkerDatabase, identity: z.infer<typeof eventBatchMeasurementIdentitySchema>) {
  const revision = await supabase.from("video_composition_revisions").select("id, organization_id, project_hash, manifest")
    .eq("id", identity.revisionId).eq("organization_id", identity.organizationId).maybeSingle();
  const row = revision.data;
  if (revision.error || !row || row.id !== identity.revisionId || row.organization_id !== identity.organizationId
    || row.project_hash !== identity.projectHash || row.manifest?.conformance_reference_version !== 1) {
    throw new Error("CONFORMANCE_EVENT_PACKET_REVISION_UNAVAILABLE");
  }
  const parent = compositionConformanceContractSchema.parse(row.manifest.conformance_contract);
  const authorization = eventBatchAuthorizationManifestSchema.parse(row.manifest.conformance_event_batch_authorization);
  if (parent.schemaVersion !== 4 || !parent.checkpointBatch || parent.documentHash !== identity.documentHash
    || canonicalHash(parent) !== identity.parentContractSha256 || authorization.documentHash !== identity.documentHash
    || authorization.parentContractSha256 !== identity.parentContractSha256
    || JSON.stringify(parent.checkpointBatch) !== JSON.stringify(authorization.rootBatch)
    || JSON.stringify({...identity.batch, batchIndex: 0}) !== JSON.stringify(authorization.rootBatch)
    || authorization.batchContractSha256[identity.batch.batchIndex] !== identity.batchContractSha256) {
    throw new Error("CONFORMANCE_EVENT_PACKET_AUTHORIZATION_MISMATCH");
  }
}

/** Internal worker only. DB stores bounded measurement packets, never a trusted PASS verdict. */
export async function persistCompositionEventBatchMeasurement(params: {
  supabase: WorkerDatabase; packet: unknown; visualChecksum: string;
}) {
  const supabase = params.supabase;
  const packet = eventBatchMeasurementPacketSchema.parse(params.packet);
  const visualChecksum = digestSchema.parse(params.visualChecksum);
  if (Buffer.byteLength(JSON.stringify(packet)) > EVENT_BATCH_PACKET_MAXIMUM_BYTES) throw new Error("CONFORMANCE_EVENT_PACKET_SIZE_LIMIT");
  await authorizeIdentity(supabase, packet.identity);
  const packetSha256 = hashEventBatchMeasurementPacket(packet);
  const recorded = await supabase.rpc("record_hyperframes_event_batch_measurement", {
    p_identity: packet.identity, p_packet: packet, p_packet_sha256: packetSha256, p_visual_sha256: visualChecksum,
  });
  if (recorded.error || recorded.data !== packetSha256) throw new Error("CONFORMANCE_EVENT_PACKET_RECORD_FAILED");
  return {packetSha256};
}

/** Null means no matching packet, not a transport or authorization failure. */
export async function readCompositionEventBatchMeasurement(params: {supabase: WorkerDatabase; identity: unknown}) {
  const supabase = params.supabase;
  const identity = eventBatchMeasurementIdentitySchema.parse(params.identity);
  await authorizeIdentity(supabase, identity);
  const recorded = await supabase.rpc("read_hyperframes_event_batch_measurement", {p_identity: identity});
  if (recorded.error) throw new Error("CONFORMANCE_EVENT_PACKET_READ_FAILED");
  if (recorded.data === null) return null;
  if (recorded.data === undefined || Buffer.byteLength(JSON.stringify(recorded.data)) > EVENT_BATCH_PACKET_MAXIMUM_BYTES + 256) {
    throw new Error("CONFORMANCE_EVENT_PACKET_SIZE_LIMIT");
  }
  const stored = persistedEventBatchMeasurementSchema.parse(recorded.data);
  if (canonicalHash(stored.packet.identity) !== canonicalHash(identity)
    || hashEventBatchMeasurementPacket(stored.packet) !== stored.packetSha256) {
    throw new Error("CONFORMANCE_EVENT_PACKET_READBACK_MISMATCH");
  }
  return stored;
}
