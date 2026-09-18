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
const transitionOutputDirectory = resolve(workspaceRoot, ".tmp/composition-transition-qa-interactive");

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
  const transitionSmoke = createTransitionRuntimeSmokeScenario(animatedDeck);
  const transitionPreviewHtml = await compileCompositionPreview({
    assetUrls: new Map(),
    deckAssetUrls: fontDataUrls,
    document: transitionSmoke.document,
    target: COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW,
  });
  const transitionRuntimeSmokeHtml = transitionPreviewHtml.replace(
    "</body>",
    `${renderTransitionRuntimeSmokeHarness(transitionSmoke)}</body>`,
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
    mkdir(transitionOutputDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(outputDirectory, "index.html"), renderHtml, "utf8"),
    writeFile(resolve(outputDirectory, "assets/gsap.min.js"), animationRuntime, "utf8"),
    writeFile(resolve(interactiveOutputDirectory, "index.html"), interactiveRuntimeSmokeHtml, "utf8"),
    writeFile(resolve(transitionOutputDirectory, "index.html"), transitionRuntimeSmokeHtml, "utf8"),
    writeFile(resolve(outputDirectory, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  ]);
  process.stdout.write(`${JSON.stringify({ interactiveOutputDirectory, outputDirectory, transitionOutputDirectory, ...report }, null, 2)}\n`);
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
  const colorOperations: CompositionEditorPatchOperation[] = [{
    clipId: clip.id,
    colorGrading: { adjust: { contrast: 0.2, exposure: 0.5, saturation: -0.25 } },
    type: "clip.color-grading",
  }];
  const colorDocument = applyCompositionEditorPatches(geometryDocument, colorOperations, "USER");
  const hideOperations: CompositionEditorPatchOperation[] = [{ clipId: clip.id, hidden: true, type: "clip.visibility" }];
  const hiddenDocument = applyCompositionEditorPatches(geometryDocument, hideOperations, "USER");
  const showOperations: CompositionEditorPatchOperation[] = [{ clipId: clip.id, hidden: false, type: "clip.visibility" }];
  const shownDocument = applyCompositionEditorPatches(hiddenDocument, showOperations, "USER");
  const motionOperations: CompositionEditorPatchOperation[] = [{
    animationId: "motion-runtime-smoke",
    clipId: clip.id,
    durationSeconds: 0.8,
    presetId: "FADE_IN",
    type: "animation.add-preset",
  }];
  const motionDocument = applyCompositionEditorPatches(shownDocument, motionOperations, "USER");
  return {
    document,
    documentHash: hashCompositionDocument(document),
    colorPatch: requireVisualPatch(colorDocument, colorOperations),
    geometryPatch: requireVisualPatch(geometryDocument, geometryOperations),
    hfId: clip.hfId,
    hidePatch: requireVisualPatch(hiddenDocument, hideOperations),
    motionPatch: requireVisualPatch(motionDocument, motionOperations),
    operationTypes: [...geometryOperations, ...colorOperations, ...hideOperations, ...showOperations, ...motionOperations].map((operation) => operation.type),
    showPatch: requireVisualPatch(shownDocument, showOperations),
  };
}

function createTransitionRuntimeSmokeScenario(
  animatedDeck: Parameters<typeof createInitialCompositionDocument>[0]["animatedDeck"],
) {
  if (!animatedDeck || animatedDeck.slides.length < 2) {
    throw new Error("El smoke de transiciones requiere al menos dos diapositivas.");
  }
  const document = createInitialCompositionDocument({
    animatedDeck: { ...animatedDeck, slides: animatedDeck.slides.slice(0, 2) },
    assets: [],
    plan: {
      accentColor: "#23AEA8",
      durationSeconds: 10,
      subtitle: "Runtime transition smoke test",
      title: "SofLIA transition QA",
    },
  });
  const [fromClip, toClip] = document.clips;
  if (!fromClip || !toClip) throw new Error("No se pudieron crear los extremos de la transición QA.");
  const durationSeconds = 1;
  const edited = applyCompositionEditorPatches(document, [{
    transition: {
      alignment: "CENTER_AT_CUT",
      audioMode: "CUT",
      durationSeconds,
      easing: "sine.inOut",
      fromClipId: fromClip.id,
      id: "transition-runtime-smoke",
      origin: "USER",
      toClipId: toClip.id,
      type: "CROSS_DISSOLVE",
    },
    type: "transition.add",
  }]);
  const cutSeconds = fromClip.startSeconds + fromClip.durationSeconds;
  return {
    document: edited,
    durationSeconds,
    fromClipId: fromClip.id,
    midpointSeconds: cutSeconds,
    startSeconds: cutSeconds - durationSeconds / 2,
    toClipId: toClip.id,
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
  colorPatch: CompositionPreviewVisualPatch;
  documentHash: string;
  geometryPatch: CompositionPreviewVisualPatch;
  hfId: string;
  hidePatch: CompositionPreviewVisualPatch;
  motionPatch: CompositionPreviewVisualPatch;
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
        const colorResult = await dispatchPatch(${JSON.stringify(params.colorPatch)});
        assert(colorResult.applied === true && colorResult.code === "APPLIED", "color patch was not applied");
        document.documentElement.dataset.colorPatchDurationMs = String(colorResult.durationMs);
        const colorTarget = document.querySelector('[data-hf-id="' + CSS.escape(hfId) + '"]');
        assert(colorTarget instanceof HTMLElement, "color target was not found after acknowledgement");
        const colorMedia = document.getElementById(colorTarget.id + "-media");
        const colorRuntime = window.__hf?.colorGrading;
        assert(colorMedia instanceof HTMLImageElement && colorRuntime, "standalone color runtime was not installed");
        assert(window.__hfColorGradingRuntimeContractVersion === 1, "standalone color runtime contract diverged");
        const colorPayload = JSON.parse(colorMedia.getAttribute("data-color-grading") || "null");
        assert(colorPayload?.adjust?.exposure === 0.5, "color attribute diverged");
        const colorStatus = colorRuntime.getStatus(colorMedia);
        assert(["active", "pending", "unavailable"].includes(colorStatus.state), "color runtime status diverged");
        document.documentElement.dataset.colorRuntimeState = colorStatus.state;
        if (colorStatus.state === "unavailable") {
          assert(!colorMedia.hasAttribute("data-hf-color-grading-source-hidden"), "unavailable grading hid the source media");
        }

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
        const motionResult = await dispatchPatch(${JSON.stringify(params.motionPatch)});
        assert(motionResult.applied === true && motionResult.code === "APPLIED", "motion patch was not applied");
        await seekTo(0);
        const motionTarget = document.getElementById(hfId + "-motion");
        assert(motionTarget instanceof HTMLElement, "motion target was not found");
        assert(Number.parseFloat(motionTarget.style.opacity || "1") < 0.1, "live entry animation did not update the frame");
        await seekTo(2.5);
        const finalHideResult = await dispatchPatch(${JSON.stringify(params.hidePatch)});
        assert(finalHideResult.applied === true && target.dataset.runtimeVisibility === "hidden", "final visibility state diverged");
        document.documentElement.dataset.runtimePatchSmoke = "passed";
      };
      if (document.getElementById("composition-root")?.dataset.previewReady === "true") queueMicrotask(start);
    })();
  </script>`;
}

function renderTransitionRuntimeSmokeHarness(params: {
  document: ReturnType<typeof createInitialCompositionDocument>;
  durationSeconds: number;
  fromClipId: string;
  midpointSeconds: number;
  startSeconds: number;
  toClipId: string;
}) {
  return `<script>
    (() => {
      const protocolVersion = ${COMPOSITION_PREVIEW_PROTOCOL_VERSION};
      const fromClipId = ${JSON.stringify(params.fromClipId)};
      const toClipId = ${JSON.stringify(params.toClipId)};
      const startSeconds = ${params.startSeconds};
      const midpointSeconds = ${params.midpointSeconds};
      const durationSeconds = ${params.durationSeconds};
      const pendingSeeks = [];
      let started = false;
      const fail = (message) => { throw new Error("TRANSITION_RUNTIME_SMOKE: " + message); };
      const assert = (condition, message) => { if (!condition) fail(message); };
      const approximately = (actual, expected, tolerance = 0.08) => Math.abs(Number(actual) - expected) <= tolerance;
      const seekTo = (seconds) => new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("TRANSITION_RUNTIME_SMOKE_TIMEOUT")), 1500);
        pendingSeeks.push({
          resolve: (value) => { clearTimeout(timeout); resolve(value); },
          seconds,
        });
        window.postMessage({ protocolVersion, seconds, type: "courseforge-composition-seek" }, "*");
      });
      window.addEventListener("message", (event) => {
        if (event.source !== window || !event.data || typeof event.data.type !== "string") return;
        const message = event.data;
        if (message.type === "courseforge-composition-time") {
          for (let index = pendingSeeks.length - 1; index >= 0; index -= 1) {
            if (!approximately(message.seconds, pendingSeeks[index].seconds, 0.01)) continue;
            pendingSeeks.splice(index, 1)[0].resolve(message);
          }
        }
        if (message.type === "courseforge-composition-ready") start();
      });
      const readOpacity = (target) => Number.parseFloat(getComputedStyle(target).opacity || "0");
      const start = () => {
        if (started) return;
        started = true;
        void run().catch((error) => {
          document.documentElement.dataset.runtimePatchSmoke = "failed";
          document.documentElement.dataset.runtimePatchError = error instanceof Error ? error.message : String(error);
        });
      };
      const run = async () => {
        const from = document.getElementById(fromClipId);
        const to = document.getElementById(toClipId);
        assert(from instanceof HTMLElement && to instanceof HTMLElement, "transition endpoints were not found");
        await seekTo(startSeconds - 0.04);
        assert(approximately(readOpacity(from), 1), "outgoing clip is not fully visible before the window");
        await seekTo(midpointSeconds);
        const firstFromOpacity = readOpacity(from);
        const firstToOpacity = readOpacity(to);
        assert(approximately(firstFromOpacity, 0.5), "outgoing midpoint opacity diverged");
        assert(approximately(firstToOpacity, 0.5), "incoming midpoint opacity diverged");
        await seekTo(startSeconds + durationSeconds);
        assert(approximately(readOpacity(from), 0), "outgoing clip remains visible after the window");
        assert(approximately(readOpacity(to), 1), "incoming clip is not fully visible after the window");
        await seekTo(midpointSeconds);
        assert(approximately(readOpacity(from), firstFromOpacity), "backward seek changed outgoing state");
        assert(approximately(readOpacity(to), firstToOpacity), "backward seek changed incoming state");
        document.documentElement.dataset.transitionRuntimeSmoke = "passed";
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
