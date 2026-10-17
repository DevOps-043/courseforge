import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionConformanceContractSchema } from "../composition-editor/composition-preview-render-conformance";

type RenderRequest = {
  id: string;
  organization_id: string;
  production_job_id: string;
  composition_revision_id: string;
  provider_render_id: string | null;
  provider_status: string;
  import_status: string;
};
type RenderJob = {
  id: string;
  organization_id: string;
  status: string;
  input_snapshot: Record<string, unknown> | null;
  output_snapshot: Record<string, unknown> | null;
};
type RenderRevision = {
  id: string;
  organization_id: string;
  project_hash: string;
  manifest: Record<string, unknown> | null;
};
type FinalVideoAsset = {
  id: string;
  organization_id: string;
  production_job_id: string;
  provider: string;
  asset_type: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  metadata: Record<string, unknown> | null;
  storage_bucket: string | null;
  storage_path: string | null;
  checksum: string | null;
};

export type HyperframesRenderEvidence = {
  assetId: string | null;
  documentHash: string | null;
  failures: string[];
  finalVideoSha256: string | null;
  jobId: string;
  projectHash: string | null;
  providerRenderId: string | null;
  renderRequestId: string;
  revisionId: string;
  status: "LINEAGE_VERIFIED" | "INCOMPLETE";
};

/** Checks persisted lineage only. The TUS import does not yet attest video bytes. */
export function assessHyperframesRenderEvidence(input: {
  asset: FinalVideoAsset | null;
  job: RenderJob | null;
  organizationId: string;
  request: RenderRequest;
  revision: RenderRevision | null;
}): HyperframesRenderEvidence {
  const { asset, job, organizationId, request, revision } = input;
  const failures: string[] = [];
  const contract = compositionConformanceContractSchema.safeParse(revision?.manifest?.conformance_contract);
  if (request.organization_id !== organizationId) failures.push("request_tenant_mismatch");
  if (request.provider_status !== "COMPLETED" || request.import_status !== "COMPLETED") failures.push("render_not_completed");
  if (!request.provider_render_id) failures.push("provider_render_id_missing");
  if (!job || job.id !== request.production_job_id || job.organization_id !== organizationId || job.status !== "SUCCEEDED") {
    failures.push("job_mismatch");
  }
  if (!revision || revision.id !== request.composition_revision_id || revision.organization_id !== organizationId || !contract.success) {
    failures.push("revision_contract_mismatch");
  }
  if (revision && contract.success && revision.manifest?.draft_document_hash !== contract.data.documentHash) {
    failures.push("document_hash_mismatch");
  }
  if (revision && job && (job.input_snapshot?.revision_id !== revision.id || job.input_snapshot?.project_hash !== revision.project_hash)) {
    failures.push("job_revision_mismatch");
  }
  const expectedVideoPath = `production-videos/organizations/${organizationId}/artifacts/`;
  const expectedRenderSuffix = `/renders/${request.id}/final.mp4`;
  if (!asset || !job || asset.production_job_id !== job.id || asset.organization_id !== organizationId
    || asset.provider !== "hyperframes" || asset.asset_type !== "FINAL_VIDEO"
    || asset.metadata?.render_request_id !== request.id || asset.metadata?.provider_render_id !== request.provider_render_id
    || (job.output_snapshot?.final_video as Record<string, unknown> | undefined)?.asset_id !== asset.id
    || asset.storage_bucket !== "production-videos" || !asset.storage_path?.startsWith(expectedVideoPath)
    || !asset.storage_path.endsWith(expectedRenderSuffix)
    || asset.mime_type !== "video/mp4" || !asset.file_size_bytes || asset.file_size_bytes <= 0) {
    failures.push("final_asset_mismatch");
  }
  const hasVerifiedChecksum = Boolean(asset?.checksum && /^[a-f0-9]{64}$/.test(asset.checksum)
    && asset.metadata?.integrity_method === "storage-stream-sha256-v1");
  if (!hasVerifiedChecksum) {
    failures.push("final_video_checksum_missing");
  }
  return {
    assetId: asset?.id ?? null,
    documentHash: contract.success ? contract.data.documentHash : null,
    failures,
    finalVideoSha256: hasVerifiedChecksum ? asset!.checksum : null,
    jobId: request.production_job_id,
    projectHash: revision?.project_hash ?? null,
    providerRenderId: request.provider_render_id,
    renderRequestId: request.id,
    revisionId: request.composition_revision_id,
    status: failures.length === 0 ? "LINEAGE_VERIFIED" : "INCOMPLETE",
  };
}

export class HyperframesRenderEvidenceService {
  constructor(private readonly supabase: SupabaseClient<any, "public", any>) {}

  async read(organizationId: string, requestId: string): Promise<HyperframesRenderEvidence | null> {
    const { data: request, error: requestError } = await this.supabase.from("hyperframes_render_requests")
      .select("id, organization_id, production_job_id, composition_revision_id, provider_render_id, provider_status, import_status")
      .eq("id", requestId).eq("organization_id", organizationId).maybeSingle();
    if (requestError) throw requestError;
    if (!request) return null;
    const [jobResult, revisionResult, assetResult] = await Promise.all([
      this.supabase.from("production_jobs")
        .select("id, organization_id, status, input_snapshot, output_snapshot")
        .eq("id", request.production_job_id).eq("organization_id", organizationId).maybeSingle(),
      this.supabase.from("video_composition_revisions")
        .select("id, organization_id, project_hash, manifest")
        .eq("id", request.composition_revision_id).eq("organization_id", organizationId).maybeSingle(),
      this.supabase.from("production_assets")
        .select("id, organization_id, production_job_id, provider, asset_type, file_size_bytes, mime_type, metadata, storage_bucket, storage_path, checksum")
        .eq("production_job_id", request.production_job_id).eq("organization_id", organizationId)
        .eq("asset_type", "FINAL_VIDEO").maybeSingle(),
    ]);
    for (const result of [jobResult, revisionResult, assetResult]) if (result.error) throw result.error;
    return assessHyperframesRenderEvidence({
      asset: assetResult.data as FinalVideoAsset | null,
      job: jobResult.data as RenderJob | null,
      organizationId,
      request: request as RenderRequest,
      revision: revisionResult.data as RenderRevision | null,
    });
  }
}
