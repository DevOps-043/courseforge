import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import {
  COMPOSITION_COMPILATION_TARGETS,
  compileCompositionPreview,
} from "../composition-preview-compiler.service";
import { assertCompositionSnapshotRenderContract } from "../composition-snapshot.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { buildHyperframesAssetVariableNames } from "../../hyperframes/hyperframes-asset-delivery.service";
import { validateHyperframesPreflight } from "../../hyperframes/hyperframes-preflight.service";
import { getHyperframesRenderProfile, toHyperframesRenderSettings } from "../../hyperframes/hyperframes-render-profiles";
import { resolveHyperframesSnapshotRenderProfile } from "../../hyperframes/hyperframes-request-validation";
import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_COMPOSITION_FORMAT,
  type HyperframesAssetManifestItem,
} from "../../hyperframes/hyperframes.types";
import { createTransition, createTransitionDocument } from "./composition-transition-test-fixtures";

test("el snapshot de una transición conserva documento editable y HTML cloud determinista", async () => {
  const document = createTransitionDocument();
  const transitioned = applyCompositionEditorPatches(document, [{
    transition: createTransition(document),
    type: "transition.add",
  }]);
  const manifest = buildManifest();
  const variableNames = buildHyperframesAssetVariableNames(manifest);

  assert.equal(HYPERFRAMES_COMPOSITION_FORMAT, "hyperframes-html-v1");
  assert.doesNotThrow(() => assertCompositionSnapshotRenderContract(transitioned));
  const html = await compileCompositionPreview({
    assetUrls: new Map(),
    assetVariableNames: variableNames,
    document: transitioned,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });

  assert.match(html, /"id":"transition-persisted"/);
  assert.match(html, /"audioMode":"CROSSFADE"/);
  assert.match(html, /data-volume-automated="true"/);
  for (const variableName of variableNames.values()) {
    assert.equal((html.match(new RegExp(`data-var-src="${variableName}"`, "g")) || []).length, 2);
  }
  assert.doesNotMatch(html, /broll\/transition-|token=|storage\/v1\/object/);

  const zip = new JSZip();
  zip.file("index.html", html);
  zip.file("assets/gsap.min.js", "/* frozen runtime fixture */");
  zip.file("composition-document.json", JSON.stringify(transitioned, null, 2));
  zip.file("asset-manifest.json", JSON.stringify(manifest, null, 2));
  const archive = await zip.generateAsync({ compression: "DEFLATE", type: "uint8array" });
  const archived = await JSZip.loadAsync(archive);
  const restoredDocument = compositionEditorDocumentSchema.parse(JSON.parse(
    await archived.file("composition-document.json")!.async("string"),
  ));

  assert.deepEqual(restoredDocument.transitions, transitioned.transitions);
  assert.ok(archived.file("index.html"));
  assert.ok(archived.file("asset-manifest.json"));

  const renderProfile = toHyperframesRenderSettings(getHyperframesRenderProfile("balanced"));
  const preflight = validateHyperframesPreflight({
    archiveSizeBytes: archive.byteLength,
    assets: manifest,
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    durationSeconds: transitioned.canvas.durationSeconds,
    renderProfile,
  });
  assert.equal(preflight.valid, true);
  assert.equal(preflight.deliveryMode, HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES);
  assert.deepEqual(resolveHyperframesSnapshotRenderProfile({ fps: 25 }, renderProfile), {
    data: renderProfile,
    success: true,
  });
  assert.equal(resolveHyperframesSnapshotRenderProfile({ fps: 30 }, renderProfile).success, false);
});

function buildManifest(): HyperframesAssetManifestItem[] {
  return [0, 1].map((index) => ({
    checksum: String(index + 1).repeat(64),
    fileSizeBytes: 1024,
    mimeType: "video/mp4",
    productionAssetId: `40000000-0000-4000-8000-00000000000${index + 1}`,
    storageBucket: "production-assets",
    storagePath: `broll/transition-${index + 1}.mp4`,
  }));
}
