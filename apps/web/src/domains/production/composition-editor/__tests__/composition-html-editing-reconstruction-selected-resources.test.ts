import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createSelectedReconstructionResourceFixture } from "./composition-html-editing-reconstruction-selected-resource-fixtures";
import { htmlEditingFixtureId as actor, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { htmlReconstructionResourceSelectionSchema } from "../composition-html-editing-reconstruction-resource-selection.contract";
import { readHtmlReconstructionSelectedResources } from "../composition-html-editing-reconstruction-selected-resources.server";
import { createHtmlHistoricalReconstructionArchivePreparer } from "../composition-html-editing-reconstruction-archive.server";
import { createHtmlReconstructionCompositionResourceAcquirer } from "../composition-html-editing-reconstruction-resources.server";
import { createHtmlReconstructionAuthorityVerifier } from "../composition-html-editing-reconstruction-authority.server";
import { describeHtmlReconstructionCandidate } from "../composition-html-editing-reconstruction-candidate.server";
import { htmlReconstructionReviewRecordSchema, HTML_RECONSTRUCTION_REQUIRED_REVIEWS } from "../composition-html-editing-reconstruction.contract";
import { hashCompositionDocument } from "../composition-document.service";

const signal = () => AbortSignal.timeout(60_000);
async function fixtureAndRead() {
  const f = await createSelectedReconstructionResourceFixture();
  const input = {supabase: f.configuration.supabase, origin: f.reconstruction.origin, actorId: actor,
    document: f.reconstruction.document, selection: f.selection, signal: signal()};
  return {...f, read: (overrides: Partial<typeof input> = {}) => readHtmlReconstructionSelectedResources({...input, ...overrides})};
}

test("selection is bounded, closed and unambiguous, never paths, credentials or grants", () => {
  const empty = {scope: "CURRENT_TENANT_RESOURCE_SELECTION_NOT_GRANTS", productionAssetIds: [], soundEffectAssetIds: [],
    branding: {introAssetId: null, outroAssetId: null}};
  assert.ok(htmlReconstructionResourceSelectionSchema.safeParse(empty).success);
  for (const input of [{...empty, grantedAssetIds: [actor]}, {...empty, storagePath: "private"}, {...empty, actorId: actor},
    {...empty, productionAssetIds: [actor, actor]}, {...empty, productionAssetIds: [actor], soundEffectAssetIds: [actor]},
    {...empty, productionAssetIds: Array.from({length: 251}, () => actor)}]) assert.equal(htmlReconstructionResourceSelectionSchema.safeParse(input).success, false);
});

test("exact explicit selection acquires independent image/video/audio/branding/SFX with one scoped RPC and no source link queries", async () => {
  const f = await fixtureAndRead(), original = structuredClone(f.reconstruction.document);
  const acquired = await f.read(); assert.equal(f.calls.length, 1);
  assert.equal(acquired.imageAssets.length, 1); assert.equal(acquired.nativeAssets.length, 5);
  assert.deepEqual(acquired.grantedAssetIds, [f.bindings[0].productionAssetId]);
  assert.equal(f.source.state.queries.length, 0); assert.deepEqual(f.reconstruction.document, original);
  assert.equal(f.calls[0].p_org, actor); assert.equal(f.calls[0].p_actor, actor);
  assert.deepEqual(f.calls[0].p_selection, f.selection);
});

test("missing/extra/foreign-kind selection, conflicting placement and text-only alias fail before any resource RPC", async () => {
  const f = await fixtureAndRead();
  for (const selection of [{...f.selection, productionAssetIds: []}, {...f.selection, productionAssetIds: [...f.selection.productionAssetIds, actor]},
    {...f.selection, soundEffectAssetIds: [actor]}, {...f.selection, branding: {...f.selection.branding, introAssetId: actor}}]) await assert.rejects(f.read({selection}));
  const document = structuredClone(f.reconstruction.document), slide = document.clips[0];
  if (slide.source.type !== "DECK_SLIDE") throw new Error();
  slide.source.html += `<p>Text is not a resource: conformance-media/${actor}</p>`;
  await assert.rejects(f.read({document, selection: {...f.selection, productionAssetIds: [...f.selection.productionAssetIds, actor]}}));
  const intro = document.clips.find(clip => clip.source.type === "ASSEMBLY_BRAND_ASSET")!;
  document.clips.push({...intro, id: "conflicting-intro", hfId: "conflicting-intro", source: {type: "ASSEMBLY_BRAND_ASSET", assemblyBrandAssetId: actor, placement: "INTRO"}});
  await assert.rejects(f.read({document})); assert.equal(f.calls.length, 0);
});

test("response ownership, complete identity set, origins and placement substitutions fail closed without provider details", async () => {
  const f = await fixtureAndRead();
  for (const failure of ["tenant", "selection", "missing", "duplicate", "origin", "placement", "mime", "native-mime", "path", "denied"] as const) {
    const response = {origin: structuredClone(f.reconstruction.origin), selection: structuredClone(f.selection), bindings: structuredClone(f.bindings)};
    if (failure === "tenant") response.origin.organizationId = other;
    if (failure === "selection") response.selection.productionAssetIds = [];
    if (failure === "missing") response.bindings.pop();
    if (failure === "duplicate") response.bindings.push(response.bindings[0]);
    if (failure === "origin") response.bindings[0].origin = "SOUND_EFFECT";
    if (failure === "placement") response.bindings[3].placements = ["OUTRO"];
    if (failure === "mime") response.bindings[0].mimeType = "video/mp4";
    if (failure === "native-mime") response.bindings[1].mimeType = "image/png";
    if (failure === "path") response.bindings[0].storagePath = "../private";
    f.state.response = response; f.state.deny = failure === "denied";
    await assert.rejects(f.read(), error => error instanceof Error && error.message === "HTML_RECONSTRUCTION_SELECTED_RESOURCES_UNAVAILABLE");
  }
});

test("archive and current authority accept new resources outside the origin draft, including fonts, without changing the original", async () => {
  const f = await createSelectedReconstructionResourceFixture(), original = structuredClone(f.source.original.compilation.document);
  const prepare = createHtmlHistoricalReconstructionArchivePreparer({supabase: f.configuration.supabase,
    storageOrigin: f.configuration.supabaseUrl, fetchResource: f.configuration.fetchImpl, readCatalog: () => f.reconstruction.catalog,
    acquireResources: createHtmlReconstructionCompositionResourceAcquirer(f.configuration)});
  const artifact = await prepare(f.input);
  assert.equal(artifact.prepared.assets.length, 6); assert.equal(artifact.prepared.fontManifest.length, 1);
  assert.equal(f.calls.length, 2); assert.equal(f.source.state.fontFetches, 1);
  assert.deepEqual(artifact.candidate.target.resourceSelection, f.selection);
  assert.equal(f.source.state.queries.includes("video_composition_draft_assets"), false);
  const locator = {scope: "RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION" as const, candidateId: other,
    organizationId: actor, sourceCompositionId: actor, sourceDraftId: actor, targetCompositionId: other, targetDocumentId: other, targetRevisionId: other,
    projectHash: artifact.prepared.projectHash, metadataSha256: "a".repeat(64)};
  const review = htmlReconstructionReviewRecordSchema.parse({scope: "RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY", locator, origin: artifact.candidate.origin,
    approval: {candidateId: other, reviewerId: actor, evidenceSha256: "b".repeat(64), reviewedProjectHash: locator.projectHash,
      reviewedMetadataSha256: locator.metadataSha256, completedReviews: [...HTML_RECONSTRUCTION_REQUIRED_REVIEWS]}});
  const {archiveBytes, ...prepared} = artifact.prepared;
  const candidate = describeHtmlReconstructionCandidate({review, archiveSizeBytes: archiveBytes.length,
    content: {scope: artifact.scope, candidate: artifact.candidate, prepared}});
  await createHtmlReconstructionAuthorityVerifier({supabase: f.configuration.supabase, readCatalog: () => f.reconstruction.catalog})(candidate, signal());
  assert.equal(f.calls.length, 3); assert.equal(f.source.state.fontFetches, 1); assert.deepEqual(f.source.original.compilation.document, original);
  f.state.deny = true;
  await assert.rejects(createHtmlReconstructionAuthorityVerifier({supabase: f.configuration.supabase, readCatalog: () => f.reconstruction.catalog})(candidate, signal()));
});

test("resource identity drift or revocation during preparation rejects the archive instead of approving refreshed bytes", async () => {
  for (const change of ["identity", "revocation"] as const) {
    const f = await createSelectedReconstructionResourceFixture();
    f.state.beforeRead = count => {if (count === 2) {if (change === "identity") f.bindings[0].checksum = "f".repeat(64); else f.state.deny = true;}};
    await assert.rejects(createHtmlHistoricalReconstructionArchivePreparer({supabase: f.configuration.supabase, storageOrigin: f.configuration.supabaseUrl,
      fetchResource: f.configuration.fetchImpl, readCatalog: () => f.reconstruction.catalog,
      acquireResources: createHtmlReconstructionCompositionResourceAcquirer(f.configuration)})(f.input), /ARCHIVE_UNAVAILABLE/);
  }
});

test("absent selection retains source-draft linkage and cannot silently select unrelated tenant resources", async () => {
  const f = await createSelectedReconstructionResourceFixture(), target = {...f.reconstruction.target};
  assert.equal("resourceSelection" in target, false);
  await assert.rejects(createHtmlHistoricalReconstructionArchivePreparer({supabase: f.configuration.supabase, storageOrigin: f.configuration.supabaseUrl,
    fetchResource: f.configuration.fetchImpl, readCatalog: () => f.reconstruction.catalog,
    acquireResources: createHtmlReconstructionCompositionResourceAcquirer(f.configuration)})({...f.input,
      reconstruction: {...f.input.reconstruction, target, expectedDocumentHash: hashCompositionDocument(f.reconstruction.document)}}), /ARCHIVE_UNAVAILABLE/);
  assert.equal(f.calls.length, 0);
});

test("pre-abort prevents selected-resource dispatch and mutable request references are captured before awaits", async () => {
  const f = await fixtureAndRead(); await assert.rejects(f.read({signal: AbortSignal.abort()})); assert.equal(f.calls.length, 0);
  f.state.beforeRead = () => {f.selection.productionAssetIds = []; f.reconstruction.document.clips[0].label = "Changed externally";};
  const result = await f.read(); assert.equal(result.imageAssets.length, 1); assert.equal(f.calls.length, 1);
});

test("incremental SQL keeps old scope/review/identity/font checks, service-only reader and create-only links without touching original", async () => {
  const sql = await readFile("../../supabase/migrations/20261010190000_html_reconstruction_selected_resources.sql", "utf8");
  assert.match(sql, /public\.read_html_editing_snapshot_archive\(p_org,p_actor/);
  assert.match(sql, /private\.assert_html_reconstruction_staging\(p_org,p_actor,p_staging,true\)/);
  assert.match(sql, /selection IS NULL THEN[\s\S]*private\.html_snapshot_resource_bindings/);
  assert.match(sql, /private\.html_editing_grants\(p_org,\(locator->>'sourceDraftId'\)::uuid,revision\)/);
  assert.match(sql, /'\[\]'::jsonb,manifest->'font_manifest'/);
  assert.match(sql, /private\.html_reconstruction_resource_eligible\(a\)/);
  assert.match(sql, /asset\.id[\s\S]*FOR SHARE/); assert.match(sql, /SELECTION_SET_MISMATCH/);
  assert.match(sql, /current - 'origin' - 'placements' = supplied/);
  assert.match(sql, /FROM PUBLIC,anon,authenticated;/); assert.match(sql, /TO service_role;/);
  assert.doesNotMatch(sql.replace(/^\s*--.*$/gm, ""), /\b(?:UPDATE|DELETE|UPSERT)\b|CREATE OR REPLACE FUNCTION public\.create_html_reconstruction/);
  assert.match(sql, /WHERE source\.draft_id = p_source_draft/); assert.match(sql, /b->'placements' \? 'INTRO'/);
});
