import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";
import { z } from "zod";
import { buildConformanceReferenceSource, verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildCompositionConformanceContract } from "../composition-preview-render-conformance";
import { NATIVE_CONFORMANCE_CORPUS_FPS } from "./composition-native-conformance-corpus";
import { buildVideoConformanceCorpusCase, listVideoConformanceCorpusRecipes, type VideoCorpusSource } from "./composition-video-conformance-corpus";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const videoCorpusReceiptSchema = z.object({
  scope: z.literal("LOCAL_ENCODING_AND_PROBE_NOT_RENDER_PARITY"),
  source: z.object({id: z.string().uuid(), checksum: hash, sizeBytes: z.number().int().positive().max(100 * 1024 * 1024),
    durationSeconds: z.literal(10), fps: z.union(NATIVE_CONFORMANCE_CORPUS_FPS.map((fps) => z.literal(fps))),
    width: z.literal(1920), height: z.literal(1080), hasAudio: z.literal(true), mimeType: z.literal("video/mp4")}).strict(),
  frameCount: z.number().int().positive(),
  decodedFrames: z.array(z.object({timeSeconds: z.number(), pngSha256: hash, pixelSha256: hash}).strict()).length(2),
  decodedAudio: z.object({decodedPcmSha256: hash, decodedFrames: z.number().int().positive(),
    measuredWindowCount: z.literal(20), maximumRmsDeltaDb: z.number().finite().nonnegative().max(1.5),
    policy: z.literal("CORPUS_STEREO_RMS_HALF_SECOND_V1")}).strict(),
  cases: z.array(z.object({recipeId: z.string(), caseSha256: hash, documentHash: hash}).strict()).length(7),
}).passthrough();

async function hashVideoFile(path: string, expectedSize: number) {
  const before = await lstat(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size !== expectedSize) throw new Error("CONFORMANCE_CORPUS_SOURCE_FILE_INVALID");
  const digest = createHash("sha256"); let size = 0;
  for await (const chunk of createReadStream(path)) {
    size += (chunk as Buffer).length;
    if (size > expectedSize) throw new Error("CONFORMANCE_CORPUS_SOURCE_FILE_CHANGED");
    digest.update(chunk as Buffer);
  }
  const after = await lstat(path);
  if (!after.isFile() || after.isSymbolicLink() || after.size !== expectedSize || size !== expectedSize
    || after.mtimeMs !== before.mtimeMs || after.ino !== before.ino) throw new Error("CONFORMANCE_CORPUS_SOURCE_FILE_CHANGED");
  return digest.digest("hex");
}

async function compileCase(source: VideoCorpusSource, recipeId: string) {
  const fixture = buildVideoConformanceCorpusCase(recipeId, source);
  const asset = {productionAssetId: source.id, checksum: source.checksum, fileSizeBytes: source.sizeBytes,
    mimeType: source.mimeType, storageBucket: "production-assets", storagePath: `corpus/${source.checksum}.mp4`};
  const contract = buildCompositionConformanceContract({contractVersion: 3, document: fixture.document,
    documentHash: fixture.documentHash, assets: [{id: source.id, checksum: source.checksum}],
    renderProfile: {format: "mp4", fps: source.fps, quality: "high", resolution: "1080p"}});
  const frozen = await buildConformanceReferenceSource({document: fixture.document, contract, assets: [asset]});
  const verified = verifyConformanceReferenceSource(frozen);
  const renderHtml = await compileCompositionPreview({document: fixture.document,
    assetUrls: new Map([[source.id, `conformance-media/${source.id}`]]),
    target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER});
  if (verified.contract.documentHash !== fixture.documentHash || verified.metadata.bindings[0]?.checksum !== source.checksum
    || !frozen.previewHtml.includes(`conformance-media/${source.id}`)
    || !renderHtml.includes(`conformance-media/${source.id}`)) throw new Error("CONFORMANCE_CORPUS_COMPILATION_BINDING_INVALID");
  return {recipeId, caseSha256: fixture.caseSha256, documentHash: fixture.documentHash,
    previewSha256: frozen.metadata.previewSha256, renderSha256: createHash("sha256").update(renderHtml).digest("hex")};
}

/** Read-only local preparation; receipts are editable and do not attest a provider render. */
export async function compileVideoCorpusFromReceipts(receiptPaths: string[]) {
  if (receiptPaths.length !== NATIVE_CONFORMANCE_CORPUS_FPS.length || receiptPaths.some((path) => !isAbsolute(path) || path.includes("\0")))
    throw new Error("CONFORMANCE_CORPUS_RECEIPT_ARGUMENTS_INVALID");
  const seenFps = new Set<number>(); const outputs = [];
  for (const receiptPath of receiptPaths) {
    const file = await lstat(receiptPath);
    if (!file.isFile() || file.isSymbolicLink() || file.size <= 0 || file.size > 64 * 1024)
      throw new Error("CONFORMANCE_CORPUS_RECEIPT_FILE_INVALID");
    const receipt = videoCorpusReceiptSchema.parse(JSON.parse(await readFile(receiptPath, "utf8")));
    const source = receipt.source;
    if (seenFps.has(source.fps) || receipt.frameCount !== source.fps * source.durationSeconds
      || receipt.decodedFrames[0]?.timeSeconds !== 0 || receipt.decodedFrames[1]?.timeSeconds !== 5
      || receipt.decodedFrames[0].pixelSha256 === receipt.decodedFrames[1].pixelSha256
      || receipt.decodedAudio.decodedFrames < 480000 || receipt.decodedAudio.decodedFrames > 481024)
      throw new Error("CONFORMANCE_CORPUS_RECEIPT_EVIDENCE_INVALID");
    seenFps.add(source.fps);
    const videoPath = join(dirname(receiptPath), "source.mp4");
    if (await hashVideoFile(videoPath, source.sizeBytes) !== source.checksum)
      throw new Error("CONFORMANCE_CORPUS_SOURCE_HASH_MISMATCH");
    const cases = [];
    for (const recipeId of listVideoConformanceCorpusRecipes()) {
      const compiled = await compileCase(source, recipeId);
      const recorded = receipt.cases.find((item) => item.recipeId === recipeId);
      if (recorded?.caseSha256 !== compiled.caseSha256 || recorded.documentHash !== compiled.documentHash)
        throw new Error("CONFORMANCE_CORPUS_CASE_RECEIPT_MISMATCH");
      cases.push(compiled);
    }
    if (new Set(receipt.cases.map((item) => item.recipeId)).size !== cases.length)
      throw new Error("CONFORMANCE_CORPUS_CASE_RECEIPT_MISMATCH");
    outputs.push({fps: source.fps, sourceSha256: source.checksum, cases});
  }
  if (seenFps.size !== NATIVE_CONFORMANCE_CORPUS_FPS.length) throw new Error("CONFORMANCE_CORPUS_FPS_COVERAGE_INVALID");
  return {scope: "LOCAL_RECEIPT_AND_COMPILATION_NOT_RENDER_EVIDENCE" as const,
    caseCount: outputs.reduce((count, output) => count + output.cases.length, 0),
    sources: outputs.sort((left, right) => left.fps - right.fps)};
}
