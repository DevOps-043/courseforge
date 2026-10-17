import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { buildHtmlReconstructionEditorPath } from "../composition-html-editing-reconstruction-opening.contract";

const compositionId = "11111111-1111-4111-8111-111111111111", draftId = "22222222-2222-4222-8222-222222222222";
test("editor hint identifies only the new draft/composition, never actor/tenant/receipt authority", () => {
  assert.equal(buildHtmlReconstructionEditorPath({compositionId, draftId}), `/admin/assembly/reconstruction/${draftId}?compositionId=${compositionId}`);
  assert.throws(() => buildHtmlReconstructionEditorPath({compositionId: "../original", draftId}));
  assert.throws(() => buildHtmlReconstructionEditorPath({compositionId, draftId, actorId: compositionId} as {compositionId: string; draftId: string}));
});
test("independent page authenticates/reviews current identity and never initializes the original", async () => {
  const source = await readFile("src/app/admin/assembly/reconstruction/[draftId]/page.tsx", "utf8");
  assert.match(source, /htmlReconstructionOpeningEnabled\(process\.env\)/);
  assert.match(source, /getAuthenticatedUser/); assert.match(source, /canReviewContent\(user\.userId, tenant\)/);
  assert.match(source, /readAuthorizedHtmlReconstructionOpening/);
  assert.match(source, /organizationId: tenant\.organizationId/);
  assert.match(source, /safeParse\(await params\)/); assert.match(source, /safeParse\(await searchParams\)/);
  assert.doesNotMatch(source, /initializeHyperframesDraft|getOrCreate|sourceCompositionId|serviceRoleKey/);
});
test("reconstruction mounts the existing studio under explicit null component with no original library", async () => {
  const source = await readFile("src/domains/materials/components/composition-editor/CompositionHtmlReconstructionEditor.tsx", "utf8");
  assert.match(source, /htmlReconstructionOpeningSchema\.parse\(opening\)/);
  assert.match(source, /assets=\{assets\} componentId=\{null\}/);
  assert.match(source, /consultHtmlReconstructionLibrary/);
  assert.match(source, /page\.organizationId !== authorized\.organizationId/);
  assert.match(source, /compositionId=\{authorized\.compositionId\} draftId=\{authorized\.draftId\} lessons=\{\[\]\}/);
  assert.doesNotMatch(source, /initializeHyperframesDraft|getOrCreate|onContinueToPublication|sourceCompositionId/);
});
test("component-dependent actions have null guards without disabling native/HTML editing", async () => {
  const native = await readFile("src/domains/materials/components/composition-editor/NativeCompositionPreview.tsx", "utf8");
  for (const name of ["applyNarrativePreassembly", "openSceneBuilder", "detachAndInsertVideoAudio"])
    assert.match(native, new RegExp(`(?:async )?function ${name}\\([^)]*\\) \\{\\s*if \\(componentId === null\\)`));
  const timeline = await readFile("src/domains/materials/components/composition-editor/CompositionTimelineWorkspace.tsx", "utf8");
  assert.match(timeline, /componentId !== null && <button[^\n]*onClick=\{onRecoverHistoricalAssets\}/);
  const waveform = await readFile("src/domains/materials/components/composition-editor/useCompositionWaveforms.ts", "utf8");
  assert.match(waveform, /if \(componentId === null\) return \(\) => controller\.abort\(\)/);
  const inspector = await readFile("src/domains/materials/components/composition-editor/CompositionInspector.tsx", "utf8");
  assert.match(inspector, /const canDetachAudio = componentId !== null/);
  assert.match(inspector, /componentId !== null && voiceSourceAssetId !== null && <AudioProcessingControls/);
});
