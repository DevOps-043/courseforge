import { createHash } from "node:crypto";
import type {
  AvatarClip,
  MaterialAssets,
  VoiceClip,
} from "@/domains/materials/types/materials.types";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
  failProductionJob,
  markProductionJobRunning,
  resolveProductionComponentContext,
} from "../../jobs/production-jobs.service";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  type ProductionJobStatus,
} from "../../types/production.types";
import { HeygenClient } from "./heygen.client";
import { HeygenRepository } from "./heygen.repository";
import {
  assertHeygenTextInputWithinLimits,
  HeygenRequestValidationError,
} from "./heygen-request-constraints";
import {
  HEYGEN_VIDEO_STATUSES,
  type HeygenAvatarVideoAspectRatio,
  type HeygenAvatarVideoEngine,
  type HeygenAvatarVideoOutputFormat,
  type HeygenAvatarVideoResolution,
  type HeygenCreateVideoRequest,
  type HeygenSupabaseClient,
} from "./heygen.types";
import { HeygenVideoImportService } from "./heygen-video-import.service";
import {
  HeygenAudioImportService,
  type HeygenImportedVoiceAsset,
} from "./heygen-audio-import.service";
import { assertTrackDurationsAligned } from "./heygen-video.service";

export class HeygenScenesServiceError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "HeygenScenesServiceError";
    this.status = status;
  }
}

export interface HeygenSceneClipGenerationOptions {
  aspectRatio: HeygenAvatarVideoAspectRatio;
  caption: boolean;
  clipIds: string[];
  clips: AvatarClip[];
  componentId: string;
  engine: HeygenAvatarVideoEngine;
  generationTarget: "avatar" | "voice_only";
  locale?: string;
  outputFormat: HeygenAvatarVideoOutputFormat;
  resolution: HeygenAvatarVideoResolution;
  speed: number;
}

export interface HeygenSceneClipJobResult {
  clipId: string;
  errorMessage?: string;
  jobId: string | null;
  providerJobId: string | null;
  status: ProductionJobStatus;
  voiceClip?: VoiceClip;
}

interface HeygenSceneVoiceJobResult {
  clipId: string;
  errorMessage?: string;
  jobId: string | null;
  voiceClip: VoiceClip;
}

export class HeygenScenesService {
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

  buildSceneClips(params: {
    componentContent: unknown;
    existingClips?: AvatarClip[];
  }): AvatarClip[] {
    const baseClips = readStoryboardScenes(params.componentContent);
    const existingById = new Map((params.existingClips || []).map((clip) => [clip.id, clip]));
    const mergedBaseClips = baseClips.map((baseClip) => {
      const existing = existingById.get(baseClip.id);
      if (!existing) return baseClip;

      const sourceChanged =
        Boolean(existing.source_hash) &&
        existing.source_hash !== baseClip.source_hash;
      const shouldMarkStale =
        sourceChanged &&
        (existing.status === "COMPLETED" || existing.status === "WAITING_PROVIDER");

      return {
        ...baseClip,
        ...existing,
        order: baseClip.order,
        storyboard_take_number: baseClip.storyboard_take_number,
        visual_type: baseClip.visual_type,
        status: shouldMarkStale ? "STALE" : existing.status,
        source_hash: baseClip.source_hash,
      };
    });

    const manualClips = (params.existingClips || []).filter(
      (clip) => clip.origin === "manual" && !clip.deleted,
    );

    return sortClips([...mergedBaseClips, ...manualClips]);
  }

  async saveSceneClips(params: {
    avatarGenerationMode?: MaterialAssets["avatar_generation_mode"];
    clips: AvatarClip[];
    componentId: string;
    voiceClips?: VoiceClip[];
  }) {
    const currentAssets = await this.readComponentAssets(params.componentId);
    const sortedClips = sortClips(params.clips);
    const nextVoiceClips = reconcileVoiceClips(
      params.voiceClips ?? currentAssets.voice_clips ?? [],
      sortedClips,
    );
    const nextAssets = {
      ...currentAssets,
      avatar_generation_mode:
        params.avatarGenerationMode || currentAssets.avatar_generation_mode || "scene_clips",
      avatar_clips: sortedClips,
      voice_clips: nextVoiceClips,
      final_video_assembly_stale: true,
      final_video_layout_stale: true,
      updated_at: new Date().toISOString(),
    };

    await this.updateComponentAssets(params.componentId, nextAssets);
    return nextAssets;
  }

  async queueSceneClips(params: {
    clips: AvatarClip[];
    clipIds: string[];
    componentId: string;
    generationTarget: "avatar" | "voice_only";
    organizationId: string;
  }) {
    const context = await resolveProductionComponentContext({
      componentId: params.componentId,
      supabase: this.supabase,
    });
    if (context.organizationId !== params.organizationId) {
      throw new HeygenScenesServiceError(
        "El componente no pertenece a la empresa activa.",
        403,
      );
    }

    const selectedIds = new Set(params.clipIds);
    if (!params.clips.some((clip) => selectedIds.has(clip.id) && !clip.deleted)) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar.");
    }

    const queuedClips = sortClips(params.clips.filter((clip) => !clip.deleted)).map((clip) => {
      if (!selectedIds.has(clip.id)) return clip;
      return params.generationTarget === "voice_only"
        ? { ...clip, voice_error_message: undefined, voice_status: "WAITING_PROVIDER" as const }
        : {
            ...clip,
            error_message: undefined,
            external_id: undefined,
            job_id: undefined,
            status: "WAITING_PROVIDER" as const,
          };
    });
    const assets = await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips: queuedClips,
      componentId: params.componentId,
    });
    return {
      clips: queuedClips,
      voiceClips: assets.voice_clips || [],
    };
  }

  async markQueuedSceneClipsFailed(params: {
    clipIds: string[];
    componentId: string;
    errorMessage: string;
    generationTarget?: "avatar" | "voice_only";
  }) {
    const currentAssets = await this.readComponentAssets(params.componentId);
    const selectedIds = new Set(params.clipIds);
    const clips = sortClips(currentAssets.avatar_clips || []).map((clip) => {
      if (!selectedIds.has(clip.id)) return clip;
      if (params.generationTarget === "voice_only" && clip.voice_status === "WAITING_PROVIDER") {
        return { ...clip, voice_error_message: params.errorMessage.slice(0, 500), voice_status: "FAILED" as const };
      }
      return clip.status === "WAITING_PROVIDER" && !clip.job_id
        ? { ...clip, error_message: params.errorMessage.slice(0, 500), status: "FAILED" as const }
        : clip;
    });
    await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: params.componentId,
      voiceClips: currentAssets.voice_clips || [],
    });
  }

  async generateSceneVoiceClips(params: {
    clipIds: string[];
    componentId: string;
    createdBy: string;
    organizationId: string;
  }) {
    const context = await resolveProductionComponentContext({
      componentId: params.componentId,
      supabase: this.supabase,
    });
    if (context.organizationId !== params.organizationId) {
      throw new HeygenScenesServiceError("El componente no pertenece a la empresa activa.", 403);
    }

    const currentAssets = await this.readComponentAssets(params.componentId);
    const clips = sortClips(currentAssets.avatar_clips || []).filter((clip) => !clip.deleted);
    const selectedIds = new Set(params.clipIds);
    const selectedClips = clips.filter((clip) => selectedIds.has(clip.id));
    if (selectedClips.length === 0) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena activa para generar su voz.");
    }

    let voiceClips = reconcileVoiceClips(currentAssets.voice_clips || [], clips);
    const jobs: HeygenSceneVoiceJobResult[] = [];
    for (const clip of selectedClips) {
      try {
        const result = await this.createVoiceJobForClip({
          clip,
          context,
          createdBy: params.createdBy,
          organizationId: params.organizationId,
        });
        jobs.push(result);
        voiceClips = upsertVoiceClips(voiceClips, [result.voiceClip]);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failedVoiceClip = createFailedVoiceClip(clip, message);
        jobs.push({
          clipId: clip.id,
          errorMessage: message,
          jobId: null,
          voiceClip: failedVoiceClip,
        });
        voiceClips = upsertVoiceClips(voiceClips, [failedVoiceClip]);
      }
    }

    const materialAssets = await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: params.componentId,
      voiceClips,
    });
    return { clips, jobs, voiceClips: materialAssets.voice_clips || [] };
  }

  async generateSceneClips(params: {
    createdBy: string;
    options: HeygenSceneClipGenerationOptions;
    organizationId: string;
  }) {
    if (params.options.generationTarget === "voice_only") {
      return this.generateSceneVoices(params);
    }
    const context = await resolveProductionComponentContext({
      componentId: params.options.componentId,
      supabase: this.supabase,
    });

    if (context.organizationId !== params.organizationId) {
      throw new HeygenScenesServiceError(
        "El componente no pertenece a la empresa activa.",
        403,
      );
    }

    const selectedIds = new Set(params.options.clipIds);
    const selectedClips = params.options.clips.filter(
      (clip) => selectedIds.has(clip.id) && !clip.deleted,
    );
    if (selectedClips.length === 0) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar.");
    }

    const jobs: HeygenSceneClipJobResult[] = [];
    let clips = sortClips(params.options.clips.filter((clip) => !clip.deleted));
    let voiceClips = reconcileVoiceClips(
      (await this.readComponentAssets(context.componentId)).voice_clips || [],
      clips,
    );
    await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: context.componentId,
      voiceClips,
    });

    for (let index = 0; index < selectedClips.length; index += 2) {
      const batch = selectedClips.slice(index, index + 2);
      const batchResults = await Promise.all(
        batch.map((clip) =>
          this.createProviderJobForClip({
            clip,
            context,
            createdBy: params.createdBy,
            existingVoiceClip: voiceClips.find((voiceClip) => voiceClip.clip_id === clip.id),
            options: params.options,
            organizationId: params.organizationId,
          }),
        ),
      );
      jobs.push(...batchResults);
      voiceClips = upsertVoiceClips(
        voiceClips,
        batchResults.flatMap((result) => result.voiceClip ? [result.voiceClip] : []),
      );

      clips = clips.map((clip) => {
        const result = batchResults.find((entry) => entry.clipId === clip.id);
        return result
          ? {
              ...clip,
              error_message: result.errorMessage,
              external_id: result.providerJobId || clip.external_id,
              job_id: result.jobId || clip.job_id,
              provider: PRODUCTION_PROVIDERS.HEYGEN,
              script_hash: hashText(clip.script_text),
              status: result.status === PRODUCTION_JOB_STATUSES.FAILED ? "FAILED" : "WAITING_PROVIDER",
            }
          : clip;
      });

      await this.saveSceneClips({
        avatarGenerationMode: "scene_clips",
        clips,
        componentId: context.componentId,
        voiceClips,
      });
    }

    return { clips, jobs, voiceClips };
  }

  private async generateSceneVoices(params: {
    createdBy: string;
    options: HeygenSceneClipGenerationOptions;
    organizationId: string;
  }) {
    const context = await resolveProductionComponentContext({
      componentId: params.options.componentId,
      supabase: this.supabase,
    });
    if (context.organizationId !== params.organizationId) {
      throw new HeygenScenesServiceError("El componente no pertenece a la empresa activa.", 403);
    }

    const selectedIds = new Set(params.options.clipIds);
    const selectedClips = params.options.clips.filter((clip) => selectedIds.has(clip.id) && !clip.deleted);
    if (selectedClips.length === 0) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar voz.");
    }

    let clips = sortClips(params.options.clips.filter((clip) => !clip.deleted));
    let voiceClips = reconcileVoiceClips(
      (await this.readComponentAssets(context.componentId)).voice_clips || [],
      clips,
    );
    const jobs: HeygenSceneClipJobResult[] = [];

    for (let index = 0; index < selectedClips.length; index += 2) {
      const batch = selectedClips.slice(index, index + 2);
      const results = await Promise.all(batch.map((clip) => this.createVoiceOnlyJobForClip({
        clip,
        context,
        createdBy: params.createdBy,
        options: params.options,
        organizationId: params.organizationId,
      })));
      jobs.push(...results);
      voiceClips = upsertVoiceClips(voiceClips, results.flatMap((result) => result.voiceClip ? [result.voiceClip] : []));
      clips = clips.map((clip) => {
        const result = results.find((entry) => entry.clipId === clip.id);
        if (!result) return clip;
        return {
          ...clip,
          voice_error_message: result.errorMessage,
          voice_status: result.status === PRODUCTION_JOB_STATUSES.SUCCEEDED ? "COMPLETED" as const : "FAILED" as const,
        };
      });
      await this.saveSceneClips({
        avatarGenerationMode: "scene_clips",
        clips,
        componentId: context.componentId,
        voiceClips,
      });
    }

    return { clips, jobs, voiceClips };
  }

  private async createVoiceOnlyJobForClip(params: {
    clip: AvatarClip;
    context: Awaited<ReturnType<typeof resolveProductionComponentContext>>;
    createdBy: string;
    options: HeygenSceneClipGenerationOptions;
    organizationId: string;
  }): Promise<HeygenSceneClipJobResult> {
    let createdJobId: string | null = null;
    try {
      assertHeygenTextInputWithinLimits({ label: `La escena ${params.clip.order}`, text: params.clip.script_text });
      const voice = await this.repository.getVoicePresetForGeneration({
        organizationId: params.organizationId,
        presetId: params.clip.voice_preset_id,
      });
      if (!voice?.heygen_voice_id) {
        throw new HeygenScenesServiceError("No hay una voz de HeyGen disponible para la escena.", 409);
      }

      const scriptHash = hashText(params.clip.script_text);
      const jobInput = {
        clip_id: params.clip.id,
        component_id: params.context.componentId,
        generation_target: "voice_only",
        job_type: PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
        locale: params.options.locale || null,
        script_hash: scriptHash,
        speed: params.options.speed,
        voice_preset_id: voice.id,
        voice_provider_id: voice.heygen_voice_id,
      };
      const job = await createOrReuseProductionJob(this.supabase, {
        context: params.context,
        createdBy: params.createdBy,
        idempotencyKey: buildProductionIdempotencyKey({
          componentId: params.context.componentId,
          input: jobInput,
          jobType: PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
          provider: PRODUCTION_PROVIDERS.HEYGEN,
        }),
        inputSnapshot: jobInput,
        jobType: PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
        providerModel: "starfish",
        retryFailed: true,
      });
      createdJobId = job.id;

      let voiceAsset = await this.audioImportService.findImportedVoice(job.id);
      if (!voiceAsset) {
        const persistedJob = await this.repository.getProductionJob({ jobId: job.id, organizationId: params.organizationId });
        if (!persistedJob) throw new HeygenScenesServiceError("No se pudo recuperar el job de voz.", 500);
        const speech = await this.client.generateSpeech({
          locale: params.options.locale,
          speed: params.options.speed,
          text: params.clip.script_text,
          voice_id: voice.heygen_voice_id,
        });
        voiceAsset = await this.audioImportService.importGeneratedSpeech({
          createdBy: params.createdBy,
          job: persistedJob,
          scriptHash,
          speech,
          voiceProviderId: voice.heygen_voice_id,
        });
        await this.repository.markVideoJobSucceeded({
          durationSeconds: speech.durationSeconds,
          jobId: job.id,
          outputSnapshot: {
            audio_asset_id: voiceAsset.id,
            duration_seconds: speech.durationSeconds,
            generation_target: "voice_only",
            provider_request_id: speech.requestId || null,
          },
        });
      }

      return {
        clipId: params.clip.id,
        jobId: job.id,
        providerJobId: voiceAsset.providerRequestId || null,
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
        voiceClip: toVoiceClip({ asset: voiceAsset, clip: params.clip, scriptHash }),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (createdJobId) {
        await this.repository.markVideoJobFailed({
          errorPayload: {
            error_message: errorMessage,
            generation_target: "voice_only",
            stage: "speech_generation",
          },
          jobId: createdJobId,
        });
      }
      return {
        clipId: params.clip.id,
        errorMessage,
        jobId: createdJobId,
        providerJobId: null,
        status: PRODUCTION_JOB_STATUSES.FAILED,
      };
    }
  }

  async refreshSceneClipStatuses(params: {
    componentId: string;
    createdBy?: string | null;
    organizationId: string;
  }) {
    const context = await resolveProductionComponentContext({
      componentId: params.componentId,
      supabase: this.supabase,
    });

    if (context.organizationId !== params.organizationId) {
      throw new HeygenScenesServiceError(
        "El componente no pertenece a la empresa activa.",
        403,
      );
    }

    const currentAssets = await this.readComponentAssets(params.componentId);
    let clips = sortClips(currentAssets.avatar_clips || []);
    let voiceClips = reconcileVoiceClips(currentAssets.voice_clips || [], clips);

    for (const clip of clips) {
      if (clip.status !== "WAITING_PROVIDER" || !clip.job_id) continue;

      const job = await this.repository.getProductionJob({
        jobId: clip.job_id,
        organizationId: params.organizationId,
      });
      if (!job) continue;

      const importedVoice = await this.audioImportService.findImportedVoice(job.id);
      if (importedVoice) {
        voiceClips = upsertVoiceClips(voiceClips, [
          toVoiceClip({
            asset: importedVoice,
            clip,
            scriptHash: readString(job.input_snapshot?.script_hash) || hashText(clip.script_text),
          }),
        ]);
      }

      if (job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED) {
        const existingAsset = await this.repository.findAvatarVideoAssetByJob(
          job.id,
          PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP,
        );
        if (existingAsset?.public_url && existingAsset.storage_path) {
          clips = replaceClip(clips, clip.id, {
            ...clip,
            duration: job.duration_seconds || clip.duration,
            file_name: existingAsset.storage_path.split("/").at(-1) || clip.file_name,
            public_url: existingAsset.public_url,
            has_audio: importedVoice ? false : clip.has_audio,
            script_hash: readString(job.input_snapshot?.script_hash) || clip.script_hash,
            storage_path: existingAsset.storage_path,
            status: "COMPLETED",
          });
        }
        continue;
      }

      if (job.status === PRODUCTION_JOB_STATUSES.FAILED) {
        clips = replaceClip(clips, clip.id, { ...clip, status: "FAILED" });
        continue;
      }

      if (!job.provider_job_id) continue;

      const video = await this.client.getVideo(job.provider_job_id);
      const providerStatus = video.status.toLowerCase();

      if (providerStatus === HEYGEN_VIDEO_STATUSES.FAILED) {
        await this.repository.markVideoJobFailed({
          errorPayload: {
            failure_code: video.failureCode || null,
            failure_message: video.failureMessage || "HeyGen marco el clip como fallido.",
            provider_status: video.status,
          },
          jobId: job.id,
        });
        clips = replaceClip(clips, clip.id, {
          ...clip,
          error_message: video.failureMessage || "HeyGen marco el clip como fallido.",
          status: "FAILED",
        });
        continue;
      }

      if (providerStatus !== HEYGEN_VIDEO_STATUSES.COMPLETED) {
        continue;
      }

      const imported = await this.importService.importCompletedClipVideo({
        createdBy: params.createdBy || null,
        job,
        video,
      });

      if (job.input_snapshot?.separate_tracks === true) {
        if (!importedVoice) {
          await this.repository.markVideoJobFailed({
            errorPayload: {
              error_message: "El clip termino sin su pista de voz independiente.",
              stage: "track_promotion",
            },
            jobId: job.id,
          });
          clips = replaceClip(clips, clip.id, {
            ...clip,
            error_message: "El clip termino sin su pista de voz independiente.",
            status: "FAILED",
          });
          continue;
        }
        try {
          assertTrackDurationsAligned({
            avatarDurationSeconds: video.durationSeconds,
            voiceDurationSeconds: importedVoice.durationSeconds,
          });
        } catch (error) {
          await this.repository.markVideoJobFailed({
            errorPayload: {
              error_message: error instanceof Error ? error.message : String(error),
              stage: "track_duration_validation",
            },
            jobId: job.id,
          });
          clips = replaceClip(clips, clip.id, {
            ...clip,
            error_message: error instanceof Error ? error.message : String(error),
            status: "FAILED",
          });
          continue;
        }
      }

      await this.repository.markVideoJobSucceeded({
        durationSeconds: video.durationSeconds || null,
        jobId: job.id,
        outputSnapshot: {
          asset: imported.asset,
          duration_seconds: video.durationSeconds || null,
          provider_job_id: job.provider_job_id,
          provider_status: video.status,
          video_id: video.videoId,
        },
      });

      clips = replaceClip(clips, clip.id, {
        ...clip,
        duration: video.durationSeconds || clip.duration,
        external_id: video.videoId,
        file_name: imported.asset.storagePath.split("/").at(-1) || clip.file_name,
        has_audio: importedVoice ? false : true,
        public_url: imported.asset.publicUrl,
        storage_path: imported.asset.storagePath,
        script_hash: readString(job.input_snapshot?.script_hash) || clip.script_hash,
        status: "COMPLETED",
      });
    }

    const materialAssets = await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: params.componentId,
      voiceClips,
    });

    return { clips, materialAssets, voiceClips };
  }

  private async createProviderJobForClip(params: {
    clip: AvatarClip;
    context: Awaited<ReturnType<typeof resolveProductionComponentContext>>;
    createdBy: string;
    existingVoiceClip?: VoiceClip;
    options: HeygenSceneClipGenerationOptions;
    organizationId: string;
  }): Promise<HeygenSceneClipJobResult> {
    try {
      assertHeygenTextInputWithinLimits({
        label: `La escena ${params.clip.order}`,
        text: params.clip.script_text,
      });
    } catch (error) {
      if (error instanceof HeygenRequestValidationError) {
        return {
          clipId: params.clip.id,
          errorMessage: error.message,
          jobId: null,
          providerJobId: null,
          status: PRODUCTION_JOB_STATUSES.FAILED,
        };
      }

      throw error;
    }

    const avatar = await this.repository.getAvatarPresetForGeneration({
      organizationId: params.organizationId,
      presetId: params.clip.avatar_preset_id,
    });
    if (!avatar) {
      throw new HeygenScenesServiceError("No se encontro el avatar de HeyGen solicitado.", 404);
    }

    if (!avatarSupportsEngine(avatar.supported_api_engines, params.options.engine)) {
      throw new HeygenScenesServiceError("El avatar seleccionado no soporta el engine solicitado.", 409);
    }

    const voice = await this.repository.getVoicePresetForGeneration({
      organizationId: params.organizationId,
      presetId: params.clip.voice_preset_id,
    });
    const providerVoiceId = voice?.heygen_voice_id || avatar.default_voice_id;
    if (!providerVoiceId) {
      throw new HeygenScenesServiceError("No hay una voz de HeyGen disponible para el avatar seleccionado.", 409);
    }

    const scriptHash = hashText(params.clip.script_text);
    const jobInput = {
      avatar_preset_id: avatar.id,
      background: params.clip.background || null,
      clip_id: params.clip.id,
      component_id: params.context.componentId,
      component_type: params.context.componentType,
      engine: params.options.engine,
      job_type: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
      output_format: params.options.outputFormat,
      script_hash: scriptHash,
      separate_tracks: true,
      voice_preset_id: voice?.id || null,
      voice_provider_id: providerVoiceId,
    };
    const job = await createOrReuseProductionJob(this.supabase, {
      context: params.context,
      createdBy: params.createdBy,
      idempotencyKey: buildProductionIdempotencyKey({
        componentId: params.context.componentId,
        input: jobInput,
        jobType: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
      }),
      inputSnapshot: jobInput,
      jobType: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
      provider: PRODUCTION_PROVIDERS.HEYGEN,
      providerModel: params.options.engine,
      retryFailed: true,
    });

    if (job.status !== PRODUCTION_JOB_STATUSES.PENDING) {
      const existingVoice = await this.audioImportService.findImportedVoice(job.id);
      return {
        clipId: params.clip.id,
        jobId: job.id,
        providerJobId: job.provider_job_id || readProviderJobId(job.output_snapshot),
        status: job.status,
        voiceClip: existingVoice
          ? toVoiceClip({ asset: existingVoice, clip: params.clip, scriptHash })
          : undefined,
      };
    }

    const persistedJob = await this.repository.getProductionJob({
      jobId: job.id,
      organizationId: params.organizationId,
    });
    if (!persistedJob) {
      throw new HeygenScenesServiceError("No se pudo recuperar el job del clip de HeyGen.", 500);
    }

    let voiceAsset = getReusableSceneVoiceAsset(params.existingVoiceClip, scriptHash)
      || await this.audioImportService.findImportedVoice(job.id);
    if (!voiceAsset) {
      try {
        const speech = await this.client.generateSpeech({
          locale: params.options.locale,
          speed: params.options.speed,
          text: params.clip.script_text,
          voice_id: providerVoiceId,
        });
        voiceAsset = await this.audioImportService.importGeneratedSpeech({
          createdBy: params.createdBy,
          job: persistedJob,
          scriptHash,
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
        return {
          clipId: params.clip.id,
          errorMessage: error instanceof Error ? error.message : String(error),
          jobId: job.id,
          providerJobId: null,
          status: PRODUCTION_JOB_STATUSES.FAILED,
        };
      }
    }

    const requestPayload = buildHeygenCreateClipPayload({
      audioUrl: voiceAsset.publicUrl,
      avatarId: avatar.heygen_avatar_look_id,
      componentId: params.context.componentId,
      clip: params.clip,
      options: params.options,
    });
    let createdVideo;
    try {
      createdVideo = await this.client.createAvatarVideo(requestPayload, job.id);
    } catch (error) {
      await this.repository.markVideoJobFailed({
        errorPayload: buildCreateFailurePayload(error, requestPayload, params.clip),
        jobId: job.id,
      });

      return {
        clipId: params.clip.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        jobId: job.id,
        providerJobId: null,
        status: PRODUCTION_JOB_STATUSES.FAILED,
        voiceClip: toVoiceClip({ asset: voiceAsset, clip: params.clip, scriptHash }),
      };
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
        clip_id: params.clip.id,
        engine: params.options.engine,
        output_format: requestPayload.output_format,
        resolution: requestPayload.resolution,
        script_hash: scriptHash,
        voice_preset_id: voice?.id || null,
        voice_audio_asset_id: voiceAsset.id,
        voice_audio_duration_seconds: voiceAsset.durationSeconds,
      },
    });

    return {
      clipId: params.clip.id,
      jobId: job.id,
      providerJobId: createdVideo.videoId,
      status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
      voiceClip: toVoiceClip({ asset: voiceAsset, clip: params.clip, scriptHash }),
    };
  }

  private async createVoiceJobForClip(params: {
    clip: AvatarClip;
    context: Awaited<ReturnType<typeof resolveProductionComponentContext>>;
    createdBy: string;
    organizationId: string;
  }): Promise<HeygenSceneVoiceJobResult> {
    assertHeygenTextInputWithinLimits({
      label: `La voz de la escena ${params.clip.order}`,
      text: params.clip.script_text,
    });

    const voice = await this.repository.getVoicePresetForGeneration({
      organizationId: params.organizationId,
      presetId: params.clip.voice_preset_id,
    });
    if (!voice?.heygen_voice_id) {
      throw new HeygenScenesServiceError(
        params.clip.voice_preset_id
          ? "No se encontró la voz de HeyGen solicitada para la escena."
          : "Configura una voz predeterminada de HeyGen para generar esta escena.",
        404,
      );
    }

    const scriptHash = hashText(params.clip.script_text);
    const jobInput = {
      clip_id: params.clip.id,
      component_id: params.context.componentId,
      component_type: params.context.componentType,
      job_type: PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
      script_hash: scriptHash,
      speed: params.clip.voice_speed ?? 1,
      voice_preset_id: voice.id,
      voice_provider_id: voice.heygen_voice_id,
    };
    const job = await createOrReuseProductionJob(this.supabase, {
      context: params.context,
      createdBy: params.createdBy,
      idempotencyKey: buildProductionIdempotencyKey({
        componentId: params.context.componentId,
        input: jobInput,
        jobType: PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
      }),
      inputSnapshot: jobInput,
      jobType: PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
      provider: PRODUCTION_PROVIDERS.HEYGEN,
      providerModel: "starfish",
      retryFailed: true,
    });
    const persistedJob = await this.repository.getProductionJob({
      jobId: job.id,
      organizationId: params.organizationId,
    });
    if (!persistedJob) {
      throw new HeygenScenesServiceError("No se pudo recuperar el job de voz de la escena.", 500);
    }

    let voiceAsset = await this.audioImportService.findImportedVoice(job.id);
    if (!voiceAsset) {
      try {
        await markProductionJobRunning({ jobId: job.id, supabase: this.supabase });
        const speech = await this.client.generateSpeech({
          speed: params.clip.voice_speed ?? 1,
          text: params.clip.script_text,
          voice_id: voice.heygen_voice_id,
        });
        voiceAsset = await this.audioImportService.importGeneratedSpeech({
          createdBy: params.createdBy,
          job: persistedJob,
          scriptHash,
          speech,
          voiceProviderId: voice.heygen_voice_id,
        });
      } catch (error) {
        await failProductionJob({ error, jobId: job.id, supabase: this.supabase });
        throw error;
      }
    }

    await this.repository.markVideoJobSucceeded({
      durationSeconds: voiceAsset.durationSeconds,
      jobId: job.id,
      outputSnapshot: {
        asset_id: voiceAsset.id,
        asset_type: PRODUCTION_ASSET_TYPES.VOICE_AUDIO,
        clip_id: params.clip.id,
        duration_seconds: voiceAsset.durationSeconds,
        provider_request_id: voiceAsset.providerRequestId,
        script_hash: scriptHash,
      },
    });

    return {
      clipId: params.clip.id,
      jobId: job.id,
      voiceClip: toVoiceClip({ asset: voiceAsset, clip: params.clip, scriptHash }),
    };
  }

  private async readComponentAssets(componentId: string): Promise<MaterialAssets> {
    const { data, error } = await this.supabase
      .from("material_components")
      .select("assets")
      .eq("id", componentId)
      .maybeSingle();

    if (error) throw error;
    return data?.assets && typeof data.assets === "object"
      ? (data.assets as MaterialAssets)
      : {};
  }

  private async updateComponentAssets(componentId: string, assets: MaterialAssets) {
    const { error } = await this.supabase
      .from("material_components")
      .update({ assets })
      .eq("id", componentId);

    if (error) throw error;
  }
}

function readStoryboardScenes(componentContent: unknown): AvatarClip[] {
  const content = toRecord(componentContent);
  const storyboard = Array.isArray(content?.storyboard) ? content.storyboard : [];
  const source = storyboard.length > 0 ? storyboard : readScriptSections(content);

  return source.flatMap((entry, index) => {
    const record = toRecord(entry);
    if (!record) return [];

    const scriptText = readString(record.narration_text) || readString(record.text);
    if (!scriptText) return [];

    const takeNumber = readPositiveInteger(record.take_number) || index + 1;
    const visualType = readString(record.visual_type) || readString(record.type);
    const id = `scene-${takeNumber}`;
    const sourceHash = hashText([scriptText, visualType].join("\n"));

    return [
      {
        id,
        order: index + 1,
        origin: "storyboard" as const,
        storyboard_take_number: takeNumber,
        visual_type: visualType || undefined,
        script_text: scriptText,
        source_hash: sourceHash,
        status: "DRAFT" as const,
      },
    ];
  });
}

function readScriptSections(content: Record<string, unknown> | null) {
  const script = toRecord(content?.script) || toRecord(content?.video_script);
  const sections = script?.sections || content?.sections;
  return Array.isArray(sections) ? sections : [];
}

export function buildHeygenCreateClipPayload(params: {
  audioUrl: string;
  avatarId: string;
  clip: AvatarClip;
  componentId: string;
  options: HeygenSceneClipGenerationOptions;
}): HeygenCreateVideoRequest {
  return {
    aspect_ratio: params.options.aspectRatio,
    audio_url: params.audioUrl,
    avatar_id: params.avatarId,
    background: params.clip.background,
    callback_id: `${params.componentId}:${params.clip.id}`,
    caption: params.options.caption
      ? { file_format: "srt", style: "default" }
      : undefined,
    engine: { type: params.options.engine },
    output_format: params.options.outputFormat,
    resolution: params.options.resolution,
    title: `Avatar ${params.clip.order}`,
    type: "avatar",
  };
}

function buildCreateFailurePayload(
  error: unknown,
  requestPayload: HeygenCreateVideoRequest,
  clip: AvatarClip,
) {
  return {
    clip_id: clip.id,
    error_message: error instanceof Error ? error.message : String(error),
    request: {
      aspect_ratio: requestPayload.aspect_ratio,
      caption_enabled: Boolean(requestPayload.caption),
      engine: requestPayload.engine?.type || null,
      output_format: requestPayload.output_format,
      resolution: requestPayload.resolution,
      audio_input: Boolean(requestPayload.audio_url),
      script_characters: requestPayload.script?.length || 0,
      title: requestPayload.title,
    },
  };
}

function avatarSupportsEngine(
  supportedEngines: string[] | null | undefined,
  requestedEngine: string,
) {
  return !supportedEngines || supportedEngines.length === 0 || supportedEngines.includes(requestedEngine);
}

function replaceClip(clips: AvatarClip[], clipId: string, nextClip: AvatarClip) {
  return sortClips(clips.map((clip) => (clip.id === clipId ? nextClip : clip)));
}

function sortClips(clips: AvatarClip[]) {
  return [...clips].sort((left, right) => left.order - right.order);
}

function toVoiceClip(params: {
  asset: HeygenImportedVoiceAsset;
  clip: AvatarClip;
  scriptHash: string;
}): VoiceClip {
  return {
    asset_id: params.asset.id,
    id: `voice-${params.clip.id}`,
    clip_id: params.clip.id,
    order: params.clip.order,
    storage_path: params.asset.storagePath,
    public_url: params.asset.publicUrl,
    file_name: params.asset.storagePath.split("/").at(-1),
    duration: params.asset.durationSeconds || undefined,
    external_id: params.asset.providerRequestId || undefined,
    provider: PRODUCTION_PROVIDERS.HEYGEN,
    script_hash: params.scriptHash,
    word_timestamps: params.asset.wordTimestamps,
    status: "COMPLETED",
  };
}

export function getReusableSceneVoiceAsset(
  voiceClip: VoiceClip | undefined,
  expectedScriptHash: string,
): HeygenImportedVoiceAsset | null {
  if (
    !voiceClip
    || voiceClip.status !== "COMPLETED"
    || voiceClip.script_hash !== expectedScriptHash
    || !voiceClip.public_url
    || !voiceClip.storage_path
  ) {
    return null;
  }

  return {
    durationSeconds: voiceClip.duration || null,
    id: voiceClip.asset_id || voiceClip.id,
    publicUrl: voiceClip.public_url,
    providerRequestId: voiceClip.external_id || null,
    storagePath: voiceClip.storage_path,
    wordTimestamps: voiceClip.word_timestamps || [],
  };
}

function createFailedVoiceClip(clip: AvatarClip, errorMessage: string): VoiceClip {
  return {
    clip_id: clip.id,
    error_message: errorMessage.slice(0, 500),
    id: `voice-${clip.id}`,
    order: clip.order,
    script_hash: hashText(clip.script_text),
    status: "FAILED",
  };
}

function upsertVoiceClips(current: VoiceClip[], incoming: VoiceClip[]) {
  const byClipId = new Map(current.map((clip) => [clip.clip_id, clip]));
  for (const clip of incoming) byClipId.set(clip.clip_id, clip);
  return [...byClipId.values()].sort((left, right) => left.order - right.order);
}

export function reconcileVoiceClips(voiceClips: VoiceClip[], avatarClips: AvatarClip[]) {
  const activeById = new Map(
    avatarClips.filter((clip) => !clip.deleted).map((clip) => [clip.id, clip]),
  );
  return voiceClips.flatMap((voiceClip) => {
    const avatarClip = activeById.get(voiceClip.clip_id);
    if (!avatarClip) return [];
    const expectedHash = hashText(avatarClip.script_text);
    return [{
      ...voiceClip,
      order: avatarClip.order,
      status: voiceClip.script_hash === expectedHash ? voiceClip.status : "STALE" as const,
    }];
  }).sort((left, right) => left.order - right.order);
}

function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function readProviderJobId(outputSnapshot: unknown) {
  const snapshot = toRecord(outputSnapshot);
  const value = snapshot?.provider_job_id;
  return typeof value === "string" ? value : null;
}

function readPositiveInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : 0;
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function toRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
