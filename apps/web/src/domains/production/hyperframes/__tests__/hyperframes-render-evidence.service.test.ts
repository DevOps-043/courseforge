import assert from "node:assert/strict";
import test from "node:test";
import { assessHyperframesRenderEvidence } from "../hyperframes-render-evidence.service";
import { COMPOSITION_CONFORMANCE_THRESHOLDS } from "../../composition-editor/composition-preview-render-conformance";

const organizationId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";
const revisionId = "44444444-4444-4444-8444-444444444444";
const assetId = "55555555-5555-4555-8555-555555555555";
const documentHash = "a".repeat(64);
const projectHash = "b".repeat(64);

function fixture() {
  return {
    organizationId,
    request: {
      id: requestId, organization_id: organizationId, production_job_id: jobId,
      composition_revision_id: revisionId, provider_render_id: "provider-render-1",
      provider_status: "COMPLETED", import_status: "COMPLETED",
    },
    job: {
      id: jobId, organization_id: organizationId, status: "SUCCEEDED",
      input_snapshot: { revision_id: revisionId, project_hash: projectHash },
      output_snapshot: { final_video: { asset_id: assetId } },
    },
    revision: {
      id: revisionId, organization_id: organizationId, project_hash: projectHash,
      manifest: {
        draft_document_hash: documentHash,
        conformance_contract: {
          assets: [], canvas: { durationSeconds: 2, fps: 25, height: 90, width: 160 },
          checkpoints: [{ frameIndex: 0, reasons: ["start"], timeSeconds: 0 }],
          compilerContract: "courseforge-composition-preview-compiler-v1", documentHash,
          renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" },
          schemaVersion: 1, thresholds: COMPOSITION_CONFORMANCE_THRESHOLDS,
        },
      },
    },
    asset: {
      id: assetId, organization_id: organizationId, production_job_id: jobId,
      provider: "hyperframes", asset_type: "FINAL_VIDEO", file_size_bytes: 1234,
      mime_type: "video/mp4", metadata: { render_request_id: requestId, provider_render_id: "provider-render-1", integrity_method: "storage-stream-sha256-v1" },
      storage_bucket: "production-videos",
      storage_path: `production-videos/organizations/${organizationId}/artifacts/a/components/b/renders/${requestId}/final.mp4`,
      checksum: "c".repeat(64),
    },
  };
}

test("verifica la cadena persistida cuando todas las identidades coinciden", () => {
  const evidence = assessHyperframesRenderEvidence(fixture());
  assert.equal(evidence.status, "LINEAGE_VERIFIED");
  assert.deepEqual(evidence.failures, []);
  assert.equal(evidence.documentHash, documentHash);
  assert.equal(evidence.finalVideoSha256, "c".repeat(64));
});

test("el importador TUS actual no emite checksum y no puede certificar el MP4", () => {
  const input = fixture();
  input.asset.checksum = "";
  const evidence = assessHyperframesRenderEvidence(input);
  assert.equal(evidence.status, "INCOMPLETE");
  assert.deepEqual(evidence.failures, ["final_video_checksum_missing"]);
});

test("un checksum sin marca del verificador de Storage no acredita los bytes finales", () => {
  const input = fixture();
  delete (input.asset.metadata as Record<string, unknown>).integrity_method;
  const evidence = assessHyperframesRenderEvidence(input);
  assert.equal(evidence.status, "INCOMPLETE");
  assert.equal(evidence.finalVideoSha256, null);
});

test("rechaza enlaces cruzados de empresa, revisión, proveedor y asset", () => {
  const input = fixture();
  input.job.organization_id = "other-tenant";
  input.job.input_snapshot.revision_id = "other-revision";
  input.asset.metadata.render_request_id = "other-request";
  input.revision.manifest.draft_document_hash = "d".repeat(64);
  const evidence = assessHyperframesRenderEvidence(input);
  assert.equal(evidence.status, "INCOMPLETE");
  assert.deepEqual(evidence.failures, ["job_mismatch", "document_hash_mismatch", "job_revision_mismatch", "final_asset_mismatch"]);
});

test("no considera listo un render aún en importación ni una ruta ajena", () => {
  const input = fixture();
  input.request.import_status = "UPLOADING";
  input.asset.storage_path = `production-videos/organizations/${organizationId}/artifacts/a/components/b/renders/other/final.mp4`;
  const evidence = assessHyperframesRenderEvidence(input);
  assert.equal(evidence.status, "INCOMPLETE");
  assert.deepEqual(evidence.failures, ["render_not_completed", "final_asset_mismatch"]);
});
