import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
  resolveProductionComponentContext,
} from "../../jobs/production-jobs.service";
import {
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  type ProductionJobStatus,
} from "../../types/production.types";
import { HeygenClient } from "./heygen.client";
import { HeygenRepository } from "./heygen.repository";
import { buildHeygenScriptFromComponent } from "./heygen-script-builder";
import {
  HEYGEN_VIDEO_STATUSES,
  type HeygenAvatarVideoGenerationOptions,
  type HeygenAvatarVideoOutputFormat,
  type HeygenCreateVideoRequest,
  type HeygenSupabaseClient,
  type HeygenVideoDetails,
} from "./heygen.types";
import { HeygenVideoImportService } from "./heygen-video-import.service";

export class HeygenVideoServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HeygenVideoServiceError";
    this.status = status;
  }
}

export interface HeygenCreateAvatarVideoResult {
  jobId: string;
  providerJobId: string | null;
  script: {
    durationEstimateSeconds: number;
    hash: string;
    sectionCount: number;
    title: string;
  };
  status: ProductionJobStatus;
}

export interface HeygenAvatarVideoJobStatusResult {
  asset: {
    id: string;
    publicUrl: string;
    storagePath: string;
  } | null;
  jobId: string;
  providerJobId: string | null;
  providerStatus?: string | null;
  status: string;
}

export class HeygenVideoService {
  private readonly client: HeygenClient;
  private readonly importService: HeygenVideoImportService;
  private readonly repository: HeygenRepository;

  constructor(
    private readonly supabase: HeygenSupabaseClient,
    client?: HeygenClient,
  ) {
    this.client = client || new HeygenClient();
    this.importService = new HeygenVideoImportService(supabase);
    this.repository = new HeygenRepository(supabase);
  }

  async createAvatarVideoForComponent(params: {
    componentContent: unknown;
    componentType: string;
    createdBy: string;
    fallbackTitle?: string | null;
    options: HeygenAvatarVideoGenerationOptions;
    organizationId: string;
  }): Promise<HeygenCreateAvatarVideoResult> {
    const context = await resolveProductionComponentContext({
      componentId: params.options.componentId,
      supabase: this.supabase,
    });

    if (context.organizationId !== params.organizationId) {
      throw new HeygenVideoServiceError(
        "El componente no pertenece a la empresa activa.",
        403,
      );
    }

    const script = buildHeygenScriptFromComponent({
      componentContent: params.componentContent,
      componentType: params.componentType,
      fallbackTitle: params.fallbackTitle,
    });
    const avatar = await this.repository.getAvatarPresetForGeneration({
      organizationId: params.organizationId,
      presetId: params.options.avatarPresetId,
    });

    if (!avatar) {
      throw new HeygenVideoServiceError(
        params.options.avatarPresetId
          ? "No se encontro el avatar de HeyGen solicitado."
          : "No hay un avatar default de HeyGen configurado para esta empresa.",
        404,
      );
    }

    if (
      !avatarSupportsEngine(avatar.supported_api_engines, params.options.engine)
    ) {
      throw new HeygenVideoServiceError(
        "El avatar seleccionado no soporta el engine solicitado.",
        409,
      );
    }

    const voice = await this.repository.getVoicePresetForGeneration({
      organizationId: params.organizationId,
      presetId: params.options.voicePresetId,
    });
    const providerVoiceId = voice?.heygen_voice_id || avatar.default_voice_id;
    if (!providerVoiceId) {
      throw new HeygenVideoServiceError(
        "No hay una voz de HeyGen disponible para el avatar seleccionado.",
        409,
      );
    }

    const jobInput = buildAvatarVideoJobInputSnapshot({
      avatarPresetId: avatar.id,
      componentId: context.componentId,
      componentType: context.componentType,
      engine: params.options.engine,
      outputFormat: params.options.outputFormat,
      scriptHash: script.scriptHash,
      voicePresetId: voice?.id || null,
      voiceProviderId: providerVoiceId,
    });
    const job = await createOrReuseProductionJob(this.supabase, {
      context,
      createdBy: params.createdBy,
      idempotencyKey: buildProductionIdempotencyKey({
        componentId: context.componentId,
        input: jobInput,
        jobType: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
      }),
      inputSnapshot: jobInput,
      jobType: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO,
      provider: PRODUCTION_PROVIDERS.HEYGEN,
      providerModel: params.options.engine,
    });

    if (job.status !== PRODUCTION_JOB_STATUSES.PENDING) {
      return {
        jobId: job.id,
        providerJobId:
          job.provider_job_id || readProviderJobId(job.output_snapshot),
        script: buildScriptSummary(script),
        status: job.status,
      };
    }

    const requestPayload = buildHeygenCreateVideoPayload({
      avatarId: avatar.heygen_avatar_look_id,
      providerVoiceId,
      options: params.options,
      scriptText: script.scriptText,
      title: script.title,
    });
    const createdVideo = await this.client.createAvatarVideo(
      requestPayload,
      job.id,
    );

    await this.repository.markVideoJobWaitingProvider({
      jobId: job.id,
      outputFormat: createdVideo.outputFormat || params.options.outputFormat,
      providerJobId: createdVideo.videoId,
      providerStatus: createdVideo.providerStatus || null,
      requestSnapshot: {
        aspect_ratio: requestPayload.aspect_ratio,
        avatar_preset_id: avatar.id,
        caption_enabled: params.options.caption,
        engine: params.options.engine,
        output_format: requestPayload.output_format,
        resolution: requestPayload.resolution,
        script_hash: script.scriptHash,
        title: requestPayload.title,
        voice_preset_id: voice?.id || null,
      },
    });

    return {
      jobId: job.id,
      providerJobId: createdVideo.videoId,
      script: buildScriptSummary(script),
      status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
    };
  }

  async getAvatarVideoJobStatus(params: {
    autoPromote?: boolean;
    createdBy?: string | null;
    jobId: string;
    organizationId: string;
  }): Promise<HeygenAvatarVideoJobStatusResult> {
    const job = await this.repository.getProductionJob({
      jobId: params.jobId,
      organizationId: params.organizationId,
    });

    if (!job) {
      throw new HeygenVideoServiceError("Job de HeyGen no encontrado.", 404);
    }

    const existingAsset = await this.repository.findAvatarVideoAssetByJob(job.id);
    if (job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED) {
      return {
        asset: existingAsset
          ? {
              id: existingAsset.id,
              publicUrl: existingAsset.public_url || "",
              storagePath: existingAsset.storage_path || "",
            }
          : null,
        jobId: job.id,
        providerJobId: job.provider_job_id || null,
        status: job.status,
      };
    }

    if (job.status === PRODUCTION_JOB_STATUSES.FAILED) {
      return {
        asset: null,
        jobId: job.id,
        providerJobId: job.provider_job_id || null,
        status: job.status,
      };
    }

    if (!job.provider_job_id) {
      return {
        asset: null,
        jobId: job.id,
        providerJobId: null,
        status: job.status,
      };
    }

    const video = await this.client.getVideo(job.provider_job_id);
    const providerStatus = video.status.toLowerCase();

    if (providerStatus === HEYGEN_VIDEO_STATUSES.FAILED) {
      await this.repository.markVideoJobFailed({
        errorPayload: buildProviderFailurePayload(video),
        jobId: job.id,
      });

      return {
        asset: null,
        jobId: job.id,
        providerJobId: job.provider_job_id,
        providerStatus: video.status,
        status: PRODUCTION_JOB_STATUSES.FAILED,
      };
    }

    if (providerStatus !== HEYGEN_VIDEO_STATUSES.COMPLETED) {
      return {
        asset: null,
        jobId: job.id,
        providerJobId: job.provider_job_id,
        providerStatus: video.status,
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
      };
    }

    const imported = await this.importService.importCompletedVideo({
      autoPromote: Boolean(params.autoPromote),
      createdBy: params.createdBy || null,
      job,
      video,
    });

    await this.repository.markVideoJobSucceeded({
      durationSeconds: video.durationSeconds || null,
      jobId: job.id,
      outputSnapshot: buildCompletedOutputSnapshot(video, imported.asset),
    });

    return {
      asset: imported.asset,
      jobId: job.id,
      providerJobId: job.provider_job_id,
      providerStatus: video.status,
      status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
    };
  }
}

function avatarSupportsEngine(
  supportedEngines: string[] | null | undefined,
  requestedEngine: string,
) {
  if (!supportedEngines || supportedEngines.length === 0) {
    return true;
  }

  return supportedEngines.includes(requestedEngine);
}

function buildHeygenCreateVideoPayload(params: {
  avatarId: string;
  options: HeygenAvatarVideoGenerationOptions;
  providerVoiceId: string;
  scriptText: string;
  title: string;
}): HeygenCreateVideoRequest {
  return {
    aspect_ratio: params.options.aspectRatio,
    avatar_id: params.avatarId,
    background: params.options.background,
    callback_id: params.options.componentId,
    caption: params.options.caption
      ? { file_format: "srt", style: "default" }
      : undefined,
    engine: { type: params.options.engine },
    output_format: params.options.outputFormat,
    resolution: params.options.resolution,
    script: params.scriptText,
    title: params.title,
    type: "avatar",
    voice_id: params.providerVoiceId,
  };
}

function buildAvatarVideoJobInputSnapshot(params: {
  avatarPresetId: string;
  componentId: string;
  componentType: string;
  engine: string;
  outputFormat: HeygenAvatarVideoOutputFormat;
  scriptHash: string;
  voicePresetId: string | null;
  voiceProviderId: string;
}) {
  return {
    avatar_preset_id: params.avatarPresetId,
    component_id: params.componentId,
    component_type: params.componentType,
    engine: params.engine,
    job_type: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO,
    output_format: params.outputFormat,
    script_hash: params.scriptHash,
    voice_preset_id: params.voicePresetId,
    voice_provider_id: params.voiceProviderId,
  };
}

function buildScriptSummary(script: {
  durationEstimateSeconds: number;
  scriptHash: string;
  sectionCount: number;
  title: string;
}) {
  return {
    durationEstimateSeconds: script.durationEstimateSeconds,
    hash: script.scriptHash,
    sectionCount: script.sectionCount,
    title: script.title,
  };
}

function buildProviderFailurePayload(video: HeygenVideoDetails) {
  return {
    code: video.failureCode || null,
    message:
      video.failureMessage || "HeyGen reporto la generacion como fallida.",
    provider_status: video.status,
    provider_video_id: video.videoId,
  };
}

function buildCompletedOutputSnapshot(
  video: HeygenVideoDetails,
  asset: { id: string; publicUrl: string; storagePath: string },
) {
  return {
    asset_id: asset.id,
    asset_type: "AVATAR_VIDEO",
    duration_seconds: video.durationSeconds || null,
    output_format: video.outputFormat || null,
    provider_status: video.status,
    provider_video_id: video.videoId,
    public_url: asset.publicUrl,
    storage_path: asset.storagePath,
    thumbnail_url: video.thumbnailUrl || null,
  };
}

function readProviderJobId(
  outputSnapshot: Record<string, unknown> | null | undefined,
) {
  const providerJobId = outputSnapshot?.provider_job_id;
  return typeof providerJobId === "string" ? providerJobId : null;
}
