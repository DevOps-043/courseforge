import assert from "node:assert/strict";
import test from "node:test";
import { assertSnapshotVisibilityReuse, restrictSnapshotVisibilityReuse, restrictSnapshotPaintMaskReuse, snapshotMotionVisibilityEnabled } from "../composition-snapshot-conformance-policy";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT, compositionEditorDocumentSchema } from "../composition-document.types";
import { normalizeCompositionDocumentLayerDepths } from "../composition-layer-depth";
import { normalizeCompositionTrackTopology } from "../composition-track-registry";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { snapshotCompositionDocument } from "../composition-snapshot.service";
import { NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TRANSITION_VISIBILITY_POLICY, NATIVE_MOTION_VISIBILITY_POLICY, NATIVE_TEXT_GEOMETRY_POLICY } from "../composition-text-parity-contract";
import { getHyperframesRenderProfile, toHyperframesRenderSettings } from "../../hyperframes/hyperframes-render-profiles";
import { DECLARED_NATIVE_FONT_USAGE_POLICY } from "../composition-font-usage-contract";
import { buildCompositionEventBatchAuthorization } from "../composition-conformance-event-batch-contract";

function contract(motionVisibility = false, contractVersion: 1 | 2 | 3 | 4 = 4) {
  const document = createTransitionDocument();
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
  if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  return buildSnapshotConformanceContract({document, documentHash: "a".repeat(64), assets: [], contractVersion, motionVisibility,
    renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
}

test("paint-mask revision identity matches policy presence and absence exactly", () => {
  const legacy = contract(); if (legacy.schemaVersion !== 4) throw new Error("Expected v4");
  const required = compositionConformanceContractSchema.parse({...legacy,
    textParity: {...legacy.textParity, paintMaskPolicy: "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1"}});
  const calls: unknown[] = [];
  const query = {eq(column: string, value: string) {calls.push(["eq", column, value]); return this;},
    is(column: string, value: null) {calls.push(["is", column, value]); return this;}};
  restrictSnapshotPaintMaskReuse(query, legacy); restrictSnapshotPaintMaskReuse(query, required);
  assert.deepEqual(calls, [["is", "manifest->conformance_contract->textParity->>paintMaskPolicy", null],
    ["is", "manifest->conformance_contract->textParity->>paintRegionExpansionPolicy", null],
    ["is", "manifest->conformance_contract->textParity->>paintOffcanvasSeedPolicy", null],
    ["eq", "manifest->conformance_contract->textParity->>paintMaskPolicy", "NATIVE_TEXT_PAINT_SUPPRESSION_RESTORED_V1"],
    ["is", "manifest->conformance_contract->textParity->>paintRegionExpansionPolicy", null],
    ["is", "manifest->conformance_contract->textParity->>paintOffcanvasSeedPolicy", null]]);
  assertSnapshotVisibilityReuse({conformance_contract: required}, required);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: required}, legacy), /POLICY_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: legacy}, required), /POLICY_MISMATCH/);
  if (required.schemaVersion !== 4) throw new Error("Expected v4");
  const expanded = compositionConformanceContractSchema.parse({...required, textParity: {...required.textParity,
    paintRegionExpansionPolicy: "JOINT_NATIVE_PAINT_DELTA_NEAREST_ROI_V1"}});
  calls.length = 0; restrictSnapshotPaintMaskReuse(query, expanded);
  assert.deepEqual(calls[1], ["eq", "manifest->conformance_contract->textParity->>paintRegionExpansionPolicy",
    "JOINT_NATIVE_PAINT_DELTA_NEAREST_ROI_V1"]);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: required}, expanded), /POLICY_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: expanded}, required), /POLICY_MISMATCH/);
});

test("motion rollout is exact opt-in and requires the text v4 contract", () => {
  for (const version of [1, 2, 3]) assert.equal(snapshotMotionVisibilityEnabled(version, "true"), false);
  for (const raw of [undefined, "false", "TRUE", "1", " true "]) assert.equal(snapshotMotionVisibilityEnabled(4, raw), false);
  assert.equal(snapshotMotionVisibilityEnabled(4, "true"), true);
});

test("reuse query explicitly distinguishes absent policy from the frozen motion policy", () => {
  const calls: unknown[] = [];
  const query = {eq(column: string, value: string) {calls.push(["eq", column, value]); return this;},
    is(column: string, value: null) {calls.push(["is", column, value]); return this;}};
  for (const version of [1, 2, 3, 4] as const) restrictSnapshotVisibilityReuse(query, contract(false, version));
  restrictSnapshotVisibilityReuse(query, contract(true));
  assert.deepEqual(calls, [
    ...Array.from({length: 4}, () => ["is", "manifest->conformance_contract->textParity->>visibilityPolicy", null]),
    ["eq", "manifest->conformance_contract->textParity->>visibilityPolicy", "NATIVE_MOTION_OPACITY_GSAP_V1"],
  ]);
});

test("stored contract is checked before reuse, including both directions of a policy switch", () => {
  const legacy = contract(), motion = contract(true);
  assert.doesNotThrow(() => assertSnapshotVisibilityReuse({conformance_contract: legacy}, legacy));
  assert.doesNotThrow(() => assertSnapshotVisibilityReuse({conformance_contract: motion}, motion));
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: legacy}, motion), /POLICY_MISMATCH/);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: motion}, legacy), /POLICY_MISMATCH/);
  for (const manifest of [null, {}, {conformance_contract: {...legacy, documentHash: "b".repeat(64)}},
    {conformance_contract: contract(false, 3)}]) {
    assert.throws(() => assertSnapshotVisibilityReuse(manifest, legacy), /POLICY_MISMATCH/);
  }
});

test("same policy with altered frozen text expectations is not reusable", () => {
  const requested = contract(true);
  if (requested.schemaVersion !== 4) throw new Error("Expected v4");
  const stored = structuredClone(requested);
  stored.textParity.checkpoints[0]!.expectedTexts[0]!.textSha256 = "b".repeat(64);
  assert.throws(() => assertSnapshotVisibilityReuse({conformance_contract: stored}, requested), /POLICY_MISMATCH/);
  assert.doesNotThrow(() => assertSnapshotVisibilityReuse({conformance_contract: JSON.parse(JSON.stringify(requested))}, requested));
});

test("snapshot service rejects a conflicting stored policy before activation and hides the private manifest", async () => {
  const originalTextFlag = process.env.COMPOSITION_CONFORMANCE_TEXT_V4;
  const originalMotionFlag = process.env.COMPOSITION_CONFORMANCE_MOTION_VISIBILITY_V1;
  const originalTransitionFlag = process.env.COMPOSITION_CONFORMANCE_TRANSITION_VISIBILITY_V2;
  const originalAppearanceFlag = process.env.COMPOSITION_CONFORMANCE_TEXT_APPEARANCE_V3;
  const originalGeometryFlag = process.env.COMPOSITION_CONFORMANCE_TEXT_GEOMETRY_V4;
  const originalFontFlag = process.env.COMPOSITION_CONFORMANCE_FONT_USAGE_V1;
  const originalColorFlag = process.env.COMPOSITION_CONFORMANCE_COLOR_TAGS_V1;
  const originalEventFlag = process.env.COMPOSITION_CONFORMANCE_EVENT_CHECKPOINTS_V1;
  process.env.COMPOSITION_CONFORMANCE_TEXT_V4 = "true";
  process.env.COMPOSITION_CONFORMANCE_MOTION_VISIBILITY_V1 = "true";
  delete process.env.COMPOSITION_CONFORMANCE_TRANSITION_VISIBILITY_V2;
  delete process.env.COMPOSITION_CONFORMANCE_TEXT_APPEARANCE_V3;
  delete process.env.COMPOSITION_CONFORMANCE_TEXT_GEOMETRY_V4;
  try {
    let document = createInitialCompositionDocument({sourceInsertionMode: "MANUAL", animatedDeck: null, assets: [],
      plan: {title: "Policy", subtitle: "Frozen", accentColor: "#38BDF8", durationSeconds: 5}});
    const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 0});
    if (track) document.tracks.push(track); document.clips.push(clip); document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
    document = compositionEditorDocumentSchema.parse(normalizeCompositionTrackTopology(
      compositionEditorDocumentSchema.parse(normalizeCompositionDocumentLayerDepths(document)), new Map()));
    const documentHash = hashCompositionDocument(document), renderProfile = getHyperframesRenderProfile("balanced");
    const identifier = "00000000-0000-4000-8000-000000000001";
    const policies = [undefined, NATIVE_MOTION_VISIBILITY_POLICY, NATIVE_TRANSITION_VISIBILITY_POLICY,
      NATIVE_TEXT_APPEARANCE_POLICY, NATIVE_TEXT_GEOMETRY_POLICY] as const;
    for (const requestedPolicy of policies) for (const storedPolicy of policies) for (const extraStoredFont of [false, true])
      for (const requestedFonts of [false, true]) for (const storedFonts of [false, true])
      for (const requestedColor of [false, true]) for (const storedColor of [false, true])
      for (const requestedEvents of [false, true]) for (const storedEvents of [false, true]) {
      process.env.COMPOSITION_CONFORMANCE_EVENT_CHECKPOINTS_V1 = String(requestedEvents);
      process.env.COMPOSITION_CONFORMANCE_COLOR_TAGS_V1 = String(requestedColor);
      process.env.COMPOSITION_CONFORMANCE_FONT_USAGE_V1 = String(requestedFonts);
      process.env.COMPOSITION_CONFORMANCE_MOTION_VISIBILITY_V1 = String(requestedPolicy !== undefined);
      process.env.COMPOSITION_CONFORMANCE_TRANSITION_VISIBILITY_V2 = String(requestedPolicy === NATIVE_TRANSITION_VISIBILITY_POLICY
        || requestedPolicy === NATIVE_TEXT_APPEARANCE_POLICY);
      process.env.COMPOSITION_CONFORMANCE_TEXT_APPEARANCE_V3 = String(requestedPolicy === NATIVE_TEXT_APPEARANCE_POLICY);
      process.env.COMPOSITION_CONFORMANCE_TEXT_GEOMETRY_V4 = String(requestedPolicy === NATIVE_TEXT_GEOMETRY_POLICY);
      let activationCount = 0;
      const filters: Array<[string, unknown]> = [];
      const stored = buildSnapshotConformanceContract({document, documentHash, assets: [], contractVersion: 4,
        fontUsage: storedFonts, fontManifest: [], colorTags: storedColor, eventCheckpoints: storedEvents,
        visibilityPolicy: storedPolicy, renderProfile: toHyperframesRenderSettings(renderProfile)});
      const supabase = {from(table: string) {
        const response = () => ({data: table === "video_compositions" ? {id: identifier, status: "READY_FOR_PREVIEW"}
          : table === "video_composition_drafts" ? {id: identifier, composition_id: identifier, state: "ACTIVE"}
          : table === "video_composition_draft_documents" ? {document, document_hash: documentHash, version: 1}
          : table === "video_composition_draft_assets" ? []
          : table === "video_composition_revisions" ? {id: identifier, revision_number: 1, project_hash: "b".repeat(64),
            project_archive_size_bytes: 100, manifest: {conformance_contract: stored, private_path: "must-not-be-returned",
              ...(storedEvents ? {conformance_event_batch_authorization: buildCompositionEventBatchAuthorization({document, parentContract: stored})} : {}),
              ...(extraStoredFont ? {font_manifest: [{fontAssetId: identifier, family: "Foreign Font", checksumSha256: "c".repeat(64),
                fileSizeBytes: 8, mimeType: "font/woff2"}]} : {})}}
          : null, error: null});
        const query = {
          select() {return this;}, order() {return this;}, limit() {return this;}, contains() {return this;},
          eq(column: string, value: unknown) {filters.push([column, value]); return this;},
          is(column: string, value: null) {filters.push([column, value]); return this;},
          update() {activationCount++; return this;}, async maybeSingle() {return response();},
          then(resolve: (value: ReturnType<typeof response>) => unknown) {return resolve(response());},
        };
        return query;
      }};
      const run = () => snapshotCompositionDocument({compositionId: identifier, draftId: identifier, organizationId: identifier,
        userId: identifier, renderProfile, supabase: supabase as never});
      if (storedEvents !== requestedEvents) {
        await assert.rejects(run(), /EVENT_POLICY_MISMATCH/); assert.equal(activationCount, 0);
      } else if (storedPolicy !== requestedPolicy) {
        await assert.rejects(run(), /POLICY_MISMATCH/); assert.equal(activationCount, 0);
      } else if (storedFonts !== requestedFonts) {
        await assert.rejects(run(), /FONT_CONTRACT_MISMATCH/); assert.equal(activationCount, 0);
      } else if (storedColor !== requestedColor) {
        await assert.rejects(run(), /COLOR_POLICY_MISMATCH/); assert.equal(activationCount, 0);
      } else if (extraStoredFont) {
        await assert.rejects(run(), /FONT_BINDING_MISMATCH/); assert.equal(activationCount, 0);
      } else {
        const result = await run(); assert.equal(result.reused, true); assert.equal(activationCount, 1);
        assert.equal("manifest" in result, false);
      }
      assert.ok(filters.some(([column, value]) => column.endsWith("->>visibilityPolicy")
        && value === (requestedPolicy ?? null)));
      assert.ok(filters.some(([column, value]) => column.endsWith("fontUsageContract->>policy")
        && value === (requestedFonts ? DECLARED_NATIVE_FONT_USAGE_POLICY : null)));
      assert.ok(filters.some(([column, value]) => column.endsWith("->>colorTagPolicy")
        && value === (requestedColor ? "sdr-rec709-tags-v1" : null)));
      assert.ok(filters.some(([column, value]) => column.endsWith("->>checkpointPolicy")
        && value === (requestedEvents ? "ALL_NATIVE_EVENT_NEIGHBORS_BATCHED_V1" : null)));
    }
  } finally {
    if (originalEventFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_EVENT_CHECKPOINTS_V1;
    else process.env.COMPOSITION_CONFORMANCE_EVENT_CHECKPOINTS_V1 = originalEventFlag;
    if (originalColorFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_COLOR_TAGS_V1;
    else process.env.COMPOSITION_CONFORMANCE_COLOR_TAGS_V1 = originalColorFlag;
    if (originalFontFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_FONT_USAGE_V1;
    else process.env.COMPOSITION_CONFORMANCE_FONT_USAGE_V1 = originalFontFlag;
    if (originalTextFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_TEXT_V4;
    else process.env.COMPOSITION_CONFORMANCE_TEXT_V4 = originalTextFlag;
    if (originalMotionFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_MOTION_VISIBILITY_V1;
    else process.env.COMPOSITION_CONFORMANCE_MOTION_VISIBILITY_V1 = originalMotionFlag;
    if (originalTransitionFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_TRANSITION_VISIBILITY_V2;
    else process.env.COMPOSITION_CONFORMANCE_TRANSITION_VISIBILITY_V2 = originalTransitionFlag;
    if (originalAppearanceFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_TEXT_APPEARANCE_V3;
    else process.env.COMPOSITION_CONFORMANCE_TEXT_APPEARANCE_V3 = originalAppearanceFlag;
    if (originalGeometryFlag === undefined) delete process.env.COMPOSITION_CONFORMANCE_TEXT_GEOMETRY_V4;
    else process.env.COMPOSITION_CONFORMANCE_TEXT_GEOMETRY_V4 = originalGeometryFlag;
  }
});
