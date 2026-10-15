import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { buildCompositionEventBatchAuthorization, prepareCompositionEventBatchContracts } from "../composition-conformance-event-batch-contract";
import { eventBatchMeasurementPacketSchema, executeCompositionEventCheckpointBatches, hashEventBatchMeasurementPacket,
  type EventBatchMeasurementPacket } from "../qa/composition-conformance-event-batch-execution";
import { persistCompositionEventBatchMeasurement, readCompositionEventBatchMeasurement } from "../qa/composition-conformance-event-batch-persistence";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";

function fixture() {
  const document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
    plan: {title: "Private packets", subtitle: "Resume", accentColor: "#38BDF8", durationSeconds: 5}});
  const parentContract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [],
    contractVersion: 4, eventCheckpoints: true, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const prepared = prepareCompositionEventBatchContracts({document, parentContract}), selected = prepared.select(0);
  if (selected.contract.schemaVersion !== 4) throw new Error("Expected v4");
  const input = {document, parentContract, organizationId: "70000000-0000-4000-8000-000000000001",
    revisionId: "70000000-0000-4000-8000-000000000002", projectHash: "a".repeat(64), videoSha256: "b".repeat(64)};
  const packet = eventBatchMeasurementPacketSchema.parse({schemaVersion: 1, scope: "EVENT_VISUAL_SAMPLE_PACKET_NOT_INDEPENDENT_ATTESTATION",
    identity: {organizationId: input.organizationId, revisionId: input.revisionId, projectHash: input.projectHash,
      videoSha256: input.videoSha256, documentHash: prepared.documentHash, parentContractSha256: prepared.parentContractSha256,
      batchContractSha256: selected.batchContractSha256, batch: selected.contract.checkpointBatch},
    previewDocumentHash: prepared.documentHash, renderDocumentHash: prepared.documentHash,
    samples: selected.contract.checkpoints.map((checkpoint) => ({frameIndex: checkpoint.frameIndex, meanAbsoluteError: 0,
      mismatchedPixelRatio: 0, psnrDb: 99, temporalDriftMs: 0, ssim: 1, width: document.canvas.width, height: document.canvas.height,
      textParity: {policy: COMPOSITION_TEXT_PARITY_POLICY.id, status: "PASS", expectedRegionCount: 0, checkedRegionCount: 0,
        maximumAcceptedDisplacementPixels: 0, regions: []}}))});
  const manifest = {conformance_reference_version: 1, conformance_contract: parentContract,
    conformance_event_batch_authorization: buildCompositionEventBatchAuthorization({document, parentContract})};
  const records = new Map<string, {packetSha256: string; packet: EventBatchMeasurementPacket}>(), calls: string[] = [];
  let readFailure = false, recordFailure = false;
  const database = {from() {return {select() {return this;}, eq() {return this;}, async maybeSingle() {
    return {error: null, data: {id: input.revisionId, organization_id: input.organizationId, project_hash: input.projectHash, manifest}};
  }};}, async rpc(name: string, params: Record<string, unknown>) {
    calls.push(name); const key = JSON.stringify(params.p_identity);
    if (name === "record_hyperframes_event_batch_measurement" || name === "record_hyperframes_selected_event_batch_measurement") {
      assert.equal(params.p_visual_sha256, "c".repeat(64));
      const next = {packetSha256: String(params.p_packet_sha256), packet: structuredClone(params.p_packet) as EventBatchMeasurementPacket};
      if (recordFailure || (records.has(key) && JSON.stringify(records.get(key)) !== JSON.stringify(next))) return {error: {code: "conflict"}, data: null};
      records.set(key, next); return {error: null, data: next.packetSha256};
    }
    assert.ok(name === "read_hyperframes_event_batch_measurement" || name === "read_hyperframes_selected_event_batch_measurement");
    return {error: readFailure ? {code: "unavailable"} : null, data: structuredClone(records.get(key) ?? null)};
  }};
  return {input, packet, manifest, records, calls, supabase: database as never,
    failRead: () => {readFailure = true;}, failRecord: () => {recordFailure = true;}};
}

test("private packets round-trip and coordinator resumes without measuring again", async () => {
  const state = fixture(); let measurements = 0;
  const adapters = {
    readBatch: (identity: unknown) => readCompositionEventBatchMeasurement({supabase: state.supabase, identity}),
    measureBatch: async () => {measurements++; return state.packet;},
    persistBatch: async (packet: EventBatchMeasurementPacket) => {
      await persistCompositionEventBatchMeasurement({supabase: state.supabase, packet, visualChecksum: "c".repeat(64)});
    },
  };
  const first = await executeCompositionEventCheckpointBatches(state.input, adapters);
  assert.equal(first.status, "PASS"); assert.equal(measurements, 1);
  const resumed = await executeCompositionEventCheckpointBatches(state.input, adapters);
  assert.equal(resumed.resumedBatchCount, 1); assert.equal(measurements, 1);
  assert.deepEqual(first.batches, resumed.batches);
  await adapters.persistBatch(state.packet); assert.equal(state.records.size, 1);
});

test("exact visual checksum partitions immutable packet identity and selects fenced RPCs", async () => {
  const state = fixture(), packet = structuredClone(state.packet);
  packet.identity.visualReferenceSha256 = "c".repeat(64);
  await persistCompositionEventBatchMeasurement({supabase: state.supabase, packet, visualChecksum: "c".repeat(64)});
  assert.ok(await readCompositionEventBatchMeasurement({supabase: state.supabase, identity: packet.identity}));
  assert.equal(await readCompositionEventBatchMeasurement({supabase: state.supabase,
    identity: {...packet.identity, visualReferenceSha256: "d".repeat(64)}}), null);
  assert.deepEqual(state.calls, ["record_hyperframes_selected_event_batch_measurement",
    "read_hyperframes_selected_event_batch_measurement", "read_hyperframes_selected_event_batch_measurement"]);
  await assert.rejects(persistCompositionEventBatchMeasurement({supabase: state.supabase, packet,
    visualChecksum: "d".repeat(64)}), /REFERENCE_MISMATCH/);
});

test("selected-reference migration restricts checksums and preserves installed finalization gates", async () => {
  const sql = await readFile("supabase/migrations/20261008190000_bind_selected_event_measurements.sql", "utf8");
  assert.match(sql, /e\.identity = p_identity AND e\.visual_sha256 = p_identity->>'visualReferenceSha256'/);
  assert.match(sql, /record_hyperframes_event_batch_measurement\(p_identity, p_packet, p_packet_sha256, p_visual_sha256\)/);
  assert.match(sql, /pg_get_functiondef/);
  assert.match(sql, /MIGRATION_PRECONDITION_INVALID/);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE|DO UPDATE/);
});

test("another MP4 gets no matching packet; a read error is not a missing record", async () => {
  const state = fixture();
  await persistCompositionEventBatchMeasurement({supabase: state.supabase, packet: state.packet, visualChecksum: "c".repeat(64)});
  assert.equal(await readCompositionEventBatchMeasurement({supabase: state.supabase,
    identity: {...state.packet.identity, videoSha256: "e".repeat(64)}}), null);
  state.failRead();
  await assert.rejects(readCompositionEventBatchMeasurement({supabase: state.supabase, identity: state.packet.identity}), /READ_FAILED/);
});

test("altered packet, foreign identity or unfrozen contract cannot be resumed or persisted", async () => {
  for (const failure of ["checksum", "identity", "authorization", "tenant"] as const) {
    const state = fixture();
    await persistCompositionEventBatchMeasurement({supabase: state.supabase, packet: state.packet, visualChecksum: "c".repeat(64)});
    const stored = [...state.records.values()][0]!;
    if (failure === "checksum") stored.packet.samples[0]!.meanAbsoluteError = 20;
    if (failure === "identity") {stored.packet.identity.videoSha256 = "e".repeat(64); stored.packetSha256 = hashEventBatchMeasurementPacket(stored.packet);}
    if (failure === "authorization") state.manifest.conformance_event_batch_authorization.batchContractSha256[0] = "e".repeat(64);
    const identity = failure === "tenant" ? {...state.packet.identity, organizationId: "80000000-0000-4000-8000-000000000001"} : state.packet.identity;
    await assert.rejects(readCompositionEventBatchMeasurement({supabase: state.supabase, identity}));
    if (failure === "authorization" || failure === "tenant") assert.equal(state.calls.length, 1);
  }
});

test("conflicting or failed writes never overwrite a previous packet", async () => {
  const state = fixture();
  const write = (packet: unknown) => persistCompositionEventBatchMeasurement({supabase: state.supabase, packet, visualChecksum: "c".repeat(64)});
  await write(state.packet); const changed = structuredClone(state.packet); changed.samples[0]!.meanAbsoluteError = 20;
  await assert.rejects(write(changed), /RECORD_FAILED/);
  state.failRecord(); await assert.rejects(write(state.packet), /RECORD_FAILED/);
  assert.equal([...state.records.values()][0]!.packetSha256, hashEventBatchMeasurementPacket(state.packet));
});

test("packet migration keeps private permissions, reference FK and immutable conflict checks", async () => {
  const sql = await readFile("supabase/migrations/20261001150000_persist_event_batch_measurements.sql", "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON private\.hyperframes_event_batch_measurements FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /FOREIGN KEY \(revision_id, batch_index, visual_sha256\)/);
  assert.match(sql, /ON CONFLICT \(identity\) DO NOTHING/);
  assert.match(sql, /SET search_path = pg_catalog, public, private/);
  assert.doesNotMatch(sql, /DO UPDATE|CREATE POLICY|status text/);
});

test("finalization migration atomically binds all packet identities and preserves legacy audio/integrity gates", async () => {
  const sql = await readFile("supabase/migrations/20261001160000_bind_event_summary_to_job_finalization.sql", "utf8");
  assert.match(sql, /WHERE identity = v_identity FOR SHARE/);
  assert.match(sql, /v_packet\.packet_sha256 IS DISTINCT FROM v_batch->>'packetSha256'/);
  assert.match(sql, /v_packet\.visual_sha256 FOR SHARE/);
  assert.match(sql, /v_revision\.manifest->'conformance_event_batch_authorization'/);
  assert.match(sql, /lease_expires_at > now\(\) FOR UPDATE/);
  assert.match(sql, /RETURN private\.finish_hyperframes_conformance_job_before_events\(p_job_id, p_lease_token, p_report, p_error_code, p_retryable\)/);
  assert.match(sql, /REVOKE ALL ON FUNCTION private\.finish_hyperframes_conformance_job_before_events[^;]+FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /CONFORMANCE_JOB_EVENT_GLOBAL_GATE_PENDING/);
  assert.doesNotMatch(sql, /DELETE FROM|TRUNCATE|GRANT EXECUTE ON FUNCTION private/);
});
