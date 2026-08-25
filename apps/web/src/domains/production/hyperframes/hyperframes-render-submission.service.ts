import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
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
import { resolveHyperframesAssetVariables } from "./hyperframes-asset-delivery.service";
import { validateHyperframesPreflight } from "./hyperframes-preflight.service";
import {
  HYPERFRAMES_ASSET_DELIVERY_MODES,
  HYPERFRAMES_COMPOSITION_FORMAT,
  hyperframesAssetManifestSchema,
  hyperframesRevisionManifestSchema,
  type HyperframesAssetManifestItem,
  type HyperframesAssetDeliveryMode,
} from "./hyperframes.types";
import { HYPERFRAMES_DURABLE_RENDER_PROFILE } from "./hyperframes-media-constraints";
import type { HyperframesRenderSettings } from "./hyperframes-render-profiles";
import { resolveHyperframesSnapshotRenderProfile } from "./hyperframes-request-validation";

const PROJECT_ARCHIVE_BUCKET = "production-assets";

/**
 * Both composition_id and active_revision_id connect these tables. PostgREST
 * therefore requires the intended FK name; a bare `video_compositions!inner`
 * fails with PGRST201 before a production job can be created.
 */
export const HYPERFRAMES_RENDER_REVISION_SELECT =
  "id, composition_id, format, entry_point, project_storage_bucket, project_storage_path, project_archive_size_bytes, project_hash, variables_values, manifest, video_compositions!video_composition_revisions_composition_id_fkey(organization_id, artifact_id, material_component_id, name, status, active_revision_id)";

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
  callback_id: string;
  id: string;
  provider_asset_id: string | null;
  provider_render_id: string | null;
  provider_status: string;
};

type ActiveRender = {
  jobId: string;
  request: ExistingRequest | null;
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
  attemptId?: string;
  createdBy: string;
  deferProcessing?: boolean;
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
 * Creates a durable request before uploading to HeyGen. Repeating a request
 * while it is active reuses its idempotency key, while a terminal failure gets
 * a fresh attempt key so it can be retried against the same snapshot.
 */
export class HyperframesRenderSubmissionService {
  constructor(
    private readonly supabase: SupabaseClient<any, "public", any>,
    private readonly client?: HyperframesCloudClient,
  ) {}

  async submit(input: HyperframesRenderSubmissionInput): Promise<HyperframesRenderSubmissionResult> {
    assertCompatibleRenderOptions(input);
    const revision = await this.getRevision(input);
    const context = await this.resolveComponentContext(revision, input.organizationId);
    const assets = await this.getRevisionAssets(revision.id);
    const revisionContract = parseAndVerifyManifest(revision.manifest, assets);
    const manifest = revisionContract.assets;
    const effectiveInput = applyRevisionRenderProfile(input, revisionContract.renderProfile);
    const declaredPreflight = validateHyperframesPreflight({
      archiveSizeBytes: revision.project_archive_size_bytes,
      assets: manifest,
      deliveryMode: revisionContract.deliveryMode,
    });
    assertPassingPreflight(declaredPreflight);

    const activeRender = await this.findActiveRender({
      componentId: context.componentId,
      organizationId: input.organizationId,
    });
    if (activeRender) {
      if (!activeRender.request) {
        throw new HyperframesRenderSubmissionError(
          "Este video ya tiene un render iniciándose. Espera unos segundos y actualiza el estado.",
        );
      }
      return {
        jobId: activeRender.jobId,
        preflight: declaredPreflight,
        providerAssetId: activeRender.request.provider_asset_id,
        providerRenderId: activeRender.request.provider_render_id,
        providerStatus: activeRender.request.provider_status,
        renderRequestId: activeRender.request.id,
        reused: true,
      };
    }

    const baseJobInput = {
      aspect_ratio: effectiveInput.aspectRatio,
      format: effectiveInput.format || "mp4",
      fps: effectiveInput.fps || HYPERFRAMES_DURABLE_RENDER_PROFILE.fps,
      project_hash: revision.project_hash,
      quality: effectiveInput.quality || HYPERFRAMES_DURABLE_RENDER_PROFILE.quality,
      resolution: effectiveInput.resolution || "1080p",
      revision_id: revision.id,
      asset_delivery_mode: revisionContract.deliveryMode,
      variables: revision.variables_values || {},
    };
    const baseIdempotencyKey = buildProductionIdempotencyKey({
      componentId: context.componentId,
      input: baseJobInput,
      jobType: PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER,
      provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
    });
    const attemptId = input.attemptId || (
      await this.hasFailedAttempt({
        idempotencyKey: baseIdempotencyKey,
        organizationId: input.organizationId,
      })
        ? randomUUID()
        : undefined
    );
    const jobInput = attemptId
      ? { ...baseJobInput, attempt_id: attemptId }
      : baseJobInput;
    const idempotencyKey = attemptId
      ? buildProductionIdempotencyKey({
          componentId: context.componentId,
          input: jobInput,
          jobType: PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER,
          provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
        })
      : baseIdempotencyKey;
    let job: Awaited<ReturnType<typeof createOrReuseProductionJob>>;
    try {
      job = await createOrReuseProductionJob(this.supabase, {
        context,
        createdBy: input.createdBy,
        idempotencyKey,
        inputSnapshot: jobInput,
        jobType: PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER,
        provider: PRODUCTION_PROVIDERS.HYPERFRAMES,
        providerModel: HYPERFRAMES_COMPOSITION_FORMAT,
      });
    } catch (error) {
      // The database trigger is the final guard for two users submitting in
      // the same instant. Return the winner instead of surfacing a generic 500.
      const concurrentRender = await this.findActiveRender({
        componentId: context.componentId,
        organizationId: input.organizationId,
      });
      if (concurrentRender?.request) {
        return {
          jobId: concurrentRender.jobId,
          preflight: declaredPreflight,
          providerAssetId: concurrentRender.request.provider_asset_id,
          providerRenderId: concurrentRender.request.provider_render_id,
          providerStatus: concurrentRender.request.provider_status,
          renderRequestId: concurrentRender.request.id,
          reused: true,
        };
      }
      if (concurrentRender) {
        throw new HyperframesRenderSubmissionError(
          "Este video ya tiene un render iniciándose. Espera unos segundos y actualiza el estado.",
        );
      }
      throw error;
    }
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

    if (input.deferProcessing) {
      const providerStatus = request.provider_asset_id ? "SUBMITTING" : "UPLOADING";
      const claimed = await this.claimBackgroundDispatch({
        expectedStatus: request.provider_status,
        jobId: job.id,
        providerStatus,
        requestId: request.id,
      });
      return {
        jobId: job.id,
        preflight: declaredPreflight,
        providerAssetId: request.provider_asset_id,
        providerRenderId: null,
        providerStatus,
        renderRequestId: request.id,
        reused: !claimed,
      };
    }

    return this.processSubmission({
      input: effectiveInput,
      jobId: job.id,
      idempotencyKey,
      manifest,
      deliveryMode: revisionContract.deliveryMode,
      request,
      revision,
      preflight: declaredPreflight,
    });
  }

  async resume(params: { organizationId: string; requestId: string }) {
    const { data: storedRequest, error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, organization_id, production_job_id, composition_revision_id, idempotency_key, callback_id, provider_asset_id, provider_render_id, provider_status")
      .eq("id", params.requestId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (requestError) throw requestError;
    if (!storedRequest) {
      throw new HyperframesRenderSubmissionError("Solicitud de render no encontrada.", 404);
    }

    const request = storedRequest as ExistingRequest & {
      composition_revision_id: string;
      idempotency_key: string;
      production_job_id: string;
    };
    if (request.provider_render_id) return;

    const { data: storedJob, error: jobError } = await this.supabase
      .from("production_jobs")
      .select("id, created_by, input_snapshot")
      .eq("id", request.production_job_id)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!storedJob) throw new HyperframesRenderSubmissionError("Job de render no encontrado.", 404);

    const options = parseStoredRenderOptions(storedJob.input_snapshot);
    const input: HyperframesRenderSubmissionInput = {
      ...options,
      createdBy: String(storedJob.created_by || ""),
      organizationId: params.organizationId,
      revisionId: request.composition_revision_id,
    };
    const revision = await this.getRevision(input, false);
    const assets = await this.getRevisionAssets(revision.id);
    const revisionContract = parseAndVerifyManifest(revision.manifest, assets);
    const manifest = revisionContract.assets;
    const effectiveInput = applyRevisionRenderProfile(input, revisionContract.renderProfile);
    const preflight = validateHyperframesPreflight({
      archiveSizeBytes: revision.project_archive_size_bytes,
      assets: manifest,
      deliveryMode: revisionContract.deliveryMode,
    });
    assertPassingPreflight(preflight);

    await this.processSubmission({
      input: effectiveInput,
      idempotencyKey: request.idempotency_key,
      jobId: request.production_job_id,
      manifest,
      deliveryMode: revisionContract.deliveryMode,
      preflight,
      request,
      revision,
    });
  }

  async failDispatch(params: { error: unknown; organizationId: string; requestId: string }) {
    const { data, error } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, production_job_id")
      .eq("id", params.requestId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (data) await this.markSubmissionFailed(data.production_job_id, data.id, params.error);
  }

  private async processSubmission(params: {
    deliveryMode: HyperframesAssetDeliveryMode;
    input: HyperframesRenderSubmissionInput;
    idempotencyKey: string;
    jobId: string;
    manifest: HyperframesAssetManifestItem[];
    preflight: ReturnType<typeof validateHyperframesPreflight>;
    request: ExistingRequest;
    revision: StoredRevision;
  }): Promise<HyperframesRenderSubmissionResult> {
    const { deliveryMode, input, idempotencyKey, jobId, manifest, preflight, request, revision } = params;
    const client = this.client;
    if (!client) {
      throw new HyperframesRenderSubmissionError("El worker de render no tiene un cliente de HeyGen configurado.", 500);
    }

    try {
      let providerAssetId = request.provider_asset_id;
      if (!providerAssetId) {
        await this.markUploading(jobId, request.id);
        const archiveBytes = await this.downloadAndVerifyArchive(revision, manifest, deliveryMode);
        const upload = await client.uploadProjectArchive({
          bytes: archiveBytes,
          fileName: `${revision.id}.zip`,
          idempotencyKey,
        });
        providerAssetId = upload.assetId;
        await this.markProjectUploaded({
          jobId,
          providerAssetId,
          requestId: request.id,
        });
      }
      const remoteAssetVariables = deliveryMode === HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES
        ? resolveHyperframesAssetVariables({ assets: manifest, supabase: this.supabase })
        : {};
      const render = await client.createRender({
        aspectRatio: input.aspectRatio,
        assetId: providerAssetId,
        callbackId: request.callback_id,
        callbackUrl: await this.getWebhookCallbackUrl(input.organizationId),
        composition: revision.entry_point,
        format: input.format || "mp4",
        fps: input.fps || HYPERFRAMES_DURABLE_RENDER_PROFILE.fps,
        idempotencyKey,
        quality: input.quality || HYPERFRAMES_DURABLE_RENDER_PROFILE.quality,
        resolution: input.resolution || "1080p",
        title: input.title || getComposition(revision)!.name,
        variables: { ...(revision.variables_values || {}), ...remoteAssetVariables },
      });
      await this.markSubmitted({
        jobId,
        providerAssetId,
        providerRenderId: render.render_id,
        requestId: request.id,
      });
      return {
        jobId,
        preflight,
        providerAssetId,
        providerRenderId: render.render_id,
        providerStatus: "PENDING",
        renderRequestId: request.id,
        reused: false,
      };
    } catch (error) {
      await this.markSubmissionFailed(jobId, request.id, error);
      throw error;
    }
  }

  private async findActiveRender(params: {
    componentId: string;
    organizationId: string;
  }): Promise<ActiveRender | null> {
    const { data: job, error: jobError } = await this.supabase
      .from("production_jobs")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("job_type", PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .in("status", [
        PRODUCTION_JOB_STATUSES.PENDING,
        PRODUCTION_JOB_STATUSES.RUNNING,
        PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        PRODUCTION_JOB_STATUSES.RETRY_SCHEDULED,
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (jobError) throw jobError;
    if (!job?.id) return null;

    const { data: request, error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .select("id, callback_id, provider_asset_id, provider_render_id, provider_status")
      .eq("organization_id", params.organizationId)
      .eq("production_job_id", job.id)
      .maybeSingle();
    if (requestError) throw requestError;
    return { jobId: job.id as string, request: request as ExistingRequest | null };
  }

  private async hasFailedAttempt(params: {
    idempotencyKey: string;
    organizationId: string;
  }) {
    const { data, error } = await this.supabase
      .from("production_jobs")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("idempotency_key", params.idempotencyKey)
      .eq("job_type", PRODUCTION_JOB_TYPES.HYPERFRAMES_RENDER)
      .eq("provider", PRODUCTION_PROVIDERS.HYPERFRAMES)
      .eq("status", PRODUCTION_JOB_STATUSES.FAILED)
      .maybeSingle();
    if (error) throw error;
    return Boolean(data?.id);
  }

  private async getRevision(input: HyperframesRenderSubmissionInput, requireActive = true) {
    const { data, error } = await this.supabase
      .from("video_composition_revisions")
      .select(HYPERFRAMES_RENDER_REVISION_SELECT)
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
    if (!composition || (requireActive && (
      composition.status !== "READY_FOR_RENDER"
      || composition.active_revision_id !== revision.id
    ))) {
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
      .select("id, callback_id, provider_asset_id, provider_render_id, provider_status")
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
        provider_status: "CREATED",
      })
      .select("id, callback_id, provider_asset_id, provider_render_id, provider_status")
      .single();
    if (error) throw error;
    return data as ExistingRequest;
  }

  private async claimBackgroundDispatch(params: {
    expectedStatus: string;
    jobId: string;
    providerStatus: "SUBMITTING" | "UPLOADING";
    requestId: string;
  }) {
    const now = new Date().toISOString();
    const { data: claimed, error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .update({
        provider_error: null,
        provider_status: params.providerStatus,
        updated_at: now,
      })
      .eq("id", params.requestId)
      .eq("provider_status", params.expectedStatus)
      .select("id")
      .maybeSingle();
    if (requestError) throw requestError;
    if (!claimed) return false;

    const { error: jobError } = await this.supabase
      .from("production_jobs")
      .update({
        failed_at: null,
        progress: [{ at: now, percent: 0, stage: "queued" }],
        provider_error: null,
        status: PRODUCTION_JOB_STATUSES.PENDING,
        updated_at: now,
      })
      .eq("id", params.jobId);
    if (jobError) throw jobError;
    return true;
  }

  private async getWebhookCallbackUrl(organizationId: string): Promise<string | undefined> {
    const { data, error } = await this.supabase
      .from("hyperframes_workspace_connections")
      .select("default_callback_url")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    const callbackUrl = typeof data?.default_callback_url === "string"
      ? data.default_callback_url.trim()
      : "";
    return callbackUrl || undefined;
  }

  private async markUploading(jobId: string, requestId: string) {
    const now = new Date().toISOString();
    const { error: jobError } = await this.supabase
      .from("production_jobs")
      .update({
        progress: [{ at: now, percent: 1, stage: "uploading" }],
        started_at: now,
        status: PRODUCTION_JOB_STATUSES.RUNNING,
        updated_at: now,
      })
      .eq("id", jobId);
    if (jobError) throw jobError;

    const { error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .update({ provider_status: "UPLOADING", updated_at: now })
      .eq("id", requestId);
    if (requestError) throw requestError;
  }

  private async markProjectUploaded(params: {
    jobId: string;
    providerAssetId: string;
    requestId: string;
  }) {
    const now = new Date().toISOString();
    const { error: jobError } = await this.supabase
      .from("production_jobs")
      .update({
        output_snapshot: {
          provider_asset_id: params.providerAssetId,
          provider_status: "submitting",
        },
        progress: [{ at: now, percent: 3, stage: "submitting" }],
        status: PRODUCTION_JOB_STATUSES.RUNNING,
        updated_at: now,
      })
      .eq("id", params.jobId);
    if (jobError) throw jobError;

    const { error: requestError } = await this.supabase
      .from("hyperframes_render_requests")
      .update({
        provider_asset_id: params.providerAssetId,
        provider_status: "SUBMITTING",
        updated_at: now,
      })
      .eq("id", params.requestId);
    if (requestError) throw requestError;
  }

  private async downloadAndVerifyArchive(
    revision: StoredRevision,
    assets: HyperframesAssetManifestItem[],
    deliveryMode: HyperframesAssetDeliveryMode,
  ) {
    const { data, error } = await this.supabase.storage
      .from(revision.project_storage_bucket)
      .download(revision.project_storage_path);
    if (error) throw error;
    const archive = new Uint8Array(await data.arrayBuffer());
    const actualPreflight = validateHyperframesPreflight({
      archiveSizeBytes: archive.byteLength,
      assets,
      deliveryMode,
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
    const message = getErrorMessage(error, "No se pudo enviar el render a HyperFrames.").slice(0, 500);
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

function parseStoredRenderOptions(value: unknown): Pick<
  HyperframesRenderSubmissionInput,
  "aspectRatio" | "format" | "fps" | "quality" | "resolution"
> {
  const input = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const aspectRatio = input.aspect_ratio;
  const format = input.format;
  const quality = input.quality;
  const resolution = input.resolution;
  const fps = input.fps;
  if (!(["16:9", "9:16", "1:1"] as unknown[]).includes(aspectRatio)
    || !(["mp4", "webm", "mov"] as unknown[]).includes(format)
    || !(["draft", "standard", "high"] as unknown[]).includes(quality)
    || !(["1080p", "4k"] as unknown[]).includes(resolution)
    || !Number.isInteger(fps)) {
    throw new HyperframesRenderSubmissionError("El snapshot de opciones del render no es válido.", 500);
  }
  return {
    aspectRatio: aspectRatio as "16:9" | "9:16" | "1:1",
    format: format as "mp4" | "webm" | "mov",
    fps: fps as number,
    quality: quality as "draft" | "standard" | "high",
    resolution: resolution as "1080p" | "4k",
  };
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
  if (!parsedManifest.data.render_profile) {
    throw new HyperframesRenderSubmissionError(
      "Este snapshot usa un perfil de render anterior. Regenera el snapshot antes de enviarlo a HeyGen.",
      409,
    );
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
  return {
    assets: manifest,
    deliveryMode: parsedManifest.data.asset_delivery_mode || HYPERFRAMES_ASSET_DELIVERY_MODES.EMBEDDED,
    renderProfile: parsedManifest.data.render_profile,
  };
}

export function applyRevisionRenderProfile(
  input: HyperframesRenderSubmissionInput,
  renderProfile: HyperframesRenderSettings | undefined,
) {
  const resolved = resolveHyperframesSnapshotRenderProfile(input, renderProfile);
  if (!resolved.success) {
    throw new HyperframesRenderSubmissionError(resolved.message, 409);
  }
  return { ...input, ...resolved.data };
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
