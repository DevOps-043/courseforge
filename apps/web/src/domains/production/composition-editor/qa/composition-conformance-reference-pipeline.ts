import type { SupabaseClient } from "@supabase/supabase-js";
import { materializeAuthorizedConformanceRevision } from "./composition-conformance-storage";
import { captureMaterializedConformancePreview } from "./composition-conformance-visual-capture";
import { persistVisualConformanceEvidence } from "./composition-conformance-evidence-persistence";

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
  eventBatchIndex?: number;
}, dependencies: typeof defaultDependencies = defaultDependencies) {
  let materialized: Awaited<ReturnType<typeof materializeAuthorizedConformanceRevision>> | null = null;
  let capture: Awaited<ReturnType<typeof captureMaterializedConformancePreview>> | null = null;
  try {
    materialized = await dependencies.materialize(params);
    capture = await dependencies.capture({ materialized, outputParentDirectory: params.outputParentDirectory,
      ...(params.eventBatchIndex !== undefined ? {eventBatchIndex: params.eventBatchIndex} : {}),
      ...(params.captureTextRegions === true ? {captureTextRegions: true} : {}) });
    return await dependencies.persist({ supabase: params.supabase, organizationId: params.organizationId,
      revisionId: params.revisionId, captureDirectory: capture.directory,
      ...(params.eventBatchIndex !== undefined ? {eventBatchIndex: params.eventBatchIndex, eventContract: capture.contract} : {}) });
  } finally {
    // Both workspaces are independent; a failed cleanup must not skip the other one.
    const cleanups = await Promise.allSettled([
      ...(capture ? [Promise.resolve().then(() => capture!.cleanup())] : []),
      ...(materialized ? [Promise.resolve().then(() => materialized!.cleanup())] : []),
    ]);
    if (cleanups.some((result) => result.status === "rejected")) throw new Error("CONFORMANCE_REFERENCE_PIPELINE_CLEANUP_FAILED");
  }
}
