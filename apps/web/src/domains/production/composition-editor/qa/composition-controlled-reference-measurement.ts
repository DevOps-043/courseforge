import {mkdtemp, readdir, lstat, writeFile, unlink, rmdir} from "node:fs/promises";
import {join} from "node:path";
import {isDeepStrictEqual} from "node:util";
import {createHash} from "node:crypto";
import type {z} from "zod";
import {controlledMeasurementReferencesSchema as referencesSchema, bindControlledReferenceSelection} from "./composition-controlled-reference-selection";
import {readPersistedVisualConformanceEvidence} from "./composition-conformance-evidence-reader";
import {readPersistedAudioConformanceEvidence} from "./composition-audio-evidence-reader";
import {AUDIO_EVIDENCE_LIMITS} from "./composition-audio-evidence-contract";
import {compareExportedVideoWithPreview} from "./composition-exported-video-conformance";
import {buildControlledComparisonArtifacts} from "./composition-controlled-comparison-artifacts";
import {buildControlledEventComparisonArtifacts} from "./composition-controlled-event-comparison-artifacts";
import {assertConformanceReportMatchesContract} from "./composition-conformance-contract-report-gate";
import {pinConformanceFile, assertConformanceFileUnchanged, type ConformanceFilePin} from "./composition-conformance-file-integrity";
import {requiresControlledExecutorIntervention} from "./composition-controlled-execution-fence";
import {evaluatePlaybackAudioWitness} from "./composition-playback-audio-gate";
import type {ControlledSupervisorArtifacts} from "./composition-render-supervisor-binding";
import type {ControlledMaterializedExecutor} from "./composition-materialized-supervisor-renderer";
import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";

const limits = {referenceFileBytes: Math.max(131 * 1024 * 1024, AUDIO_EVIDENCE_LIMITS.wavBytes), referenceFiles: 256,
  receiptBytes: 20 * 1024 * 1024, videoBytes: 2 * 1024 * 1024 * 1024} as const;
const defaults = {readVisual: readPersistedVisualConformanceEvidence, readAudio: readPersistedAudioConformanceEvidence,
  compare: compareExportedVideoWithPreview};
type Descriptor = Parameters<ControlledMaterializedExecutor>[0];

/** Trusted worker composition only. Checksums select exact scoped records, never arbitrary reference paths.
 * Results are local measurements, not signed supervisor receipts or durable conformance admission. */
export async function measureControlledConformanceReferences(params: {
  descriptor: Descriptor; artifacts: ControlledSupervisorArtifacts;
  supabase: Parameters<typeof readPersistedVisualConformanceEvidence>[0]["supabase"];
  references: z.input<typeof referencesSchema>; videoPath: string; videoPin: ConformanceFilePin;
  outputParentDirectory: string; processPorts: ComparisonProcessPorts; signal: AbortSignal;
}, dependencies: typeof defaults = defaults) {
  const active = () => params.signal.throwIfAborted();
  active();
  // No unmanaged decoder fallback on this controlled route, including when dependencies are injected.
  if (!params.processPorts || typeof params.processPorts.execute !== "function"
    || typeof params.processPorts.consumePcm !== "function")
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_PROCESS_PORTS_REQUIRED");
  const descriptor = structuredClone(params.descriptor), artifacts = structuredClone(params.artifacts);
  const references = referencesSchema.parse(params.references);
  const built = artifacts.kind === "SINGLE_CONTRACT" ? buildControlledComparisonArtifacts(artifacts.input)
    : buildControlledEventComparisonArtifacts(artifacts.input);
  const comparisons = "receipt" in built ? [built] : built.artifacts;
  const rootContract = artifacts.kind === "SINGLE_CONTRACT" ? artifacts.input.contract : artifacts.input.parentContract;
  if (!isDeepStrictEqual(rootContract, descriptor.contract) || comparisons.length !== references.length
    || references.some((reference, index) => reference.batchIndex !== index)
    || comparisons.some(comparison => comparison.receipt.documentHash !== descriptor.documentHash
      || comparison.receipt.videoSha256 !== params.videoPin.sha256))
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_BINDING_INVALID");
  await assertConformanceFileUnchanged(params.videoPath, params.videoPin, limits.videoBytes, false, params.signal);
  const reports = [];
  for (const [index, comparison] of comparisons.entries()) {
    active();
    const reference = references[index]!;
    const visual = await dependencies.readVisual({supabase: params.supabase,
      organizationId: descriptor.organizationId, revisionId: descriptor.revisionId,
      checksum: reference.visualChecksum, outputParentDirectory: params.outputParentDirectory,
      ...(artifacts.kind === "EVENT_BATCH_SET" ? {eventBatchIndex: index} : {})});
    let audio: Awaited<ReturnType<typeof readPersistedAudioConformanceEvidence>> | undefined;
    let receiptDirectory: string | undefined, receiptPath: string | undefined;
    let retain = false;
    try {
      active();
      if (visual.checksum !== reference.visualChecksum || !isDeepStrictEqual(visual.contract, comparison.contract)
        || visual.receipt.organizationId !== descriptor.organizationId || visual.receipt.revisionId !== descriptor.revisionId
        || visual.receipt.projectHash !== descriptor.projectHash || visual.receipt.documentHash !== descriptor.documentHash)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_REFERENCE_MISMATCH");
      if (comparison.contract.audio.required && !reference.audioChecksum)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_AUDIO_REQUIRED");
      if (!comparison.contract.audio.required && reference.audioChecksum)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_AUDIO_UNEXPECTED");
      if (reference.audioChecksum) {
        audio = await dependencies.readAudio({supabase: params.supabase, organizationId: descriptor.organizationId,
          revisionId: descriptor.revisionId, visualChecksum: reference.visualChecksum, checksum: reference.audioChecksum,
          outputParentDirectory: params.outputParentDirectory});
        active();
        if (audio.checksum !== reference.audioChecksum || !isDeepStrictEqual(audio.contract, comparison.contract)
          || audio.receipt.visualChecksum !== visual.checksum || audio.receipt.organizationId !== descriptor.organizationId
          || audio.receipt.revisionId !== descriptor.revisionId || audio.receipt.projectHash !== descriptor.projectHash
          || audio.receipt.documentHash !== descriptor.documentHash)
          throw new Error("CONTROLLED_RENDER_MEASUREMENT_AUDIO_MISMATCH");
      }
      // Protect metadata/masks as well as ordinary PNG and WAV bytes throughout native measurement.
      const pins = await pinReferenceDirectory(visual.directory, params.signal);
      if (audio) pins.push(...await pinReferenceDirectory(audio.directory, params.signal));
      receiptDirectory = await mkdtemp(join(params.outputParentDirectory, "controlled-comparison-"));
      receiptPath = join(receiptDirectory, "render-receipt.json");
      const encoded = JSON.stringify(comparison.receipt);
      if (Buffer.byteLength(encoded) > limits.receiptBytes) throw new Error("CONTROLLED_RENDER_MEASUREMENT_RECEIPT_LIMIT");
      await writeFile(receiptPath, encoded, {flag: "wx", mode: 0o600});
      const receiptPin = await pinConformanceFile(receiptPath, limits.receiptBytes, false, params.signal);
      active();
      const report = await dependencies.compare({videoPath: params.videoPath, contractPath: visual.contractPath,
        previewDirectory: visual.previewDirectory, previewMetadataPath: visual.previewMetadataPath, renderReceiptPath: receiptPath,
        ...(audio ? {audioReferencePath: audio.audioReferencePath, audioReferenceMetadataPath: audio.audioReferenceMetadataPath} : {}),
        processPorts: params.processPorts, signal: params.signal, includeVisualMeasurements: true});
      active();
      if (report.documentHash !== descriptor.documentHash || report.video.sha256 !== params.videoPin.sha256
        || report.video.sizeBytes !== params.videoPin.sizeBytes)
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_REPORT_MISMATCH");
      assertConformanceReportMatchesContract(comparison.contract, report.visual, {videoSha256: params.videoPin.sha256});
      if (audio && (report.audioTiming.status === "NOT_REQUESTED"
        || report.status === "PASS" && report.audioTiming.rms?.status !== "PASS"))
        throw new Error("CONTROLLED_RENDER_MEASUREMENT_AUDIO_SKIPPED");
      const audioPlayback = audio?.receipt.schemaVersion === 3
        ? evaluatePlaybackAudioWitness(audio.receipt.playback, report.audioTiming, audio.contract.canvas.fps, audio.receipt.clipCount)
        : undefined;
      const status = report.status === "FAIL" || audioPlayback?.status === "FAIL" ? "FAIL" as const
        : report.status === "INCOMPLETE" || audioPlayback?.status === "INCOMPLETE" ? "INCOMPLETE" as const : "PASS" as const;
      await assertConformanceFileUnchanged(receiptPath, receiptPin, limits.receiptBytes, false, params.signal);
      for (const file of pins) await assertConformanceFileUnchanged(file.path, file.pin, limits.referenceFileBytes, false, params.signal);
      await assertConformanceFileUnchanged(params.videoPath, params.videoPin, limits.videoBytes, false, params.signal);
      reports.push({batchIndex: index, visualChecksum: visual.checksum, ...(audio ? {audioChecksum: audio.checksum} : {}),
        report: {...report, status, ...(audioPlayback ? {audioPlayback} : {})}});
    } catch (error) {
      retain = error instanceof Error && requiresControlledExecutorIntervention(error.message);
      throw error;
    } finally {
      // Independent measurement ownership must be confirmed before deleting its input files.
      if (!retain) {
        if (receiptPath) await unlink(receiptPath);
        if (receiptDirectory) await rmdir(receiptDirectory);
        if (audio) await audio.cleanup();
        await visual.cleanup();
      }
    }
  }
  active();
  const selection = bindControlledReferenceSelection(descriptor, references);
  return {scope: "LOCAL_CONTROLLED_MEASUREMENTS_NOT_SIGNED_OR_DURABLE_CONFORMANCE" as const,
    organizationId: descriptor.organizationId, revisionId: descriptor.revisionId,
    executionId: descriptor.executionId, documentHash: descriptor.documentHash, projectHash: descriptor.projectHash,
    contractSha256: selection.contractSha256,
    referenceSelectionSha256: createHash("sha256").update(JSON.stringify(selection)).digest("hex"),
    videoSha256: params.videoPin.sha256, reports,
    status: reports.some(item => item.report.status === "FAIL") ? "FAIL" as const
      : reports.some(item => item.report.status === "INCOMPLETE") ? "INCOMPLETE" as const : "PASS" as const};
}

async function pinReferenceDirectory(directory: string, signal: AbortSignal) {
  const entries = await readdir(directory, {withFileTypes: true});
  if (!entries.length || entries.length > limits.referenceFiles || entries.some(entry => !entry.isFile() || entry.isSymbolicLink()))
    throw new Error("CONTROLLED_RENDER_MEASUREMENT_REFERENCE_FILES_INVALID");
  const pins: Array<{path: string; pin: ConformanceFilePin}> = [];
  for (const entry of entries) {
    signal.throwIfAborted();
    const path = join(directory, entry.name);
    if ((await lstat(path)).nlink !== 1) throw new Error("CONTROLLED_RENDER_MEASUREMENT_REFERENCE_FILES_INVALID");
    pins.push({path, pin: await pinConformanceFile(path, limits.referenceFileBytes, false, signal)});
  }
  return pins;
}
