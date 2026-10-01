import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm, rmdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { buildCompositionEventBatchAuthorization, prepareCompositionEventBatchContracts } from "../composition-conformance-event-batch-contract";
import { persistVisualConformanceEvidence } from "../qa/composition-conformance-evidence-persistence";
import { readPersistedVisualConformanceEvidence } from "../qa/composition-conformance-evidence-reader";
import { textParityEvidenceHash, TEXT_PARITY_REPEATABILITY } from "../qa/composition-text-parity-evidence";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";

const identifier = "70000000-0000-4000-8000-000000000001";
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(run: (state: Awaited<ReturnType<typeof createFixture>>) => Promise<void>) {
  const state = await createFixture();
  try {await run(state);}
  finally {
    for (const name of await readdir(state.captureDirectory)) await rm(join(state.captureDirectory, name));
    await rmdir(state.captureDirectory);
    assert.deepEqual(await readdir(state.outputParentDirectory), []);
    await rmdir(state.outputParentDirectory);
  }
}
async function createFixture() {
  const document = createInitialCompositionDocument({animatedDeck: null, assets: [{productionAssetId: identifier,
    checksum: "f".repeat(64), fileSizeBytes: 100, durationSeconds: 10, mimeType: "video/mp4", hasAudio: false,
    publicUrl: null, storageBucket: "production-assets", storagePath: "fixture.mp4", timelineRole: "BROLL"}],
    plan: {title: "Partitions", subtitle: "Private controlled evidence", accentColor: "#38BDF8", durationSeconds: 10}});
  document.canvas.durationSeconds = 10;
  const original = document.clips.find((clip) => clip.source.type === "PRODUCTION_ASSET");
  if (!original) throw new Error("Expected production clip");
  document.clips = Array.from({length: 30}, (_, index) => ({...structuredClone(original), id: `clip-${index}`, hfId: `visual-${index}`,
    startSeconds: index * 0.2, durationSeconds: 0.16}));
  const parentContract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document),
    assets: [{id: identifier, checksum: "f".repeat(64)}], contractVersion: 4, eventCheckpoints: true,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  const prepared = prepareCompositionEventBatchContracts({document, parentContract});
  assert.ok(prepared.batchCount > 1);
  const {contract, batchContractSha256} = prepared.select(1);
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const manifest = {conformance_reference_version: 1, conformance_contract: parentContract,
    conformance_event_batch_authorization: buildCompositionEventBatchAuthorization({document, parentContract})};
  const lineage = {policy: "VERIFIED_ROOT_EVENT_PARTITION_V1", scope: "ONE_PREVIEW_PARTITION_NOT_GLOBAL_RENDER_ATTESTATION",
    parentContractSha256: prepared.parentContractSha256, batchContractSha256, batch: contract.checkpointBatch};
  const outputParentDirectory = await mkdtemp(join(tmpdir(), "event-visual-evidence-"));
  const captureDirectory = join(outputParentDirectory, "capture"); await mkdir(captureDirectory);
  const png = await sharp({create: {width: contract.canvas.width, height: contract.canvas.height,
    channels: 4, background: "#020617"}}).png().toBuffer();
  const frames = contract.checkpoints.map((checkpoint) => ({...checkpoint, sha256: sha256(png), sizeBytes: png.length}))
    .map(({frameIndex, timeSeconds, sha256, sizeBytes}) => ({frameIndex, timeSeconds, sha256, sizeBytes}));
  const textParity = {schemaVersion: 1, policy: COMPOSITION_TEXT_PARITY_POLICY.id, repeatability: TEXT_PARITY_REPEATABILITY,
    checkpoints: contract.textParity.checkpoints.map((checkpoint) => ({...checkpoint, policy: COMPOSITION_TEXT_PARITY_POLICY.id,
      status: "CAPTURED", regions: [], unavailable: []}))};
  assert.ok(textParity.checkpoints.every((checkpoint) => checkpoint.expectedTexts.length === 0));
  const receipt = {schemaVersion: 1, organizationId: identifier, revisionId: identifier, projectHash: "a".repeat(64),
    documentHash: contract.documentHash, status: "VISUAL_CAPTURED_AUDIO_PENDING", assetCount: 1, mediaBytes: 100,
    networkPolicy: "EXACT_LOCAL_ALLOWLIST_V1", eventBatchLineage: lineage, textParitySha256: textParityEvidenceHash(textParity), frames};
  await writeFile(join(captureDirectory, "capture-receipt.json"), JSON.stringify(receipt));
  await writeFile(join(captureDirectory, "preview-metadata.json"), JSON.stringify({documentHash: contract.documentHash,
    textParity, frames: frames.map(({frameIndex, timeSeconds}) => ({frameIndex, timeSeconds}))}));
  for (const frame of frames) await writeFile(join(captureDirectory, `frame-${frame.frameIndex}.png`), png);
  const stored = new Map<string, Buffer>(), calls: string[] = [];
  let record: Record<string, unknown> | null = null;
  const supabase = {from() {
    return {select() {return this;}, eq() {return this;}, async maybeSingle() {
      return {error: null, data: {id: identifier, organization_id: identifier, project_hash: receipt.projectHash, manifest}};
    }};
  }, storage: {from() {return {
    async upload(path: string, bytes: Buffer, options: {upsert: boolean}) {
      assert.equal(options.upsert, false); calls.push("upload");
      if (stored.has(path)) return {error: {message: "exists"}};
      stored.set(path, Buffer.from(bytes)); return {error: null};
    },
    async download(path: string) {calls.push("download"); const bytes = stored.get(path);
      return {error: null, data: bytes ? new Blob([new Uint8Array(bytes)]) : null};},
  };}}, async rpc(name: string, params: Record<string, unknown>) {
    calls.push(name); assert.equal(params.p_batch_index, 1);
    if (name === "record_hyperframes_event_visual_conformance_evidence") {
      assert.deepEqual(params.p_contract, contract); assert.deepEqual(params.p_lineage, lineage);
      record = {organizationId: identifier, revisionId: identifier, checksum: params.p_bundle_sha256,
        projectHash: receipt.projectHash, documentHash: contract.documentHash,
        storagePath: `${identifier}/${identifier}/${params.p_bundle_sha256}.zip`, sizeBytes: params.p_file_size_bytes,
        frames: params.p_frames, status: receipt.status, contract: params.p_contract,
        eventAuthorization: {parentContract: manifest.conformance_contract,
          batchAuthorization: manifest.conformance_event_batch_authorization, lineage: params.p_lineage}};
      return {error: null, data: params.p_bundle_sha256};
    }
    assert.equal(name, "read_hyperframes_event_visual_conformance_evidence");
    return {error: null, data: record};
  }};
  const params = {supabase: supabase as never, organizationId: identifier, revisionId: identifier,
    captureDirectory, eventBatchIndex: 1, eventContract: contract};
  return {params, manifest, contract, stored, calls, outputParentDirectory, captureDirectory,
    getRecord: () => record!};
}

test("a non-root partition persists, retries without overwrite and reads through its scoped event RPC", async () => {
  await fixture(async (state) => {
    const persisted = await persistVisualConformanceEvidence(state.params);
    assert.equal((await persistVisualConformanceEvidence(state.params)).checksum, persisted.checksum);
    assert.equal(state.stored.size, 1);
    const read = await readPersistedVisualConformanceEvidence({...state.params, checksum: persisted.checksum,
      outputParentDirectory: state.outputParentDirectory});
    try {assert.deepEqual(JSON.parse(await readFile(read.contractPath, "utf8")), state.contract);}
    finally {await read.cleanup();}
    assert.ok(state.calls.includes("record_hyperframes_event_visual_conformance_evidence"));
    assert.ok(state.calls.includes("read_hyperframes_event_visual_conformance_evidence"));
  });
});

test("unfrozen child or mismatched index fails before Storage writes", async () => {
  await fixture(async (state) => {
    await assert.rejects(persistVisualConformanceEvidence({...state.params, eventBatchIndex: 0}), /INDEX_MISMATCH/);
    state.manifest.conformance_event_batch_authorization.batchContractSha256[1] = "e".repeat(64);
    await assert.rejects(persistVisualConformanceEvidence(state.params), /AUTHORIZATION_MISMATCH/);
    assert.equal(state.calls.length, 0);
  });
});

test("private child reader rejects a loosened contract even when the recorded lineage still names the frozen hash", async () => {
  await fixture(async (state) => {
    const persisted = await persistVisualConformanceEvidence(state.params);
    const record = state.getRecord(); record.contract = {...state.contract, documentHash: "e".repeat(64)};
    const callsBefore = state.calls.filter((call) => call === "download").length;
    await assert.rejects(readPersistedVisualConformanceEvidence({...state.params, checksum: persisted.checksum,
      outputParentDirectory: state.outputParentDirectory}), /LINEAGE_MISMATCH/);
    assert.equal(state.calls.filter((call) => call === "download").length, callsBefore);
  });
});

test("missing scoped authorization or foreign tenant records fail before downloading a child bundle", async () => {
  for (const failure of ["authorization", "tenant"] as const) await fixture(async (state) => {
    const persisted = await persistVisualConformanceEvidence(state.params);
    const record = state.getRecord();
    if (failure === "authorization") delete record.eventAuthorization;
    else record.organizationId = "80000000-0000-4000-8000-000000000001";
    const callsBefore = state.calls.filter((call) => call === "download").length;
    await assert.rejects(readPersistedVisualConformanceEvidence({...state.params, checksum: persisted.checksum,
      outputParentDirectory: state.outputParentDirectory}), /AUTHORIZATION_REQUIRED|RECORD_MISMATCH/);
    assert.equal(state.calls.filter((call) => call === "download").length, callsBefore);
  });
});

test("prepared event SQL keeps private scope and distinct root/audio records", async () => {
  const sql = await readFile("supabase/migrations/20261001140000_persist_event_visual_conformance_evidence.sql", "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON private\.hyperframes_event_visual_conformance_evidence FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(sql, /SET search_path = pg_catalog, public, private/g);
  assert.match(sql, /WHERE id = p_revision_id AND organization_id = p_organization_id FOR SHARE/);
  assert.match(sql, /ON CONFLICT \(revision_id, batch_index, bundle_sha256\) DO NOTHING/);
  assert.doesNotMatch(sql, /ALTER TABLE private\.hyperframes_visual_conformance_evidence|UPDATE private\.hyperframes_audio/);
});
