import type { SupabaseClient } from "@supabase/supabase-js";
import { materializeAuthorizedConformanceRevision } from "./composition-conformance-storage";
import { captureMaterializedConformancePreview } from "./composition-conformance-visual-capture";
import { persistVisualConformanceEvidence } from "./composition-conformance-evidence-persistence";
import {assertConformanceJobActive} from "./composition-conformance-job-lease";
import { type ConformanceExecutionStage, type ConformanceStageFailure,
  recordConformanceCleanupFailure, wrapConformanceStageFailure } from "./composition-conformance-stage-failure";

const defaultDependencies = {
  materialize: materializeAuthorizedConformanceRevision,
  capture: captureMaterializedConformancePreview,
  persist: persistVisualConformanceEvidence,
};

/** Worker-only orchestration. Does not enqueue, approve QA, or claim that audio was captured. */
export async function prepareAndPersistVisualConformanceReference(params: {
  supabase: SupabaseClient<any, any, any>; supabaseUrl: string; organizationId: string; revisionId: string;
  outputParentDirectory: string;
  captureTextRegions?: boolean;
  captureTextPaintMasks?: boolean;
  eventBatchIndex?: number;
  signal?: AbortSignal;
}, dependencies: typeof defaultDependencies = defaultDependencies) {
  let materialized: Awaited<ReturnType<typeof materializeAuthorizedConformanceRevision>> | null = null;
  let capture: Awaited<ReturnType<typeof captureMaterializedConformancePreview>> | null = null;
  let stage: ConformanceExecutionStage = "SOURCE_MATERIALIZATION";
  let primaryFailure: ConformanceStageFailure | undefined;
  try {
    assertConformanceJobActive(params.signal);
    materialized = await dependencies.materialize(params);
    assertConformanceJobActive(params.signal);
    stage = "PREVIEW_CAPTURE";
    capture = await dependencies.capture({ materialized, outputParentDirectory: params.outputParentDirectory,
      ...(params.signal ? {signal: params.signal} : {}),
      ...(params.eventBatchIndex !== undefined ? {eventBatchIndex: params.eventBatchIndex} : {}),
      ...(params.captureTextRegions === true ? {captureTextRegions: true} : {}),
      ...(params.captureTextPaintMasks === true ? {captureTextPaintMasks: true} : {}) });
    assertConformanceJobActive(params.signal);
    stage = "EVIDENCE_PERSISTENCE";
    const persisted = await dependencies.persist({ supabase: params.supabase, organizationId: params.organizationId,
      revisionId: params.revisionId, captureDirectory: capture.directory,
      ...(params.eventBatchIndex !== undefined ? {eventBatchIndex: params.eventBatchIndex, eventContract: capture.contract} : {}) });
    assertConformanceJobActive(params.signal);
    return persisted;
  } catch (error) {
    primaryFailure = wrapConformanceStageFailure(stage, error);
    throw primaryFailure;
  } finally {
    // Both workspaces are independent; a failed cleanup must not skip the other one.
    const cleanups = await Promise.allSettled([
      ...(capture ? [Promise.resolve().then(() => capture!.cleanup())] : []),
      ...(materialized ? [Promise.resolve().then(() => materialized!.cleanup())] : []),
    ]);
    if (cleanups.some((result) => result.status === "rejected")) throw recordConformanceCleanupFailure(primaryFailure);
  }
}
