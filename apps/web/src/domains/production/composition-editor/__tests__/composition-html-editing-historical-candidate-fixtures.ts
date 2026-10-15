import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";
import { prepareCompositionHtmlEditingSnapshotArchive } from "../composition-html-editing-snapshot-archive.server";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { hashCompositionDocument } from "../composition-document.service";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
export async function createHistoricalCandidatePreparationFixture(kind: "v1" | "old" | "current" = "v1", withFont = false) {
  const original = await createPreparedHtmlArchiveFixture();
  const fontBytes = Buffer.from("synthetic font fixture, not decoded or rendered"), font = {id: other, organization_id: uuid,
    family: "Historical Font", source: "uploaded", status: "READY", checksum_sha256: digest(fontBytes), file_size_bytes: fontBytes.length,
    mime_type: "font/woff2", storage_bucket: "organization-fonts", storage_path: "historical/font.woff2"};
  if (withFont) {
    const document = original.compilation.document, {clip, track} = createCompositionNativeOverlay({document, id: "historical-font", kind: "TEXT", playheadSeconds: 0});
    if (clip.source.type !== "NATIVE_TEXT") throw new Error();
    clip.source.style.fontAssetId = other; clip.source.style.fontFamily = font.family;
    if (track) document.tracks.push(track); document.clips.push(clip);
    original.compilation.documentHash = hashCompositionDocument(document); original.input.documentHash = original.compilation.documentHash;
    original.input.packagedFonts = [{binding: {fontAssetId: other, family: font.family, checksumSha256: font.checksum_sha256,
      fileSizeBytes: font.file_size_bytes, mimeType: "font/woff2"}, bytes: fontBytes}];
  }
  const prepared = await prepareCompositionHtmlEditingSnapshotArchive(original.input);
  const bundle = JSON.parse(prepared.bundle.encodedBundle);
  if (kind === "v1") {delete bundle.compilation; bundle.schemaVersion = 1; bundle.format = "courseforge-html-editable-snapshot-bundle-v1";}
  if (kind === "old") bundle.compilation.profile.geometryVersion = "historical-profile";
  const encodedBundle = JSON.stringify(bundle), zip = new JSZip(); zip.file(prepared.bundle.archivePath, encodedBundle);
  const archiveBytes = await zip.generateAsync({type: "nodebuffer", compression: "DEFLATE"});
  const request = {actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid, revisionId: uuid};
  const identity = {...request, scope: "AUTHORIZED_HISTORICAL_HTML_ARCHIVE_READ_ONLY", documentId: uuid,
    documentHash: prepared.documentHash, projectHash: digest(archiveBytes), archiveBytes: archiveBytes.length,
    storageBucket: "production-assets", storagePath: `composition-snapshots/${uuid}/${uuid}/${digest(archiveBytes)}.zip`,
    bundlePin: {schemaVersion: 1, path: prepared.bundle.archivePath, sha256: digest(encodedBundle)}};
  const origin = "https://storage.example.test";
  const state = {archiveReads: 0, exactReads: 0, fetches: 0, signs: 0, queries: [] as string[],
    beforeArchiveRead: undefined as ((count: number, signal: AbortSignal) => Promise<void> | void) | undefined,
    beforeExactRead: undefined as ((count: number, signal: AbortSignal) => Promise<void> | void) | undefined,
    revokeImages: false, revokeMedia: false, unlinkedProductionIds: new Set<string>(), corruptZip: false, redirectSign: false,
    fontReads: 0, fontFetches: 0, revokeFont: false, corruptFont: false, wrongFontMime: false};
  const assets = [original.image, ...original.input.otherAssets.map(asset => ({id: asset.productionAssetId,
    organization_id: uuid, checksum: asset.checksum, file_size_bytes: asset.fileSizeBytes, mime_type: asset.mimeType,
    storage_bucket: asset.storageBucket, storage_path: asset.storagePath, qa_status: "APPROVED"}))];
  const supabase = {
    rpc: (name: string, parameters: Record<string,unknown>) => ({abortSignal: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (name === "read_html_editing_snapshot_archive") {
        assert.equal(parameters.p_revision, uuid); state.archiveReads++; await state.beforeArchiveRead?.(state.archiveReads, signal);
        signal.throwIfAborted(); return {data: structuredClone(identity), error: null};
      }
      assert.equal(name, "read_html_editing_compilation"); assert.equal(parameters.p_document_hash, prepared.documentHash);
      state.exactReads++; await state.beforeExactRead?.(state.exactReads, signal); signal.throwIfAborted();
      const saved = structuredClone(original.compilation);
      if (state.revokeImages) saved.revisions[0]!.grantedAssetIds = [];
      return {data: saved, error: null};
    }}),
    storage: {from: () => ({createSignedUrl: async () => {
      state.signs++; return {data: {signedUrl: `${state.redirectSign ? "https://attacker.example" : origin}/storage/v1/object/sign/production-assets/${identity.storagePath}?token=private`}, error: null};
    }})},
    from: (table: string) => {
      let columns = "", ids: string[] = [], dependency = false;
      const query = {select: (selection: string) => {columns = selection; return query;},
        eq: (column: string, value: string) => {if (column === "source_reference") dependency = value === "DECK_DEPENDENCY"; return query;},
        in: (_column: string, values: string[]) => {ids = values; return query;}, limit: () => query,
        abortSignal: async (signal: AbortSignal) => {
          signal.throwIfAborted(); state.queries.push(table);
          if (table === "organization_slide_fonts") {state.fontReads++; return {data: [{...font, status: state.revokeFont ? "REVOKED" : "READY"}], error: null};}
          if (table === "video_composition_draft_assets") return {data: dependency || state.revokeMedia ? []
            : ids.filter(id => !state.unlinkedProductionIds.has(id)).map(id => ({organization_id: uuid, draft_id: uuid, production_asset_id: id})), error: null};
          assert.equal(table, "production_assets");
          return {data: assets.filter(asset => ids.includes(asset.id)).map(asset => Object.fromEntries(columns.split(",")
            .map(column => [column, column === "public_url" ? null : asset[column as keyof typeof asset]]))), error: null};
        }};
      return query;
    },
  } as unknown as SupabaseClient;
  const fetchImpl = (async (url: unknown, options?: RequestInit) => {
    if (String(url).includes("/organization-fonts/")) {
      state.fontFetches++; assert.equal(options?.redirect, "error"); assert.equal(options?.credentials, "omit");
      assert.equal((options?.headers as Record<string,string>).Authorization, "Bearer private-test-key");
      const bytes = new Uint8Array(fontBytes); if (state.corruptFont) bytes[0] = bytes[0]! ^ 1;
      return new Response(bytes, {headers: {"content-type": state.wrongFontMime ? "text/html" : font.mime_type}});
    }
    state.fetches++; const bytes = new Uint8Array(archiveBytes); if (state.corruptZip) bytes[0] = bytes[0]! ^ 1;
    return new Response(bytes, {headers: {"content-type": "application/zip"}});
  }) as typeof fetch;
  const configuration = {supabase, supabaseUrl: origin, serviceRoleKey: "private-test-key", fetchImpl};
  return {original, prepared, archiveBytes, identity, state, configuration, font, fontBytes,
    input: {request, candidateId: other, renderProfile: structuredClone(original.input.renderProfile),
      renderExecution: structuredClone(original.input.renderExecution), animationRuntimeSha256: original.input.animationRuntimeSha256}};
}
