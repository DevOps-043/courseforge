import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { materializeAuthorizedConformanceRevision } from "./composition-conformance-storage";
import { verifyConformanceReferenceSource } from "../composition-conformance-reference.service";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { prepareCompositionEventBatchContracts, assertSnapshotEventBatchAuthorization } from "../composition-conformance-event-batch-contract";
import { createPersistedCompositionEventBatchAdapters } from "./composition-conformance-event-batch-adapters";
import { eventBatchMeasurementIdentitySchema, executeCompositionEventCheckpointBatches } from "./composition-conformance-event-batch-execution";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import type {ComparisonProcessPorts} from "./composition-comparison-process-ports";
import {requiresConformanceExecutionRecovery} from "./composition-conformance-stage-failure";

async function readMaterializedSource(root: string) {
  return verifyConformanceReferenceSource({
    previewHtml: await readFile(join(root, "conformance-preview.html"), "utf8"),
    documentJson: await readFile(join(root, "composition-document.json"), "utf8"),
    contractJson: await readFile(join(root, "conformance-contract.json"), "utf8"),
    metadata: JSON.parse(await readFile(join(root, "conformance-reference.json"), "utf8")),
    fontManifest: JSON.parse(await readFile(join(root, "font-manifest.json"), "utf8")),
  });
}
const defaultDependencies = {materialize: materializeAuthorizedConformanceRevision, readSource: readMaterializedSource,
  createAdapters: createPersistedCompositionEventBatchAdapters, execute: executeCompositionEventCheckpointBatches};

/** Worker entrypoint: resolves authorized root, executes all event partitions, and disposes source workspace. */
export async function executePersistedCompositionEventBatches(input:
  Parameters<typeof materializeAuthorizedConformanceRevision>[0] & {
    projectHash: string; documentHash: string; videoSha256: string; videoPath: string; renderReceiptPath: string; signal?: AbortSignal;
    processPorts?: ComparisonProcessPorts;
    visualReferenceChecksums?: string[];
    resolveRenderReceipt?: (contractSha256: string, batchIndex: number) => {path: string; sha256: string};
  }, dependencies: typeof defaultDependencies = defaultDependencies) {
  const params = {...input};
  assertConformanceJobActive(params.signal);
  const revision = await params.supabase.from("video_composition_revisions").select("id, organization_id, project_hash, manifest")
    .eq("id", params.revisionId).eq("organization_id", params.organizationId).maybeSingle();
  assertConformanceJobActive(params.signal);
  const row = revision.data;
  if (revision.error || !row || row.id !== params.revisionId || row.organization_id !== params.organizationId
    || row.project_hash !== params.projectHash) throw new Error("CONFORMANCE_EVENT_JOB_REVISION_MISMATCH");
  const parentContract = compositionConformanceContractSchema.parse(row.manifest?.conformance_contract);
  if (parentContract.documentHash !== params.documentHash) throw new Error("CONFORMANCE_EVENT_JOB_DOCUMENT_MISMATCH");
  if (parentContract.schemaVersion !== 4 || !parentContract.checkpointBatch) return null;
  const materialized = await dependencies.materialize(params);
  let recoveryRequired = false;
  try {
    assertConformanceJobActive(params.signal);
    const root = materialized.directory;
    const source = await dependencies.readSource(root);
    assertConformanceJobActive(params.signal);
    if (materialized.receipt.projectHash !== params.projectHash || materialized.receipt.documentHash !== params.documentHash
      || !isDeepStrictEqual(source.contract, parentContract)) throw new Error("CONFORMANCE_EVENT_JOB_SOURCE_MISMATCH");
    assertSnapshotEventBatchAuthorization(row.manifest, source.document);
    const prepared = prepareCompositionEventBatchContracts({document: source.document, parentContract});
    const rootIdentity = eventBatchMeasurementIdentitySchema.parse({organizationId: params.organizationId,
      revisionId: params.revisionId, projectHash: params.projectHash, videoSha256: params.videoSha256,
      documentHash: params.documentHash, parentContractSha256: prepared.parentContractSha256,
      batchContractSha256: prepared.parentContractSha256, batch: parentContract.checkpointBatch});
    return await dependencies.execute({document: source.document, parentContract,
      organizationId: params.organizationId, revisionId: params.revisionId, projectHash: params.projectHash,
      videoSha256: params.videoSha256, signal: params.signal, visualReferenceChecksums: params.visualReferenceChecksums},
    dependencies.createAdapters({...params, rootIdentity}));
  } catch (error) {
    recoveryRequired = requiresConformanceExecutionRecovery(error);
    throw error;
  } finally {
    if (!recoveryRequired) {
      try {await materialized.cleanup();} catch {throw new Error("CONFORMANCE_EVENT_JOB_SOURCE_CLEANUP_FAILED");}
    }
  }
}
