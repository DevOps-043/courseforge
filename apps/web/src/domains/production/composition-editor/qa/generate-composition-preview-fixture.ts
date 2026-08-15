import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  collectAnimatedDeckRemoteAssetUrls,
  prepareAnimatedDeckForRemotion,
  rewriteAnimatedDeckRemoteAssetUrls,
} from "../../validation/animated-deck-preprocessor.service";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  COMPOSITION_COMPILATION_TARGETS,
  compileCompositionPreview,
  readCompositionAnimationRuntime,
} from "../composition-preview-compiler.service";

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
  const document = createInitialCompositionDocument({
    animatedDeck,
    assets: [],
    plan: {
      accentColor: "#23AEA8",
      durationSeconds: prepared.deck.slides.length * 5,
      subtitle: "Fixture visual del preview nativo",
      title: "SofLIA preview QA",
    },
  });
  const fontDataUrls = new Map(
    prepared.fonts.map((font) => [font.href, "data:text/css;charset=utf-8,"]),
  );
  const renderHtml = await compileCompositionPreview({
    assetUrls: new Map(),
    deckAssetUrls: fontDataUrls,
    document,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
  });
  const interactivePreviewHtml = await compileCompositionPreview({
    assetUrls: new Map(),
    deckAssetUrls: fontDataUrls,
    document,
    target: COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW,
  });
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
  };

  await Promise.all([
    mkdir(resolve(outputDirectory, "assets"), { recursive: true }),
    mkdir(interactiveOutputDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(resolve(outputDirectory, "index.html"), renderHtml, "utf8"),
    writeFile(resolve(outputDirectory, "assets/gsap.min.js"), animationRuntime, "utf8"),
    writeFile(resolve(interactiveOutputDirectory, "index.html"), interactivePreviewHtml, "utf8"),
    writeFile(resolve(outputDirectory, "qa-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8"),
  ]);
  process.stdout.write(`${JSON.stringify({ interactiveOutputDirectory, outputDirectory, ...report }, null, 2)}\n`);
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
