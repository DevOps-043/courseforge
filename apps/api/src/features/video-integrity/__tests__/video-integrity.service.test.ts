import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildVerifiedVideoReceipt, writeVerifiedVideoReceipt } from "../video-integrity.receipt";
import { assertTrustedSignedVideoUrl, assertUnchangedVideoChecksum, checkImportedHyperframesVideo, hashStoredVideoResponse, snapshotImportedHyperframesVideo, verifyImportedHyperframesVideo } from "../video-integrity.service";

const payload = new TextEncoder().encode("small synthetic MP4 bytes");

test("abort interrupts an outstanding streamed read without exposing caller reasons", async () => {
  const cancellation = new AbortController(); let cancelled = false;
  const response = new Response(new ReadableStream({cancel() {cancelled = true;}}));
  const reading = hashStoredVideoResponse(response, payload.byteLength, undefined, cancellation.signal);
  cancellation.abort("private signed URL");
  await assert.rejects(reading, error => error instanceof Error && error.message === "VIDEO_INTEGRITY_CANCELLED");
  assert.equal(cancelled, true); assert.equal(response.body!.locked, false);
});
test("abort after snapshot sink writes cannot emit a successful checksum", async () => {
  const cancellation = new AbortController();
  await assert.rejects(hashStoredVideoResponse(new Response(payload), payload.byteLength,
    async () => {cancellation.abort("private reason");}, cancellation.signal), /VIDEO_INTEGRITY_CANCELLED/);
});

test("emite un recibo estricto solo para una comprobación MATCH y nunca sobrescribe evidencia", async () => {
  const video = { checksum: "a".repeat(64), documentHash: "b".repeat(64), status: "MATCH" as const };
  assert.deepEqual(buildVerifiedVideoReceipt(video), { documentHash: video.documentHash, videoSha256: video.checksum });
  assert.throws(() => buildVerifiedVideoReceipt({ ...video, checksum: "invalid" }), /VIDEO_INTEGRITY_RECEIPT_INPUT_INVALID/);
  const directory = await mkdtemp(join(tmpdir(), "courseforge-video-receipt-"));
  const outputPath = join(directory, "receipt.json");
  try {
    await writeVerifiedVideoReceipt(outputPath, video);
    assert.deepEqual(JSON.parse(await readFile(outputPath, "utf8")), buildVerifiedVideoReceipt(video));
    await assert.rejects(writeVerifiedVideoReceipt(outputPath, video), /VIDEO_INTEGRITY_RECEIPT_EXISTS/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("calcula SHA-256 en streaming y exige tamaño exacto", async () => {
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(payload.slice(0, 5));
      controller.enqueue(payload.slice(5));
      controller.close();
    },
  }), { headers: { "Content-Type": "video/mp4" } });
  assert.equal(await hashStoredVideoResponse(response, payload.byteLength), createHash("sha256").update(payload).digest("hex"));
  await assert.rejects(hashStoredVideoResponse(new Response(payload), payload.byteLength + 1), /VIDEO_INTEGRITY_TRUNCATED_BODY/);
  await assert.rejects(hashStoredVideoResponse(new Response(payload), payload.byteLength - 1), /VIDEO_INTEGRITY_OVERSIZED_BODY/);
});

test("entrega los mismos bytes al sink del snapshot y propaga fallo de escritura", async () => {
  const chunks: Uint8Array[] = [];
  const checksum = await hashStoredVideoResponse(new Response(payload), payload.byteLength, async (chunk) => { chunks.push(chunk); });
  assert.deepEqual(Buffer.concat(chunks), Buffer.from(payload));
  assert.equal(checksum, createHash("sha256").update(payload).digest("hex"));
  await assert.rejects(hashStoredVideoResponse(new Response(payload), payload.byteLength,
    async () => { throw new Error("write failed"); }), /write failed/);
});

test("rechaza respuestas parciales y MIME ajeno", async () => {
  await assert.rejects(hashStoredVideoResponse(new Response(payload, {
    status: 206, headers: { "Content-Range": `bytes 0-${payload.byteLength - 1}/${payload.byteLength}` },
  }), payload.byteLength), /VIDEO_INTEGRITY_STORAGE_RESPONSE_INVALID/);
  await assert.rejects(hashStoredVideoResponse(new Response(payload, {
    headers: { "Content-Type": "text/html" },
  }), payload.byteLength), /VIDEO_INTEGRITY_CONTENT_TYPE_INVALID/);
});

test("acepta solo el enlace firmado del objeto y origen de Storage esperados", () => {
  const objectPath = "organizations/org/artifacts/a/components/c/renders/r/final.mp4";
  const valid = `https://example.supabase.co/storage/v1/object/sign/production-videos/${objectPath}?token=opaque`;
  assert.doesNotThrow(() => assertTrustedSignedVideoUrl(valid, "https://example.supabase.co", objectPath));
  assert.throws(() => assertTrustedSignedVideoUrl(valid.replace("example.supabase.co", "evil.example"), "https://example.supabase.co", objectPath), /VIDEO_INTEGRITY_SIGNED_URL_INVALID/);
  assert.throws(() => assertTrustedSignedVideoUrl(valid.replace("/final.mp4", "/other.mp4"), "https://example.supabase.co", objectPath), /VIDEO_INTEGRITY_SIGNED_URL_INVALID/);
  assert.throws(() => assertTrustedSignedVideoUrl(valid.replace("https:", "http:"), "https://example.supabase.co", objectPath), /VIDEO_INTEGRITY_SIGNED_URL_INVALID/);
});

test("la revalidación exige un digest previamente emitido por el verificador", () => {
  const checksum = createHash("sha256").update(payload).digest("hex");
  assert.throws(() => assertUnchangedVideoChecksum(checksum, null, checksum), /VIDEO_INTEGRITY_NOT_VERIFIED/);
  assert.throws(() => assertUnchangedVideoChecksum("invalid", "storage-stream-sha256-v1", checksum), /VIDEO_INTEGRITY_NOT_VERIFIED/);
  assert.doesNotThrow(() => assertUnchangedVideoChecksum(checksum, "storage-stream-sha256-v1", checksum));
});

test("registra el digest solo tras leer el objeto final enlazado", async () => {
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const requestId = "22222222-2222-4222-8222-222222222222";
  const jobId = "33333333-3333-4333-8333-333333333333";
  const assetId = "44444444-4444-4444-8444-444444444444";
  const revisionId = "55555555-5555-4555-8555-555555555555";
  const documentHash = "a".repeat(64);
  const projectHash = "b".repeat(64);
  const objectPath = `organizations/${organizationId}/artifacts/a/components/c/renders/${requestId}/final.mp4`;
  const rows: Record<string, unknown> = {
    hyperframes_render_requests: { id: requestId, organization_id: organizationId, production_job_id: jobId, composition_revision_id: revisionId, provider_render_id: "remote-1", provider_status: "COMPLETED", import_status: "COMPLETED" },
    production_jobs: { id: jobId, organization_id: organizationId, artifact_id: "a", material_component_id: "c", status: "SUCCEEDED", input_snapshot: { revision_id: revisionId, project_hash: projectHash }, output_snapshot: { final_video: { asset_id: assetId } } },
    video_composition_revisions: { id: revisionId, organization_id: organizationId, project_hash: projectHash, manifest: { draft_document_hash: documentHash, conformance_contract: { documentHash } } },
    production_assets: { id: assetId, organization_id: organizationId, production_job_id: jobId, provider: "hyperframes", asset_type: "FINAL_VIDEO", metadata: { render_request_id: requestId, provider_render_id: "remote-1" }, mime_type: "video/mp4", file_size_bytes: payload.byteLength, storage_bucket: "production-videos", storage_path: `production-videos/${objectPath}` },
  };
  let recorded: Record<string, unknown> | null = null;
  const supabase = {
    from(table: string) {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({ data: rows[table], error: null }),
      };
      return query;
    },
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: `https://example.supabase.co/storage/v1/object/sign/production-videos/${objectPath}?token=opaque` }, error: null }) }) },
    rpc: async (_name: string, args: Record<string, unknown>) => { recorded = args; return { data: assetId, error: null }; },
  };
  const result = await verifyImportedHyperframesVideo({
    organizationId, requestId, supabase: supabase as never, supabaseUrl: "https://example.supabase.co",
    fetchImpl: async () => new Response(payload, { headers: { "Content-Type": "video/mp4" } }),
  });
  const expectedChecksum = createHash("sha256").update(payload).digest("hex");
  assert.equal(result.checksum, expectedChecksum);
  assert.equal(result.documentHash, documentHash);
  assert.deepEqual(recorded, {
    p_asset_id: assetId, p_checksum: expectedChecksum, p_file_size_bytes: payload.byteLength,
    p_organization_id: organizationId, p_request_id: requestId,
  });
  (rows.production_assets as Record<string, unknown>).checksum = expectedChecksum;
  (rows.production_assets as { metadata: Record<string, unknown> }).metadata.integrity_method = "storage-stream-sha256-v1";
  recorded = null;
  const checkInput = { organizationId, requestId, supabase: supabase as never, supabaseUrl: "https://example.supabase.co" };
  const checked = await checkImportedHyperframesVideo({
    ...checkInput, fetchImpl: async () => new Response(payload, { headers: { "Content-Type": "video/mp4" } }),
  });
  assert.equal(checked.status, "MATCH");
  assert.equal(checked.documentHash, documentHash);
  assert.equal(recorded, null, "la comprobación no debe escribir en la base de datos");
  const cancellation = new AbortController(); let fetchSignal: AbortSignal | undefined;
  await assert.rejects(checkImportedHyperframesVideo({...checkInput, signal: cancellation.signal,
    fetchImpl: async (_url, options) => {
      fetchSignal = options!.signal as AbortSignal; cancellation.abort("private token");
      return new Response(payload, {headers: {"Content-Type": "video/mp4"}});
    }}), /VIDEO_INTEGRITY_CANCELLED/);
  assert.equal(fetchSignal!.aborted, true);
  assert.equal((fetchSignal!.reason as Error).message, "VIDEO_INTEGRITY_CANCELLED");
  assert.equal(recorded, null);
  const snapshotDirectory = await mkdtemp(join(tmpdir(), "courseforge-verified-snapshot-"));
  const destinationPath = join(snapshotDirectory, "final.mp4");
  try {
    const snapshot = await snapshotImportedHyperframesVideo({ ...checkInput, destinationPath,
      fetchImpl: async () => new Response(payload, { headers: { "Content-Type": "video/mp4" } }) });
    assert.equal(snapshot.status, "MATCH"); assert.equal(snapshot.checksum, expectedChecksum);
    assert.deepEqual(await readFile(destinationPath), Buffer.from(payload));
    assert.equal(recorded, null);
    await assert.rejects(snapshotImportedHyperframesVideo({ ...checkInput, destinationPath }));
    assert.deepEqual(await readFile(destinationPath), Buffer.from(payload), "snapshot existente nunca se sobrescribe");
  } finally { await rm(destinationPath, { force: true }); await rmdir(snapshotDirectory); }
  const overwrittenBytes = new Uint8Array(payload);
  overwrittenBytes[0] = overwrittenBytes[0]! ^ 0xff;
  await assert.rejects(checkImportedHyperframesVideo({
    ...checkInput, fetchImpl: async () => new Response(overwrittenBytes, { headers: { "Content-Type": "video/mp4" } }),
  }), /VIDEO_INTEGRITY_OVERWRITTEN/);
  assert.equal(recorded, null);
  (rows.video_composition_revisions as { manifest: { draft_document_hash: string } }).manifest.draft_document_hash = "c".repeat(64);
  await assert.rejects(checkImportedHyperframesVideo({
    ...checkInput, fetchImpl: async () => new Response(payload),
  }), /VIDEO_INTEGRITY_LINEAGE_MISMATCH/);
  (rows.video_composition_revisions as { manifest: { draft_document_hash: string } }).manifest.draft_document_hash = documentHash;
  (rows.production_jobs as { input_snapshot: { revision_id: string } }).input_snapshot.revision_id = "other-revision";
  await assert.rejects(checkImportedHyperframesVideo({
    ...checkInput, fetchImpl: async () => new Response(payload),
  }), /VIDEO_INTEGRITY_LINEAGE_MISMATCH/);
  (rows.production_jobs as { input_snapshot: { revision_id: string } }).input_snapshot.revision_id = revisionId;
  await assert.rejects(verifyImportedHyperframesVideo({
    ...checkInput, fetchImpl: async () => new Response(overwrittenBytes, { headers: { "Content-Type": "video/mp4" } }),
  }), /VIDEO_INTEGRITY_OVERWRITTEN/);
  assert.equal(recorded, null);
  (rows.production_assets as Record<string, unknown>).storage_path = "production-videos/organizations/other/final.mp4";
  recorded = null;
  await assert.rejects(verifyImportedHyperframesVideo({
    organizationId, requestId, supabase: supabase as never, supabaseUrl: "https://example.supabase.co",
    fetchImpl: async () => new Response(payload),
  }), /VIDEO_INTEGRITY_LINEAGE_MISMATCH/);
  assert.equal(recorded, null);
});
