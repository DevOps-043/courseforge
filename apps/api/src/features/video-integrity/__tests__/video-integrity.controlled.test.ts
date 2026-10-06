import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {mkdtemp, readFile, rm, rmdir} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {checkImportedHyperframesVideo, snapshotImportedHyperframesVideo, verifyImportedHyperframesVideo} from "../video-integrity.service";
import {classifyVideoIntegrityFailure} from "../video-integrity.worker";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const bytes = Buffer.from("synthetic controlled bytes, not an MP4");
const checksum = createHash("sha256").update(bytes).digest("hex");

function fixture() {
  const organizationId = id(1), requestId = id(2), executionId = id(3), revisionId = id(4), jobId = id(5), assetId = id(6);
  const documentHash = "a".repeat(64), projectHash = "b".repeat(64), receiptSha256 = "c".repeat(64);
  const path = `organizations/${organizationId}/controlled-renders/${requestId}/${executionId}/${checksum}.mp4`;
  const rows: Record<string, any> = {
    hyperframes_render_requests: {id: requestId, organization_id: organizationId, production_job_id: jobId,
      composition_revision_id: revisionId, provider_render_id: null, provider_status: "COMPLETED", import_status: "COMPLETED"},
    production_jobs: {id: jobId, organization_id: organizationId, artifact_id: id(7), material_component_id: id(8), status: "SUCCEEDED",
      input_snapshot: {render_backend: "CONTROLLED", revision_id: revisionId, project_hash: projectHash},
      output_snapshot: {render_backend: "CONTROLLED", render_execution_id: executionId,
        supervisor_receipt_sha256: receiptSha256, final_video: {asset_id: assetId}}},
    video_composition_revisions: {id: revisionId, organization_id: organizationId, project_hash: projectHash,
      manifest: {draft_document_hash: documentHash, conformance_contract: {documentHash, schemaVersion: 4, renderExecution: {backend: "CONTROLLED"}}}},
    production_assets: {id: assetId, organization_id: organizationId, production_job_id: jobId, provider: "hyperframes", asset_type: "FINAL_VIDEO",
      metadata: {render_backend: "CONTROLLED", render_request_id: requestId, render_execution_id: executionId,
        composition_revision_id: revisionId, supervisor_receipt_sha256: receiptSha256, integrity_method: "storage-stream-sha256-v1"},
      mime_type: "video/mp4", file_size_bytes: bytes.length, storage_bucket: "production-videos", storage_path: `production-videos/${path}`, checksum},
  };
  const state = {gates: 0, fetches: 0, rejectBefore: false, rejectAfter: false, failAfter: false, payload: bytes};
  const supabase = {
    from(table: string) {const query = {select: () => query, eq: () => query,
      maybeSingle: async () => ({data: rows[table], error: null})}; return query;},
    storage: {from: () => ({createSignedUrl: async (objectPath: string) => {
      assert.equal(objectPath, path);
      return {error: null, data: {signedUrl: `https://example.supabase.co/storage/v1/object/sign/production-videos/${path}?token=ephemeral`}};
    }})},
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "check_controlled_render_video_authority", "CONTROLLED must never write through the Cloud checksum RPC");
      assert.deepEqual(args, {p_organization_id: organizationId, p_request_id: requestId, p_execution_id: executionId,
        p_revision_id: revisionId, p_production_job_id: jobId, p_asset_id: assetId,
        p_receipt_sha256: receiptSha256, p_video_sha256: checksum, p_size_bytes: bytes.length});
      state.gates++;
      return {data: !state.rejectBefore && !(state.rejectAfter && state.gates > 1),
        error: state.failAfter && state.gates > 1 ? {message: "private provider detail"} : null};
    },
  };
  const input = {organizationId, requestId, supabase: supabase as never, supabaseUrl: "https://example.supabase.co",
    fetchImpl: (async () => {state.fetches++; return new Response(state.payload, {headers: {"content-type": "video/mp4"}});}) as typeof fetch};
  return {input, rows, state, documentHash, assetId};
}

test("controlled check and verification read bound authority twice and never invoke Cloud checksum write", async () => {
  const f = fixture();
  assert.deepEqual(await checkImportedHyperframesVideo(f.input), {assetId: f.assetId, checksum,
    documentHash: f.documentHash, sizeBytes: bytes.length, status: "MATCH"});
  assert.equal(f.state.gates, 2);
  const second = fixture();
  assert.equal((await verifyImportedHyperframesVideo(second.input)).checksum, checksum);
  assert.equal(second.state.gates, 2);
});

test("controlled snapshots remain exclusive and bind the same stored bytes", async () => {
  const f = fixture(), directory = await mkdtemp(join(tmpdir(), "controlled-integrity-"));
  const destinationPath = join(directory,"owned.mp4");
  try {
    assert.equal((await snapshotImportedHyperframesVideo({...f.input, destinationPath})).status, "MATCH");
    assert.deepEqual(await readFile(destinationPath), bytes);
    await assert.rejects(snapshotImportedHyperframesVideo({...f.input, destinationPath}));
    assert.equal(f.state.gates, 2);
  } finally {await rm(destinationPath,{force:true}); await rmdir(directory);}
});

test("mixed Cloud provenance, missing checksum and changed tenant/execution/revision fail before Storage", async () => {
  const mutations = [
    (r: Record<string,any>) => {r.hyperframes_render_requests.provider_render_id = "cloud-id";},
    (r: Record<string,any>) => {r.production_assets.metadata.provider_render_id = "cloud-id";},
    (r: Record<string,any>) => {r.production_assets.checksum = null;},
    (r: Record<string,any>) => {r.production_assets.organization_id = id(99);},
    (r: Record<string,any>) => {r.production_jobs.output_snapshot.render_execution_id = id(99);},
    (r: Record<string,any>) => {r.production_assets.metadata.composition_revision_id = id(99);},
    (r: Record<string,any>) => {r.production_jobs.input_snapshot.render_backend = "CLOUD";},
    (r: Record<string,any>) => {r.production_assets.storage_path = "production-videos/other.mp4";},
  ];
  for (const mutate of mutations) {
    const f = fixture(); mutate(f.rows);
    await assert.rejects(checkImportedHyperframesVideo(f.input), /LINEAGE_MISMATCH/);
    assert.equal(f.state.fetches, 0); assert.equal(f.state.gates, 0);
  }
});

test("controlled authority rejection before/after read and failed refresh cannot emit MATCH", async () => {
  for (const phase of ["rejectBefore","rejectAfter","failAfter"] as const) {
    const f = fixture(); f.state[phase] = true;
    await assert.rejects(checkImportedHyperframesVideo(f.input), /VIDEO_INTEGRITY_AUTHORITY_(REJECTED|UNAVAILABLE)/);
    assert.equal(f.state.fetches, phase === "rejectBefore" ? 0 : 1);
  }
  assert.equal(classifyVideoIntegrityFailure(new Error("VIDEO_INTEGRITY_AUTHORITY_REJECTED")).retryable, false);
  assert.equal(classifyVideoIntegrityFailure(new Error("VIDEO_INTEGRITY_AUTHORITY_UNAVAILABLE")).retryable, true);
});

test("controlled same-size overwrite is rejected even with valid stored authority", async () => {
  const f = fixture(); f.state.payload = Buffer.from(bytes); f.state.payload[0] ^= 1;
  await assert.rejects(verifyImportedHyperframesVideo(f.input), /VIDEO_INTEGRITY_OVERWRITTEN/);
  assert.equal(f.state.gates, 2);
});
