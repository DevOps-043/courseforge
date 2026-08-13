import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
  resolveProductionComponentContext,
} from "../jobs/production-jobs.service";
import {
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "../types/production.types";
import { HyperframesCloudClient } from "./hyperframes-cloud.client";
import { validateHyperframesPreflight } from "./hyperframes-preflight.service";
import {
  HYPERFRAMES_COMPOSITION_FORMAT,
  hyperframesAssetManifestSchema,
  hyperframesRevisionManifestSchema,
  type HyperframesAssetManifestItem,
} from "./hyperframes.types";

const PROJECT_ARCHIVE_BUCKET = "production-assets";

type StoredComposition = {
  active_revision_id: string | null;
  artifact_id: string;
  material_component_id: string | null;
  name: string;
  organization_id: string;
  status: string;
};

type StoredRevision = {
  composition_id: string;
  entry_point: string;
  format: string;
  id: string;
  manifest: unknown;
  project_archive_size_bytes: number;
  project_hash: string;
  project_storage_bucket: string;
  project_storage_path: string;
  variables_values: Record<string, unknown> | null;
  video_compositions: StoredComposition | StoredComposition[] | null;
};

type StoredRevisionAsset = {
  file_size_bytes: number;
  mime_type: string;
  production_asset_id: string;
  source_checksum: string;
  source_storage_path: string;
};

type ExistingRequest = {
  id: string;
  provider_asset_id: string | null;
  provider_render_id: string | null;
  provider_status: string;
};

export class HyperframesRenderSubmissionError extends Error {
  constructor(
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

export interface HyperframesRenderSubmissionInput {
  aspectRatio: "16:9" | "9:16" | "1:1";
  createdBy: string;
  format?: "mp4" | "webm" | "mov";
  fps?: number;
  organizationId: string;
  quality?: "draft" | "standard" | "high";
  resolution?: "1080p" | "4k";
  revisionId: string;
  title?: string;
}

export interface HyperframesRenderSubmissionResult {
  jobId: string;
  preflight: ReturnType<typeof validateHyperframesPreflight>;
  providerAssetId: string | null;
  providerRenderId: string | null;
  providerStatus: string;
  renderRequestId: string;
  reused: boolean;
}

/**
 * Creates a durable request before uploading to HeyGen. Retrying the same
 * revision/options reuses an idempotency key across the direct upload and the
 * render request, so a crash cannot create a second billable render.
 */
export class HyperframesRenderSubmissionService {
  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
    private readonly client: HyperframesCloudClient,
  ) {}

  async submit(input: HyperframesRenderSubmissionInput): Promise<HyperframesRenderSubmissionResult> {
    assertCompatibleRenderOptions(input);
    const revision = await this.getRevision(input);
    const context = await this.resolveComponentContext(revision, input.organizationId);
    const assets = await this.getRevisionAssets(revision.id);
    const manifest = parseAndVerifyManifest(revision.manifest, assets);
    const declaredPreflight = validateHyperframesPreflight({
      archiveSizeBytes: revision.project_archive_size_bytes,
      assets: manifest,
    });
    assertPassingPreflight(declaredPreflight);

    const jobInput = {
      aspect_ratio: input.aspectRatio,
      format: input.format || "mp4",
      fps: input.fps || 30,
      project_hash: revision.project_hash,
      quality: input.quality || "high",
      resolution: input.resolution || "1080p",
      revision_id: revision.id,
      variables: revision.variables_values || {},
    };
    const idempotencyKey = buildProductionIdempotencyKey({
      componentId: context.componentId,
      input: jobInput,
      jobType: PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER,
      provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
    });
    const job = await createOrReuseProductionJob(this.supabase, {
      context,
      createdBy: input.createdBy,
      idempotencyKey,
      inputSnapshot: jobInput,
      jobType: PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER,
      provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
      providerModel: HYPERFRAMES_COMPOSITION_FORMAT,
    });
    let request: ExistingRequest;
    try {
      request = await this.ensureRenderRequest({
        archiveSizeBytes: revision.project_archive_size_bytes,
        compositionRevisionId: revision.id,
        idempotencyKey,
        jobId: job.id,
        organizationId: input.organizationId,
      });
    } catch (error) {
      await this.markSubmissionFailed(job.id, null, error);
      throw error;
    }

    if (request.provider_render_id) {
      return {
        jobId: job.id,
        preflight: declaredPreflight,
        providerAssetId: request.provider_asset_id,
        providerRenderId: request.provider_render_id,
        providerStatus: request.provider_status,
        renderRequestId: request.id,
        reused: true,
      };
    }

    try {
      const archiveBytes = await this.downloadAndVerifyArchive(revision, manifest);
      const upload = await this.client.uploadProjectArchive({
        bytes: archiveBytes,
        fileName: `${revision.id}.zip`,
        idempotencyKey,
      });
      const render = await this.client.createRender({
        aspectRatio: input.aspectRatio,
        assetId: upload.assetId,
        composition: revision.entry_point,
        format: input.format || "mp4",
        fps: input.fps || 30,
        idempotencyKey,
        quality: input.quality || "high",
        resolution: input.resolution || "1080p",
        title: input.title || getComposition(revision)!.name,
        variables: revision.variables_values || {},
      });
      await this.markSubmitted({
        jobId: job.id,
        providerAssetId: upload.assetId,
        providerRenderId: render.render_id,
        requestId: request.id,
      });
      return {
        jobId: job.id,
        preflight: declaredPreflight,
        providerAssetId: upload.assetId,
        providerRenderId: render.render_id,
        providerStatus: "PENDING",
        renderRequestId: request.id,
        reused: false,
      };
    } catch (error) {
      await this.markSubmissionFailed(job.id, request.id, error);
      throw error;
    }
  }

  private async getRevision(input: HyperframesRenderSubmissionInput) {
    const { data, error } = await this.supabase
      .from("video_composition_revisions")
      .select(
        "id, composition_id, format, entry_point, project_storage_bucket, project_storage_path, project_archive_size_bytes, project_hash, variables_values, manifest, video_compositions!inner(organization_id, artifact_id, material_component_id, name, status, active_revision_id)",
      )
      .eq("id", input.revisionId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw new HyperframesRenderSubmissionError("Revisión de HyperFrames no encontrada para esta empresa.", 404);
    }
    const revision = data as StoredRevision;
    if (revision.format !== HYPERFRAMES_COMPOSITION_FORMAT) {
      throw new HyperframesRenderSubmissionError("La revisión no usa el formato interno de HyperFrames.");
    }
    const composition = getComposition(revision);
    if (!composition || composition.status !== "READY_FOR_RENDER" || composition.active_revision_id !== revision.id) {
      throw new HyperframesRenderSubmissionError(
        "Solo se puede renderizar la revisión activa aprobada para render.",
      );
    }
    if (revision.project_storage_bucket !== PROJECT_ARCHIVE_BUCKET) {
      throw new HyperframesRenderSubmissionError("El archivo de proyecto no está en el bucket interno permitido.");
    }
    return revision;
  }

  private async getRevisionAssets(revisionId: string) {
    const { data, error } = await this.supabase
      .from("video_composition_assets")
      .select("production_asset_id, source_checksum, source_storage_path, file_size_bytes, mime_type")
      .eq("composition_revision_id", revisionId);
    if (error) throw error;
    return (data || []) as StoredRevisionAsset[];
  }

  private async resolveComponentContext(revision: StoredRevision, organizationId: string) {
    const componentId = getComposition(revision)?.material_component_id;
    if (!componentId) {
      throw new HyperframesRenderSubmissionError("La composición no está asociada a un componente de material.");
    }
    const context = await resolveProductionComponentContext({
      componentId,
      supabase: this.supabase,
    });
    if (context.organizationId !== organizationId) {
      throw new HyperframesRenderSubmissionError("El componente no pertenece a la empresa de la composición.", 403);
    }
    return context;
  }

  private async ensureRenderRequest(params: {
    archiveSizeBytes: number;
    compositionRevisionId: string;
    idempotencyKey: string;
    jobId: string;
    organizationId: string;
  }): Promise<ExistingRequest> {
    const { data: existing, error: readError } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, provider_asset_id, provider_render_id, provider_status")
      .eq("production_job_id", params.jobId)
      .maybeSingle();
    if (readError) throw readError;
    if (existing) return existing as ExistingRequest;

    const { data, error } = await this.supabase
      .from("hyperframes_render_requests")
      .insert({
        archive_size_bytes: params.archiveSizeBytes,
        composition_revision_id: params.compositionRevisionId,
        idempotency_key: params.idempotencyKey,
        organization_id: params.organizationId,
        production_job_id: params.jobId,
        provider_status: "PENDING",
      })
      .select("id, provider_asset_id, provider_render_id, provider_status")
      .single();
    if (error) throw error;
    return data as ExistingRequest;
  }

  private async downloadAndVerifyArchive(
    revision: StoredRevision,
    assets: HyperframesAssetManifestItem[],
  ) {
    const { data, error } = await this.supabase.storage
      .from(revision.project_storage_bucket)
      .download(revision.project_storage_path);
    if (error) throw error;
    const archive = new Uint8Array(await data.arrayBuffer());
    const actualPreflight = validateHyperframesPreflight({
      archiveSizeBytes: archive.byteLength,
      assets,
    });
    assertPassingPreflight(actualPreflight);
    if (archive.byteLength !== revision.project_archive_size_bytes) {
      throw new HyperframesRenderSubmissionError("El tamaño del archivo de proyecto no coincide con la revisión aprobada.");
    }
    const actualHash = createHash("sha256").update(archive).digest("hex");
    if (actualHash !== revision.project_hash.toLowerCase()) {
      throw new HyperframesRenderSubmissionError("El hash del archivo de proyecto no coincide con la revisión aprobada.");
    }
    return archive;
  }

  private async markSubmitted(params: {
    jobId: string;
    providerAssetId: string;
    providerRenderId: string;
    requestId: string;
  }) {
    const now = new Date().toISOString();
    const { error: jobError } = await this.supabase
      .from("production_jobs")
      .update({
        output_snapshot: {
          provider_asset_id: params.providerAssetId,
          provider_render_id: params.providerRenderId,
          provider_status: "queued",
        },
        progress: [{ at: now, percent: 5, stage: "queued" }],
        provider_job_id: params.providerRenderId,
        started_at: now,
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        updated_at: now,
      })
      .eq("id", params.jobId);
    if (jobError) throw jobError;

    const { error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .update({
        provider_asset_id: params.providerAssetId,
        provider_render_id: params.providerRenderId,
        provider_status: "PENDING",
        updated_at: now,
      })
      .eq("id", params.requestId);
    if (requestError) throw requestError;
  }

  private async markSubmissionFailed(
    jobId: string,
    requestId: string | null,
    error: unknown,
  ) {
    const now = new Date().toISOString();
    const message = error instanceof Error ? error.message.slice(0, 500) : "No se pudo enviar el render a HyperFrames.";
    const { error: updateError } = await this.supabase
      .from("production_jobs")
      .update({
        failed_at: now,
        provider_error: { message, source: "hyperframes_submission" },
        status: PRODUCTION_JOB_STATUSES.FAILED,
        updated_at: now,
      })
      .eq("id", jobId);
    if (updateError) throw updateError;

    if (!requestId) return;
    const { error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .update({
        provider_error: { message, source: "hyperframes_submission" },
        provider_status: "FAILED",
        updated_at: now,
      })
      .eq("id", requestId);
    if (requestError) throw requestError;
  }
}

function assertCompatibleRenderOptions(input: HyperframesRenderSubmissionInput) {
  if (input.resolution === "4k" && (input.format === "webm" || input.format === "mov")) {
    throw new HyperframesRenderSubmissionError("4k solo está disponible para renders MP4.", 400);
  }
  if (input.fps !== undefined && (!Number.isInteger(input.fps) || input.fps < 1 || input.fps > 240)) {
    throw new HyperframesRenderSubmissionError("FPS debe ser un entero entre 1 y 240.", 400);
  }
}

function getComposition(revision: StoredRevision) {
  const relation = revision.video_compositions;
  return Array.isArray(relation) ? relation[0] || null : relation;
}

function parseAndVerifyManifest(rawManifest: unknown, rows: StoredRevisionAsset[]) {
  const parsedManifest = hyperframesRevisionManifestSchema.safeParse(rawManifest);
  if (!parsedManifest.success) {
    throw new HyperframesRenderSubmissionError("El manifiesto de assets de la revisión no es válido.");
  }
  const manifest = parsedManifest.data.asset_manifest;
  const expected = hyperframesAssetManifestSchema.parse(
    rows.map((row) => ({
      checksum: row.source_checksum,
      fileSizeBytes: row.file_size_bytes,
      mimeType: row.mime_type,
      productionAssetId: row.production_asset_id,
      storagePath: row.source_storage_path,
    })),
  );
  if (!sameManifest(manifest, expected)) {
    throw new HyperframesRenderSubmissionError(
      "El manifiesto no coincide con la trazabilidad de assets de la revisión.",
    );
  }
  return expected;
}

function sameManifest(
  manifest: HyperframesAssetManifestItem[],
  expected: HyperframesAssetManifestItem[],
) {
  if (manifest.length !== expected.length) return false;
  const byAssetId = new Map(manifest.map((asset) => [asset.productionAssetId, asset]));
  return expected.every((asset) => {
    const actual = byAssetId.get(asset.productionAssetId);
    return actual?.checksum.toLowerCase() === asset.checksum.toLowerCase()
      && actual.fileSizeBytes === asset.fileSizeBytes
      && actual.mimeType.toLowerCase() === asset.mimeType.toLowerCase()
      && actual.storagePath === asset.storagePath;
  });
}

function assertPassingPreflight(result: ReturnType<typeof validateHyperframesPreflight>) {
  if (result.valid) return;
  throw new HyperframesRenderSubmissionError(result.errors.join(" "), 400);
}
