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
  assertHeygenTextInputWithinLimits,
} from "./heygen-request-constraints";
import {
  HEYGEN_VIDEO_STATUSES,
  type HeygenAvatarVideoGenerationOptions,
  type HeygenAvatarVideoOutputFormat,
  type HeygenCreateVideoRequest,
  type HeygenProductionJobRow,
  type HeygenSupabaseClient,
  type HeygenVideoDetails,
} from "./heygen.types";
import { HeygenVideoImportService } from "./heygen-video-import.service";
import {
  HeygenAudioImportService,
  type HeygenImportedVoiceAsset,
} from "./heygen-audio-import.service";

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
  voiceAsset: PublicVoiceAsset | null;
}

interface PublicVoiceAsset {
  durationSeconds: number | null;
  id: string;
  publicUrl: string;
  providerRequestId: string | null;
  storagePath: string;
  wordTimestamps: HeygenImportedVoiceAsset["wordTimestamps"];
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
  scriptHash: string | null;
  status: string;
  voiceAsset: PublicVoiceAsset | null;
}

export class HeygenVideoService {
  private readonly client: HeygenClient;
  private readonly audioImportService: HeygenAudioImportService;
  private readonly importService: HeygenVideoImportService;
  private readonly repository: HeygenRepository;

  constructor(
    private readonly supabase: HeygenSupabaseClient,
    client?: HeygenClient,
  ) {
    this.client = client || new HeygenClient();
    this.audioImportService = new HeygenAudioImportService(supabase);
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
    assertHeygenTextInputWithinLimits({
      label: "El guion consolidado",
      text: script.scriptText,
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
      aspectRatio: params.options.aspectRatio,
      background: params.options.background || null,
      caption: params.options.caption,
      componentId: context.componentId,
      componentType: context.componentType,
      engine: params.options.engine,
      outputFormat: params.options.outputFormat,
      resolution: params.options.resolution,
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
      retryFailed: true,
    });

    if (job.status !== PRODUCTION_JOB_STATUSES.PENDING) {
      const existingVoice = await this.audioImportService.findImportedVoice(job.id);
      return {
        jobId: job.id,
        providerJobId:
          job.provider_job_id || readProviderJobId(job.output_snapshot),
        script: buildScriptSummary(script),
        status: job.status,
        voiceAsset: toPublicVoiceAsset(existingVoice),
      };
    }

    const persistedJob = await this.repository.getProductionJob({
      jobId: job.id,
      organizationId: params.organizationId,
    });
    if (!persistedJob) {
      throw new HeygenVideoServiceError("No se pudo recuperar el job de HeyGen.", 500);
    }

    let voiceAsset = await this.audioImportService.findImportedVoice(job.id);
    if (!voiceAsset) {
      try {
        const speech = await this.client.generateSpeech({
          speed: 1,
          text: script.scriptText,
          voice_id: providerVoiceId,
        });
        voiceAsset = await this.audioImportService.importGeneratedSpeech({
          createdBy: params.createdBy,
          job: persistedJob,
          scriptHash: script.scriptHash,
          speech,
          voiceProviderId: providerVoiceId,
        });
      } catch (error) {
        await this.repository.markVideoJobFailed({
          errorPayload: {
            error_message: error instanceof Error ? error.message : String(error),
            stage: "voice_generation",
          },
          jobId: job.id,
        });
        throw error;
      }
    }

    const requestPayload = buildHeygenCreateVideoPayload({
      avatarId: avatar.heygen_avatar_look_id,
      audioUrl: voiceAsset.publicUrl,
      options: params.options,
      title: script.title,
    });
    let createdVideo;
    try {
      createdVideo = await this.client.createAvatarVideo(
        requestPayload,
        job.id,
      );
    } catch (error) {
      await this.repository.markVideoJobFailed({
        errorPayload: buildCreateFailurePayload(error, requestPayload),
        jobId: job.id,
      });
      throw error;
    }

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
        voice_audio_asset_id: voiceAsset.id,
        voice_audio_duration_seconds: voiceAsset.durationSeconds,
      },
    });

    return {
      jobId: job.id,
      providerJobId: createdVideo.videoId,
      script: buildScriptSummary(script),
      status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
      voiceAsset: toPublicVoiceAsset(voiceAsset),
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
    const existingVoice = await this.audioImportService.findImportedVoice(job.id);
    if (job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED) {
      if (existingAsset?.public_url && existingAsset.storage_path) {
        await this.promoteSeparatedTracksIfRequested({
          autoPromote: Boolean(params.autoPromote),
          avatar: {
            durationSeconds: preciseAssetDuration(existingAsset) || job.duration_seconds,
            providerJobId: job.provider_job_id || "",
            publicUrl: existingAsset.public_url,
            storagePath: existingAsset.storage_path,
          },
          job,
          voice: existingVoice,
        });
      }
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
        scriptHash: readNullableString(job.input_snapshot?.script_hash),
        status: job.status,
        voiceAsset: toPublicVoiceAsset(existingVoice),
      };
    }

    if (job.status === PRODUCTION_JOB_STATUSES.FAILED) {
      return {
        asset: null,
        jobId: job.id,
        providerJobId: job.provider_job_id || null,
        scriptHash: readNullableString(job.input_snapshot?.script_hash),
        status: job.status,
        voiceAsset: toPublicVoiceAsset(existingVoice),
      };
    }

    if (!job.provider_job_id) {
      return {
        asset: null,
        jobId: job.id,
        providerJobId: null,
        scriptHash: readNullableString(job.input_snapshot?.script_hash),
        status: job.status,
        voiceAsset: toPublicVoiceAsset(existingVoice),
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
        scriptHash: readNullableString(job.input_snapshot?.script_hash),
        status: PRODUCTION_JOB_STATUSES.FAILED,
        voiceAsset: toPublicVoiceAsset(existingVoice),
      };
    }

    if (providerStatus !== HEYGEN_VIDEO_STATUSES.COMPLETED) {
      return {
        asset: null,
        jobId: job.id,
        providerJobId: job.provider_job_id,
        providerStatus: video.status,
        scriptHash: readNullableString(job.input_snapshot?.script_hash),
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        voiceAsset: toPublicVoiceAsset(existingVoice),
      };
    }

    const usesSeparatedTracks = job.input_snapshot?.separate_tracks === true;
    const imported = await this.importService.importCompletedVideo({
      autoPromote: Boolean(params.autoPromote) && !usesSeparatedTracks,
      createdBy: params.createdBy || null,
      job,
      video,
    });

    await this.promoteSeparatedTracksIfRequested({
      autoPromote: Boolean(params.autoPromote),
      avatar: {
        durationSeconds: video.durationSeconds,
        providerJobId: video.videoId,
        publicUrl: imported.asset.publicUrl,
        storagePath: imported.asset.storagePath,
      },
      job,
      voice: existingVoice,
    });

    await this.repository.markVideoJobSucceeded({
      durationSeconds: video.durationSeconds || null,
      jobId: job.id,
      outputSnapshot: buildCompletedOutputSnapshot(video, imported.asset, existingVoice),
    });

    return {
      asset: imported.asset,
      jobId: job.id,
      providerJobId: job.provider_job_id,
      providerStatus: video.status,
      scriptHash: readNullableString(job.input_snapshot?.script_hash),
      status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
      voiceAsset: toPublicVoiceAsset(existingVoice),
    };
  }

  private async promoteSeparatedTracksIfRequested(params: {
    autoPromote: boolean;
    avatar: {
      durationSeconds?: number | null;
      providerJobId: string;
      publicUrl: string;
      storagePath: string;
    };
    job: HeygenProductionJobRow;
    voice: HeygenImportedVoiceAsset | null;
  }) {
    if (!params.autoPromote || params.job.input_snapshot?.separate_tracks !== true) return;
    if (!params.job.material_component_id || !params.voice) {
      const error = new HeygenVideoServiceError(
        "El video termino, pero no existe su pista de voz sincronizada.",
        409,
      );
      await this.repository.markVideoJobFailed({
        errorPayload: { error_message: error.message, stage: "track_promotion" },
        jobId: params.job.id,
      });
      throw error;
    }
    try {
      assertTrackDurationsAligned({
        avatarDurationSeconds: params.avatar.durationSeconds,
        voiceDurationSeconds: params.voice.durationSeconds,
      });
    } catch (error) {
      await this.repository.markVideoJobFailed({
        errorPayload: {
          error_message: error instanceof Error ? error.message : String(error),
          stage: "track_duration_validation",
        },
        jobId: params.job.id,
      });
      throw error;
    }
    await this.repository.promoteSeparatedAvatarTracks({
      avatar: params.avatar,
      componentId: params.job.material_component_id,
      scriptHash: readString(params.job.input_snapshot?.script_hash),
      voice: {
        durationSeconds: params.voice.durationSeconds,
        providerRequestId: params.voice.providerRequestId,
        publicUrl: params.voice.publicUrl,
        storagePath: params.voice.storagePath,
        wordTimestamps: params.voice.wordTimestamps,
      },
    });
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
  audioUrl: string;
  avatarId: string;
  options: HeygenAvatarVideoGenerationOptions;
  title: string;
}): HeygenCreateVideoRequest {
  return {
    aspect_ratio: params.options.aspectRatio,
    audio_url: params.audioUrl,
    avatar_id: params.avatarId,
    background: params.options.background,
    callback_id: params.options.componentId,
    caption: params.options.caption
      ? { file_format: "srt", style: "default" }
      : undefined,
    engine: { type: params.options.engine },
    output_format: params.options.outputFormat,
    resolution: params.options.resolution,
    title: params.title,
    type: "avatar",
  };
}

function buildAvatarVideoJobInputSnapshot(params: {
  aspectRatio: string;
  avatarPresetId: string;
  background: unknown;
  caption: boolean;
  componentId: string;
  componentType: string;
  engine: string;
  outputFormat: HeygenAvatarVideoOutputFormat;
  resolution: string;
  scriptHash: string;
  voicePresetId: string | null;
  voiceProviderId: string;
}) {
  return {
    aspect_ratio: params.aspectRatio,
    avatar_preset_id: params.avatarPresetId,
    background: params.background,
    caption: params.caption,
    component_id: params.componentId,
    component_type: params.componentType,
    engine: params.engine,
    job_type: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO,
    output_format: params.outputFormat,
    resolution: params.resolution,
    script_hash: params.scriptHash,
    separate_tracks: true,
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
  voiceAsset: HeygenImportedVoiceAsset | null,
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
    voice_audio: voiceAsset ? {
      asset_id: voiceAsset.id,
      duration_seconds: voiceAsset.durationSeconds,
      provider_request_id: voiceAsset.providerRequestId,
      public_url: voiceAsset.publicUrl,
      storage_path: voiceAsset.storagePath,
    } : null,
  };
}

function buildCreateFailurePayload(
  error: unknown,
  requestPayload: HeygenCreateVideoRequest,
) {
  return {
    error_message: error instanceof Error ? error.message : String(error),
    request: {
      aspect_ratio: requestPayload.aspect_ratio,
      caption_enabled: Boolean(requestPayload.caption),
      engine: requestPayload.engine?.type || null,
      output_format: requestPayload.output_format,
      resolution: requestPayload.resolution,
      audio_input: Boolean(requestPayload.audio_url),
      title: requestPayload.title,
    },
  };
}

function readProviderJobId(
  outputSnapshot: Record<string, unknown> | null | undefined,
) {
  const providerJobId = outputSnapshot?.provider_job_id;
  return typeof providerJobId === "string" ? providerJobId : null;
}

function toPublicVoiceAsset(asset: HeygenImportedVoiceAsset | null): PublicVoiceAsset | null {
  if (!asset) return null;
  return {
    durationSeconds: asset.durationSeconds,
    id: asset.id,
    publicUrl: asset.publicUrl,
    providerRequestId: asset.providerRequestId,
    storagePath: asset.storagePath,
    wordTimestamps: asset.wordTimestamps,
  };
}

function readString(value: unknown) {
  return typeof value === "string" ? value : "";
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function preciseAssetDuration(asset: {
  duration_milliseconds?: number | null;
  duration_seconds?: number | null;
}) {
  return asset.duration_milliseconds && asset.duration_milliseconds > 0
    ? asset.duration_milliseconds / 1000
    : asset.duration_seconds || null;
}

export function assertTrackDurationsAligned(params: {
  avatarDurationSeconds?: number | null;
  voiceDurationSeconds?: number | null;
}) {
  if (!params.avatarDurationSeconds || !params.voiceDurationSeconds) return;
  const difference = Math.abs(params.avatarDurationSeconds - params.voiceDurationSeconds);
  const tolerance = Math.max(1, params.voiceDurationSeconds * 0.03);
  if (difference > tolerance) {
    throw new HeygenVideoServiceError(
      `Las pistas de voz y avatar difieren ${difference.toFixed(2)} segundos; no se promovieron al ensamble.`,
      422,
    );
  }
}
