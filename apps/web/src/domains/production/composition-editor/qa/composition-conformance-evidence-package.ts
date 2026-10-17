import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";
import sharp from "sharp";
import { z } from "zod";
import { compositionConformanceContractSchema, COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS } from "../composition-preview-render-conformance";
import { compositionConformanceCaptureMetadataSchema } from "./composition-conformance-files";
import { textParityEvidenceHash, validateTextParityEvidence, assertRequiredTextPaintMaskEvidence } from "./composition-text-parity-evidence";
import { assertRequiredFontUsageEvidence, fontUsageEvidenceHash, validateFontUsageEvidence } from "./composition-font-usage-evidence";
import { browserIdentityHash } from "./composition-browser-identity";
import { browserExecutableIdentityHash } from "./composition-browser-executable-identity";
import { eventBatchCaptureLineageSchema, assertEventBatchCaptureLineage } from "../composition-conformance-event-batch-lineage";
import type { CompositionEditorDocument } from "../composition-document.types";
import { suppressedTextFrameName, verifyTextPaintMaskPair } from "./composition-text-paint-mask-derivation";
import { COMPOSITION_TEXT_PARITY_POLICY } from "../composition-text-parity-policy";
import { validateDeckTextEvidence, hashDeckTextEvidence } from "./composition-deck-text-evidence";
import { suppressedDeckTextFrameName, verifyDeckTextPaintPair } from "./composition-deck-text-paint-derivation";

export const CONFORMANCE_EVIDENCE_STORAGE = { bucket: "composition-conformance-evidence", maximumBytes: 144 * 1024 * 1024 } as const;
const MAX_FRAME_BYTES = 20 * 1024 * 1024;
const MAX_FRAMES_BYTES = 128 * 1024 * 1024;
export const visualCaptureReceiptSchema = z.object({
  schemaVersion: z.literal(1), organizationId: z.string().uuid(), revisionId: z.string().uuid(),
  projectHash: z.string().regex(/^[a-f0-9]{64}$/), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.literal("VISUAL_CAPTURED_AUDIO_PENDING"), assetCount: z.number().int().min(0).max(250),
  mediaBytes: z.number().int().min(0).max(2 * 1024 * 1024 * 1024), networkPolicy: z.literal("EXACT_LOCAL_ALLOWLIST_V1"),
  textParitySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  deckTextSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  fontUsageSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  browserIdentitySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  browserExecutableIdentitySha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  eventBatchLineage: eventBatchCaptureLineageSchema.optional(),
  // Old captures remain readable, but never gain a repeatability claim retroactively.
  seekRepeatability: z.object({ policy: z.literal("EXACT_PNG_FORWARD_REVERSE_V1"), status: z.literal("PASS"),
    checkpointCount: z.number().int().positive().max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
  }).strict().optional(),
  frames: z.array(z.object({ frameIndex: z.number().int().nonnegative(), timeSeconds: z.number().finite().nonnegative(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/), sizeBytes: z.number().int().positive().max(MAX_FRAME_BYTES),
  }).strict()).min(1).max(COMPOSITION_CONFORMANCE_MAX_CHECKPOINTS),
}).strict();

async function boundedFile(path: string, maximumBytes: number) {
  const file = await lstat(path);
  if (!file.isFile() || file.size <= 0 || file.size > maximumBytes) throw new Error("CONFORMANCE_EVIDENCE_FILE_INVALID");
  const bytes = await readFile(path);
  if (bytes.length !== file.size || bytes.length > maximumBytes) throw new Error("CONFORMANCE_EVIDENCE_FILE_CHANGED");
  return bytes;
}

/** Revalidates local capture files; a worker must bind these to its authorized revision. */
export async function validateVisualConformanceCapture(params: {
  captureDirectory: string; organizationId: string; revisionId: string; projectHash: string; contract: unknown;
  authorizedEventSource?: {document: CompositionEditorDocument; parentContract: unknown};
  authorizedEventRevision?: {parentContract: unknown; batchAuthorization: unknown};
}) {
  const contract = compositionConformanceContractSchema.parse(params.contract);
  const receipt = visualCaptureReceiptSchema.parse(JSON.parse((await boundedFile(join(params.captureDirectory, "capture-receipt.json"), 1024 * 1024)).toString("utf8")));
  const metadata = compositionConformanceCaptureMetadataSchema.parse(JSON.parse((await boundedFile(join(params.captureDirectory, "preview-metadata.json"), 1024 * 1024)).toString("utf8")));
  assertEventBatchCaptureLineage(receipt.eventBatchLineage, contract, params.authorizedEventSource, params.authorizedEventRevision);
  if (receipt.organizationId !== params.organizationId || receipt.revisionId !== params.revisionId
    || receipt.projectHash !== params.projectHash || receipt.documentHash !== contract.documentHash
    || metadata.documentHash !== contract.documentHash) throw new Error("CONFORMANCE_EVIDENCE_REVISION_MISMATCH");
  const frames = new Map(receipt.frames.map((frame) => [frame.frameIndex, frame]));
  if (Boolean(metadata.browserIdentity) !== Boolean(receipt.browserIdentitySha256)) throw new Error("CONFORMANCE_BROWSER_IDENTITY_PIN_MISSING");
  if (metadata.browserIdentity && browserIdentityHash(metadata.browserIdentity) !== receipt.browserIdentitySha256) {
    throw new Error("CONFORMANCE_BROWSER_IDENTITY_PIN_MISMATCH");
  }
  if (Boolean(metadata.browserExecutableIdentity) !== Boolean(receipt.browserExecutableIdentitySha256)) throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_PIN_MISSING");
  if (metadata.browserExecutableIdentity && browserExecutableIdentityHash(metadata.browserExecutableIdentity) !== receipt.browserExecutableIdentitySha256) {
    throw new Error("CONFORMANCE_BROWSER_EXECUTABLE_PIN_MISMATCH");
  }
  assertRequiredFontUsageEvidence(metadata.fontUsage, contract);
  validateDeckTextEvidence(metadata.deckText, contract);
  if (Boolean(metadata.deckText) !== Boolean(receipt.deckTextSha256)) throw new Error("CONFORMANCE_DECK_TEXT_EVIDENCE_PIN_MISSING");
  if (metadata.deckText && hashDeckTextEvidence(metadata.deckText) !== receipt.deckTextSha256)
    throw new Error("CONFORMANCE_DECK_TEXT_EVIDENCE_PIN_MISMATCH");
  assertRequiredTextPaintMaskEvidence(metadata.textParity, contract);
  if (Boolean(metadata.textParity) !== Boolean(receipt.textParitySha256)) throw new Error("CONFORMANCE_TEXT_EVIDENCE_PIN_MISSING");
  if (metadata.textParity) {
    validateTextParityEvidence(metadata.textParity, contract);
    if (textParityEvidenceHash(metadata.textParity) !== receipt.textParitySha256) throw new Error("CONFORMANCE_TEXT_EVIDENCE_PIN_MISMATCH");
  }
  if (Boolean(metadata.fontUsage) !== Boolean(receipt.fontUsageSha256)) throw new Error("CONFORMANCE_FONT_USAGE_PIN_MISSING");
  if (metadata.fontUsage) {
    if (!metadata.textParity) throw new Error("CONFORMANCE_FONT_USAGE_TEXT_EVIDENCE_MISSING");
    validateFontUsageEvidence(metadata.fontUsage, metadata.textParity);
    if (fontUsageEvidenceHash(metadata.fontUsage) !== receipt.fontUsageSha256) throw new Error("CONFORMANCE_FONT_USAGE_PIN_MISMATCH");
  }
  if (receipt.seekRepeatability && receipt.seekRepeatability.checkpointCount !== contract.checkpoints.length) {
    throw new Error("CONFORMANCE_EVIDENCE_REPEATABILITY_INVALID");
  }
  const times = new Map(metadata.frames.map((frame) => [frame.frameIndex, frame.timeSeconds]));
  if (frames.size !== receipt.frames.length || times.size !== metadata.frames.length
    || frames.size !== contract.checkpoints.length || times.size !== frames.size
    || contract.checkpoints.some((checkpoint) => !frames.has(checkpoint.frameIndex)
      || times.get(checkpoint.frameIndex) !== frames.get(checkpoint.frameIndex)!.timeSeconds
      || Math.abs(frames.get(checkpoint.frameIndex)!.timeSeconds - checkpoint.timeSeconds) > 0.01)) {
    throw new Error("CONFORMANCE_EVIDENCE_CHECKPOINTS_INVALID");
  }
  const images: Array<{ name: string; bytes: Buffer }> = [];
  let totalBytes = 0;
  for (const checkpoint of contract.checkpoints) {
    const frame = frames.get(checkpoint.frameIndex)!;
    const paintedHash = metadata.textParity?.checkpoints.find((entry) => entry.frameIndex === checkpoint.frameIndex)?.paintMaskCapture?.paintedPngSha256;
    if (paintedHash && paintedHash !== frame.sha256) throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_FRAME_MISMATCH");
    const bytes = await boundedFile(join(params.captureDirectory, `frame-${frame.frameIndex}.png`), MAX_FRAME_BYTES);
    totalBytes += bytes.length;
    if (totalBytes > MAX_FRAMES_BYTES || bytes.length !== frame.sizeBytes || createHash("sha256").update(bytes).digest("hex") !== frame.sha256) {
      throw new Error("CONFORMANCE_EVIDENCE_FRAME_MISMATCH");
    }
    const image = await sharp(bytes, { limitInputPixels: contract.canvas.width * contract.canvas.height }).metadata();
    if (image.format !== "png" || image.width !== contract.canvas.width || image.height !== contract.canvas.height) throw new Error("CONFORMANCE_EVIDENCE_IMAGE_INVALID");
    images.push({ name: `frame-${frame.frameIndex}.png`, bytes });
    const textCheckpoint = metadata.textParity?.checkpoints.find((entry) => entry.frameIndex === frame.frameIndex);
    if (textCheckpoint?.paintMaskCapture) {
      const name = suppressedTextFrameName(frame.frameIndex);
      const suppressed = await boundedFile(join(params.captureDirectory, name), COMPOSITION_TEXT_PARITY_POLICY.maximumPaintCapturePngBytes);
      totalBytes += suppressed.length;
      if (totalBytes > MAX_FRAMES_BYTES) throw new Error("CONFORMANCE_EVIDENCE_FRAME_MISMATCH");
      await verifyTextPaintMaskPair({checkpoint: textCheckpoint, paintedPng: bytes, suppressedPng: suppressed,
        width: contract.canvas.width, height: contract.canvas.height});
      images.push({name, bytes: suppressed});
    }
  }
  for (const checkpoint of metadata.deckText?.checkpoints ?? []) if (checkpoint.paintCapture) {
    const painted = images.find((image) => image.name === `frame-${checkpoint.frameIndex}.png`)!.bytes;
    const name = suppressedDeckTextFrameName(checkpoint.frameIndex);
    const bytes = await boundedFile(join(params.captureDirectory, name), COMPOSITION_TEXT_PARITY_POLICY.maximumPaintCapturePngBytes);
    totalBytes += bytes.length;
    if (totalBytes > MAX_FRAMES_BYTES) throw new Error("CONFORMANCE_EVIDENCE_FRAME_BYTES_LIMIT");
    await verifyDeckTextPaintPair({checkpoint, paintedPng: painted, suppressedPng: bytes, width: contract.canvas.width, height: contract.canvas.height});
    images.push({name, bytes});
  }
  return { contract, metadata, receipt, images };
}

export async function buildVisualConformanceEvidencePackage(params: Parameters<typeof validateVisualConformanceCapture>[0]) {
  const { contract, metadata, receipt, images } = await validateVisualConformanceCapture(params);
  const zip = new JSZip(); const fixedDate = new Date("2000-01-01T00:00:00Z");
  const add = (name: string, bytes: string | Buffer) => zip.file(name, bytes, { date: fixedDate, createFolders: false });
  add("conformance-contract.json", JSON.stringify(contract)); add("preview-metadata.json", JSON.stringify(metadata));
  add("capture-receipt.json", JSON.stringify(receipt));
  for (const image of images) add(image.name, image.bytes);
  const bytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  if (bytes.length > CONFORMANCE_EVIDENCE_STORAGE.maximumBytes) throw new Error("CONFORMANCE_EVIDENCE_PACKAGE_TOO_LARGE");
  const checksum = createHash("sha256").update(bytes).digest("hex");
  return { bytes, checksum, receipt, storagePath: `${params.organizationId}/${params.revisionId}/${checksum}.zip` };
}
