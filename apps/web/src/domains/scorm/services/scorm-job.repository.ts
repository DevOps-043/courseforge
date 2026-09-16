import type { SupabaseClient } from "@supabase/supabase-js";
import { SCORM_JOB_LEASE_SECONDS } from "../scorm-job-contracts";

export interface ScormJobClaimInput {
  importId: string;
  organizationId: string;
  queuedStep: string;
  runningStep: string;
  status: string;
}

export async function claimScormImportJob<TRecord>(
  supabase: SupabaseClient,
  input: ScormJobClaimInput,
): Promise<TRecord | null> {
  const { data, error } = await supabase.rpc("claim_scorm_import_job", {
    p_import_id: input.importId,
    p_lease_seconds: SCORM_JOB_LEASE_SECONDS,
    p_organization_id: input.organizationId,
    p_queued_step: input.queuedStep,
    p_running_step: input.runningStep,
    p_status: input.status,
  });
  if (error) throw new Error(`Failed to claim SCORM import: ${error.message}`);

  const claimed = Array.isArray(data) ? data[0] : data;
  return claimed ? claimed as TRecord : null;
}

export async function heartbeatScormImportJob(
  supabase: SupabaseClient,
  input: Omit<ScormJobClaimInput, "queuedStep">,
) {
  const { data, error } = await supabase.rpc("heartbeat_scorm_import_job", {
    p_import_id: input.importId,
    p_lease_seconds: SCORM_JOB_LEASE_SECONDS,
    p_organization_id: input.organizationId,
    p_running_step: input.runningStep,
    p_status: input.status,
  });
  if (error) throw new Error(`Failed to heartbeat SCORM import: ${error.message}`);
  if (data !== true) throw new Error("SCORM job lease is no longer owned by this worker");
}
