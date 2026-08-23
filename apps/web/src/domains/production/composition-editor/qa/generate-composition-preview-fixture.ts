import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  collectAnimatedDeckRemoteAssetUrls,
  prepareAnimatedDeckForRemotion,
  rewriteAnimatedDeckRemoteAssetUrls,
} from "../../validation/animated-deck-preprocessor.service";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import type { CompositionEditorPatchOperation } from "../editor-patch.types";
import {
  COMPOSITION_COMPILATION_TARGETS,
  compileCompositionPreview,
  readCompositionAnimationRuntime,
} from "../composition-preview-compiler.service";
import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "../composition-preview-protocol";
import { buildCompositionPreviewVisualPatch, type CompositionPreviewVisualPatch } from "../composition-preview-visual-patch";

const workspaceRoot = process.cwd();
const fixtureSourcePath = resolve(
  workspaceRoot,
  "src/domains/production/slides/templates/soflia-deck/example.html",
);
const outputDirectory = resolve(workspaceRoot, ".tmp/composition-preview-qa");
const interactiveOutputDirectory = resolve(workspaceRoot, ".tmp/composition-preview-qa-interactive");

async function main() {
  const sourceHtml = await readFile(fixtureSourcePath, "utf8");
  const remoteAssetUrls = collectAnimatedDeckRemoteAssetUrls(sourceHtml);
  const localAssetMap = Object.fromEntries(
    remoteAssetUrls.map((url, index) => [url, createPlaceholderDataUrl(index + 1)]),
  );
  const localizedSourceHtml = rewriteAnimatedDeckRemoteAssetUrls(sourceHtml, localAssetMap);
  const prepared = prepareAnimatedDeckForRemotion(localizedSourceHtml);
  const animatedDeck = {
    ...prepared.deck,
    css: prepared.css,
    fonts: prepared.fonts,
  };
  const baseDocument = createInitialCompositionDocument({
    animatedDeck,
    assets: [],
    plan: {
      accentColor: "#23AEA8",
      durationSeconds: prepared.deck.slides.length * 5,
      subtitle: "Fixture visual del preview nativo",
      title: "SofLIA preview QA",
    },
  });
  const firstClip = baseDocument.clips[0]!;
  const document = applyCompositionEditorPatches(baseDocument, [
    { animationId: "motion-qa-fade-in", clipId: firstClip.id, durationSeconds: 0.7, presetId: "FADE_IN", type: "animation.add-preset" },
    { animationId: "motion-qa-fade-out", clipId: firstClip.id, durationSeconds: 0.7, presetId: "FADE_OUT", type: "animation.add-preset" },
  ]);
  const fontDataUrls = new Map(
    prepared.fonts.map((font) => [font.href, "data:text/css;charset=utf-8,"]),
  );
  const renderHtml = await compileCompositionPreview({
    assetUrls: new Map(),
    deckAssetUrls: fontDataUrls,
    document,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });
  const runtimeSmoke = createRuntimeSmokeScenario(animatedDeck);
  const interactivePreviewHtml = await compileCompositionPreview({
    assetUrls: new Map([[runtimeSmokeAssetId, createPlaceholderDataUrl(4)]]),
    deckAssetUrls: fontDataUrls,
    document: runtimeSmoke.document,
    documentHash: runtimeSmoke.documentHash,
    target: COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW,
  });
  const interactiveRuntimeSmokeHtml = interactivePreviewHtml.replace(
    "</body>",
    `${renderRuntimeSmokeHarness(runtimeSmoke)}</body>`,
  );
  const animationRuntime = await readCompositionAnimationRuntime();
  const report = {
    canvas: document.canvas,
    clips: document.clips.map((clip) => ({
      durationSeconds: clip.durationSeconds,
      id: clip.id,
      label: clip.label,
      startSeconds: clip.startSeconds,
    })),
    fixtureSourcePath,
    generatedAt: new Date().toISOString(),
    motion: document.motion,
    preprocessing: {
      animatedSlideCount: prepared.animatedSlideCount,
      cleanup: prepared.cleanup,
      localizedRemoteAssetCount: remoteAssetUrls.length,
      staticSlideCount: prepared.staticSlideCount,
      validation: prepared.validation,
    },
    visualCheckpointsSeconds: document.clips.map((clip) => (
      Math.round((clip.startSeconds + clip.durationSeconds / 2) * 1000) / 1000
    )),
    runtimeSmoke: {
      documentHash: runtimeSmoke.documentHash,
      hfId: runtimeSmoke.hfId,
      operations: runtimeSmoke.operationTypes,
    },
  };

  await Promise.all([
    mkdir(resolve(outputDirectory, "assets"), { recursive: true }),
    mkdir(interactiveOutputDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(outputDirectory, "index.html"), renderHtml, "utf8"),
    writeFile(resolve(outputDirectory, "assets/gsap.min.js"), animationRuntime, "utf8"),
    writeFile(resolve(interactiveOutputDirectory, "index.html"), interactiveRuntimeSmokeHtml, "utf8"),
    writeFile(resolve(outputDirectory, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  ]);
  process.stdout.write(`${JSON.stringify({ interactiveOutputDirectory, outputDirectory, ...report }, null, 2)}\n`);
}

const runtimeSmokeAssetId = "00000000-0000-4000-8000-000000000042";

function createRuntimeSmokeScenario(animatedDeck: Parameters<typeof createInitialCompositionDocument>[0]["animatedDeck"]) {
  const document = createInitialCompositionDocument({
    animatedDeck,
    assets: [{
      checksum: "4".repeat(64),
      durationSeconds: 25,
      fileSizeBytes: 512,
      mimeType: "image/svg+xml",
      productionAssetId: runtimeSmokeAssetId,
      publicUrl: null,
      sourceHeight: 1080,
      sourceWidth: 1920,
      storageBucket: "production-assets",
      storagePath: "production-assets/runtime-smoke.svg",
      timelineRole: "BROLL",
    }],
    plan: {
      accentColor: "#23AEA8",
      durationSeconds: 25,
      subtitle: "Runtime patch smoke test",
      title: "SofLIA preview QA",
    },
  });
  const clip = document.clips.find((candidate) => candidate.source.type === "PRODUCTION_ASSET")!;
  const geometryOperations: CompositionEditorPatchOperation[] = [
    { clipId: clip.id, layout: { height: 360, rotation: 0, width: 640, x: 100, y: 100 }, type: "clip.layout" },
    { clipId: clip.id, crop: { bottom: 30, left: 40, right: 20, top: 10 }, type: "clip.crop" },
    { clipId: clip.id, mediaFit: "CONTAIN", type: "clip.media-fit" },
  ];
  const geometryDocument = applyCompositionEditorPatches(document, geometryOperations, "USER");
  const hideOperations: CompositionEditorPatchOperation[] = [{ clipId: clip.id, hidden: true, type: "clip.visibility" }];
  const hiddenDocument = applyCompositionEditorPatches(geometryDocument, hideOperations, "USER");
  const showOperations: CompositionEditorPatchOperation[] = [{ clipId: clip.id, hidden: false, type: "clip.visibility" }];
  const shownDocument = applyCompositionEditorPatches(hiddenDocument, showOperations, "USER");
  return {
    document,
    documentHash: hashCompositionDocument(document),
    geometryPatch: requireVisualPatch(geometryDocument, geometryOperations),
    hfId: clip.hfId,
    hidePatch: requireVisualPatch(hiddenDocument, hideOperations),
    operationTypes: [...geometryOperations, ...hideOperations, ...showOperations].map((operation) => operation.type),
    showPatch: requireVisualPatch(shownDocument, showOperations),
  };
}

function requireVisualPatch(
  document: Parameters<typeof buildCompositionPreviewVisualPatch>[0]["document"],
  operations: CompositionEditorPatchOperation[],
) {
  const patch = buildCompositionPreviewVisualPatch({ document, operations });
  if (!patch) throw new Error(`El fixture QA no pudo construir el patch visual: ${operations.map((operation) => operation.type).join(", ")}`);
  return patch;
}

function renderRuntimeSmokeHarness(params: {
  documentHash: string;
  geometryPatch: CompositionPreviewVisualPatch;
  hfId: string;
  hidePatch: CompositionPreviewVisualPatch;
  showPatch: CompositionPreviewVisualPatch;
}) {
  return `<script>
    (() => {
      const baseDocumentHash = ${JSON.stringify(params.documentHash)};
      const hfId = ${JSON.stringify(params.hfId)};
      const protocolVersion = ${COMPOSITION_PREVIEW_PROTOCOL_VERSION};
      const pendingPatches = new Map();
      const pendingSeeks = [];
      let lastTime = 0;
      let sequence = 0;
      let started = false;
      const fail = (message) => { throw new Error("RUNTIME_PATCH_SMOKE: " + message); };
      const assert = (condition, message) => { if (!condition) fail(message); };
      const approximately = (actual, expected) => Math.abs(Number(actual) - expected) < 0.01;
      const withTimeout = (executor, label) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("RUNTIME_PATCH_SMOKE_TIMEOUT: " + label)), 1500);
        executor(
          (value) => { clearTimeout(timeout); resolve(value); },
          (error) => { clearTimeout(timeout); reject(error); },
        );
      });
      const dispatchPatch = (patch, documentHash = baseDocumentHash) => withTimeout((resolve) => {
        sequence += 1;
        pendingPatches.set(sequence, resolve);
        window.postMessage({
          baseDocumentHash: documentHash,
          patch,
          protocolVersion,
          sequence,
          type: "courseforge-composition-visual-patch",
        }, "*");
      }, "patch acknowledgement");
      const seekTo = (seconds) => withTimeout((resolve) => {
        pendingSeeks.push({ resolve, seconds });
        window.postMessage({ protocolVersion, seconds, type: "courseforge-composition-seek" }, "*");
      }, "seek acknowledgement");
      window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data || typeof event.data.type !== "string") return;
        const message = event.data;
        if (message.type === "courseforge-composition-time") {
          lastTime = message.seconds;
          for (let index = pendingSeeks.length - 1; index >= 0; index -= 1) {
            if (!approximately(lastTime, pendingSeeks[index].seconds)) continue;
            pendingSeeks.splice(index, 1)[0].resolve(message);
          }
        }
        if (message.type === "courseforge-composition-visual-patch-result") {
          const resolve = pendingPatches.get(message.sequence);
          if (resolve) {
            pendingPatches.delete(message.sequence);
            resolve(message);
          }
        }
        if (message.type === "courseforge-composition-ready") start();
      });
      const start = () => {
        if (started) return;
        started = true;
        void run().catch((error) => setTimeout(() => { throw error; }));
      };
      const run = async () => {
        await seekTo(2.5);
        const geometryResult = await dispatchPatch(${JSON.stringify(params.geometryPatch)});
        assert(geometryResult.applied === true && geometryResult.code === "APPLIED", "geometry patch was not applied");
        const target = document.querySelector('[data-hf-id="' + CSS.escape(hfId) + '"]');
        assert(target instanceof HTMLElement, "target was not found after acknowledgement");
        assert(approximately(parseFloat(target.style.left), 100), "x geometry diverged");
        assert(approximately(parseFloat(target.style.top), 100), "y geometry diverged");
        assert(approximately(parseFloat(target.style.width), 640), "width geometry diverged");
        assert(approximately(parseFloat(target.style.height), 360), "height geometry diverged");
        assert(target.dataset.cropTop === "10" && target.dataset.cropRight === "20", "crop data diverged");
        assert(target.dataset.cropBottom === "30" && target.dataset.cropLeft === "40", "crop data diverged");
        assert(target.dataset.mediaFit === "CONTAIN" && target.dataset.preserveAspect === "CENTER", "media fit diverged");
        assert(approximately(lastTime, 2.5), "geometry patch changed the playhead");

        const versionResult = await dispatchPatch(${JSON.stringify(params.geometryPatch)}, "f".repeat(64));
        assert(versionResult.applied === false && versionResult.code === "VERSION_MISMATCH", "stale version did not fail closed");
        const missingTargetResult = await dispatchPatch({ changes: [{ hfId: "qa-missing-target", hidden: true }] });
        assert(missingTargetResult.applied === false && missingTargetResult.code === "TARGET_NOT_FOUND", "missing target did not fail closed");

        const hideResult = await dispatchPatch(${JSON.stringify(params.hidePatch)});
        assert(hideResult.applied === true && target.dataset.runtimeVisibility === "hidden", "visibility hide diverged");
        const showResult = await dispatchPatch(${JSON.stringify(params.showPatch)});
        assert(showResult.applied === true && target.dataset.runtimeVisibility === "shown", "visibility show diverged");
        assert(target.style.visibility === "visible" && approximately(lastTime, 2.5), "show patch lost frame state");
        const finalHideResult = await dispatchPatch(${JSON.stringify(params.hidePatch)});
        assert(finalHideResult.applied === true && target.dataset.runtimeVisibility === "hidden", "final visibility state diverged");
        document.documentElement.dataset.runtimePatchSmoke = "passed";
      };
      if (document.getElementById("composition-root")?.dataset.previewReady === "true") queueMicrotask(start);
    })();
  </script>`;
}

function createPlaceholderDataUrl(index: number) {
  const hue = (index * 67) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080"><rect width="1920" height="1080" fill="hsl(${hue} 38% 22%)"/><circle cx="1540" cy="280" r="360" fill="hsl(${hue} 64% 42%)" fill-opacity=".52"/><path d="M0 840 L760 250 L1280 770 L1920 180 V1080 H0Z" fill="hsl(${(hue + 45) % 360} 52% 30%)" fill-opacity=".72"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
