import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildNativeConformanceCorpusCase, type NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { pinConformanceFile, assertConformanceFileUnchanged } from "./composition-conformance-file-integrity";
import { buildVideoConformanceCorpusCase } from "./composition-video-conformance-corpus";
import { videoCorpusReceiptSchema } from "./composition-video-corpus-compile";
import {createHash} from "node:crypto";
import {compositionEditorDocumentSchema} from "../composition-document.types";
import {hashCompositionDocument} from "../composition-document.service";
import {conformanceFontPath, conformanceFontManifestHash, assertCompiledConformanceFontBindings,
  type ConformanceFontManifest} from "../composition-conformance-font-bindings";

/** Local bundled font bytes only; compilation does not certify font decoding or glyph coverage. */
export async function compileControlledNativeFontCorpus(fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number],
  recipeId: string, fontPath: string) {
  if (!isAbsolute(fontPath) || fontPath.includes("\0")) throw new Error("CONTROLLED_RENDER_FONT_ARGUMENT_INVALID");
  const base = buildNativeConformanceCorpusCase(recipeId, fps);
  if (base.recipe.category === "COLOR") throw new Error("CONTROLLED_RENDER_FONT_RECIPE_INVALID");
  const fontPin = await pinConformanceFile(fontPath, 50 * 1024 * 1024);
  const fonts: ConformanceFontManifest = [{fontAssetId: "27000000-0000-4000-8000-000000000005",
    family: "Courseforge Authored Font", mimeType: "font/woff2", checksumSha256: fontPin.sha256, fileSizeBytes: fontPin.sizeBytes}];
  const document = structuredClone(base.document);
  for (const clip of document.clips) {
    if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS")
      throw new Error("CONTROLLED_RENDER_FONT_RECIPE_INVALID");
    clip.source.style.fontAssetId = fonts[0].fontAssetId; clip.source.style.fontFamily = fonts[0].family;
  }
  const validated = compositionEditorDocumentSchema.parse(document), documentHash = hashCompositionDocument(validated);
  const fontAssets = new Map([[fonts[0].fontAssetId, {assetId: fonts[0].fontAssetId, family: fonts[0].family,
    format: "woff2" as const, sourceUrl: conformanceFontPath(fonts[0])}]]);
  assertCompiledConformanceFontBindings(validated, fonts, fontAssets);
  const html = await compileCompositionPreview({document: validated, documentHash, fontAssets,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER, assetUrls: new Map()});
  await assertConformanceFileUnchanged(fontPath, fontPin, 50 * 1024 * 1024);
  const caseSha256 = createHash("sha256").update(JSON.stringify({baseCaseSha256: base.caseSha256,
    documentHash, manifestSha256: conformanceFontManifestHash(fonts)})).digest("hex");
  return {fixture: {...base, document: validated, documentHash, caseSha256}, html, fonts,
    fontPath, fontPin, materializedFontPath: conformanceFontPath(fonts[0])};
}

/** Producer inputs omit export bootstrap scripts: the official CLI supplies its verified runtime. */
export async function compileControlledRenderCorpus(fps: typeof NATIVE_CONFORMANCE_CORPUS_FPS[number]) {
  const fixture = buildNativeConformanceCorpusCase("color-neutral", fps);
  const html = await compileCompositionPreview({document: fixture.document, documentHash: fixture.documentHash,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
    assetUrls: new Map(fixture.assets.map((asset) => [asset.id, `data:${asset.mimeType};charset=utf-8,${encodeURIComponent(asset.content)}`]))});
  return {fixture, html};
}

/** Authored synthetic recipe only. Editable receipts bind bytes, not trust or provider provenance. */
export async function compileControlledVideoCorpus(receiptPath: string, recipeId: string) {
  if (!isAbsolute(receiptPath) || receiptPath.includes("\0")) throw new Error("CONTROLLED_RENDER_SOURCE_ARGUMENT_INVALID");
  const receiptPin = await pinConformanceFile(receiptPath, 64 * 1024);
  const receipt = videoCorpusReceiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
  const sourcePath = join(dirname(receiptPath), "source.mp4");
  const sourcePin = await pinConformanceFile(sourcePath, 100 * 1024 * 1024);
  if (sourcePin.sha256 !== receipt.source.checksum || sourcePin.sizeBytes !== receipt.source.sizeBytes
    || receipt.frameCount !== receipt.source.fps * 10 || receipt.decodedFrames[0]?.timeSeconds !== 0
    || receipt.decodedFrames[1]?.timeSeconds !== 5 || receipt.decodedFrames[0]?.pixelSha256 === receipt.decodedFrames[1]?.pixelSha256
    || receipt.decodedAudio.decodedFrames < 480000 || receipt.decodedAudio.decodedFrames > 481024)
    throw new Error("CONTROLLED_RENDER_SOURCE_EVIDENCE_INVALID");
  const fixture = buildVideoConformanceCorpusCase(recipeId, receipt.source);
  const recorded = receipt.cases.filter((entry) => entry.recipeId === recipeId);
  if (recorded.length !== 1 || recorded[0]!.caseSha256 !== fixture.caseSha256 || recorded[0]!.documentHash !== fixture.documentHash)
    throw new Error("CONTROLLED_RENDER_SOURCE_CASE_MISMATCH");
  const html = await compileCompositionPreview({document: fixture.document, documentHash: fixture.documentHash,
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER,
    assetUrls: new Map([[receipt.source.id, "assets/source.mp4"]])});
  await assertConformanceFileUnchanged(receiptPath, receiptPin, 64 * 1024);
  await assertConformanceFileUnchanged(sourcePath, sourcePin, 100 * 1024 * 1024);
  return {fixture, html, sourcePath, sourceSha256: sourcePin.sha256, receiptSha256: receiptPin.sha256};
}
