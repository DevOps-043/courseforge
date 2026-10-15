import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createHtmlEditingReferenceFixture } from "./composition-html-editing-reference-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { controlledRenderExecutionContractSchema } from "../composition-render-execution-contract";
import { readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { prepareCompositionHtmlEditingSnapshotArchive } from "../composition-html-editing-snapshot-archive.server";

const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
export async function createPreparedHtmlArchiveFixture() {
  const reference = createHtmlEditingReferenceFixture();
  const media = Buffer.from("image and video bytes for contract tests; not decodable media");
  const compilation = {document: reference.native.document, documentHash: reference.native.documentHash,
    revisions: [{revision: reference.input.next.revision, authoritativeBinding: reference.input.authority.authoritativeBinding,
      grantedAssetIds: [uuid, other]}]};
  const image = {id: uuid, organization_id: uuid, checksum: digest(media), file_size_bytes: media.length,
    mime_type: "image/png", storage_bucket: "production-assets", storage_path: "html/image.png", qa_status: "APPROVED"};
  const state = {rpcReads: 0, assetReads: 0, revokeOnRefresh: false, replaceOnRefresh: false,
    onRead: undefined as ((count: number) => void) | undefined,
    onRefresh: undefined as (() => void) | undefined};
  const supabase = {rpc: () => ({abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); state.rpcReads++;
    state.onRead?.(state.rpcReads);
    if (state.rpcReads > 1) state.onRefresh?.();
    const response = structuredClone(compilation);
    if (state.revokeOnRefresh && state.rpcReads > 1) response.revisions[0]!.grantedAssetIds = [];
    return {data: response, error: null};
  }}), from: (table: string) => {
    const query = {select: () => query, eq: () => query, in: () => query, limit: () => query,
      abortSignal: async (signal: AbortSignal) => {
        signal.throwIfAborted();
        if (table === "video_composition_draft_assets") return {data: [{organization_id: uuid, draft_id: uuid, production_asset_id: uuid}], error: null};
        assert.equal(table, "production_assets"); state.assetReads++;
        return {data: [{...image, checksum: state.replaceOnRefresh && state.assetReads > 1 ? "f".repeat(64) : image.checksum}], error: null};
      }}; return query;
  }};
  const execution = controlledRenderExecutionContractSchema.parse({policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1",
    backend: "CONTROLLED", sdkVersion: "0.7.106",
    expectedBrowser: {protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test"},
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, {sha256: "a".repeat(64), sizeBytes: 10}]))});
  const input = {actorId: uuid, organizationId: uuid, documentId: uuid, documentHash: reference.native.documentHash,
    supabase: supabase as never, otherAssets: reference.params.assets.filter(asset => asset.mimeType === "video/mp4")
      .map(asset => ({...asset, checksum: digest(media), fileSizeBytes: media.length})),
    renderProfile: {format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const},
    renderExecution: execution, animationRuntimeSha256: digest(await readCompositionAnimationRuntime()), packagedFonts: [] as
      Parameters<typeof prepareCompositionHtmlEditingSnapshotArchive>[0]["packagedFonts"]};
  return {input, media, compilation, state, image};
}

