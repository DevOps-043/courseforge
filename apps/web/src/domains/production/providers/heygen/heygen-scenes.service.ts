import { createHash } from "node:crypto";
import type { AvatarClip, MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
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
  outputFormat: HeygenAvatarVideoOutputFormat;
  resolution: HeygenAvatarVideoResolution;
}

export interface HeygenSceneClipJobResult {
  clipId: string;
  errorMessage?: string;
  jobId: string | null;
  providerJobId: string | null;
  status: ProductionJobStatus;
}

export class HeygenScenesService {
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
  }) {
    const currentAssets = await this.readComponentAssets(params.componentId);
    const nextAssets = {
      ...currentAssets,
      avatar_generation_mode:
        params.avatarGenerationMode || currentAssets.avatar_generation_mode || "scene_clips",
      avatar_clips: sortClips(params.clips),
      final_video_assembly_stale: true,
      final_video_layout_stale: true,
      updated_at: new Date().toISOString(),
    };

    await this.updateComponentAssets(params.componentId, nextAssets);
    return nextAssets;
  }

  async generateSceneClips(params: {
    createdBy: string;
    options: HeygenSceneClipGenerationOptions;
    organizationId: string;
  }) {
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
    await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: context.componentId,
    });

    for (let index = 0; index < selectedClips.length; index += 2) {
      const batch = selectedClips.slice(index, index + 2);
      const batchResults = await Promise.all(
        batch.map((clip) =>
          this.createProviderJobForClip({
            clip,
            context,
            createdBy: params.createdBy,
            options: params.options,
            organizationId: params.organizationId,
          }),
        ),
      );
      jobs.push(...batchResults);

      clips = clips.map((clip) => {
        const result = batchResults.find((entry) => entry.clipId === clip.id);
        return result
          ? {
              ...clip,
              error_message: result.errorMessage,
              external_id: result.providerJobId || clip.external_id,
              job_id: result.jobId || clip.job_id,
              provider: PRODUCTION_PROVIDERS.HEYGEN,
              status: result.status === PRODUCTION_JOB_STATUSES.FAILED ? "FAILED" : "WAITING_PROVIDER",
            }
          : clip;
      });

      await this.saveSceneClips({
        avatarGenerationMode: "scene_clips",
        clips,
        componentId: context.componentId,
      });
    }

    return { clips, jobs };
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

    let clips = sortClips((await this.readComponentAssets(params.componentId)).avatar_clips || []);

    for (const clip of clips) {
      if (clip.status !== "WAITING_PROVIDER" || !clip.job_id) continue;

      const job = await this.repository.getProductionJob({
        jobId: clip.job_id,
        organizationId: params.organizationId,
      });
      if (!job) continue;

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
        public_url: imported.asset.publicUrl,
        storage_path: imported.asset.storagePath,
        status: "COMPLETED",
      });
    }

    const materialAssets = await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: params.componentId,
    });

    return { clips, materialAssets };
  }

  private async createProviderJobForClip(params: {
    clip: AvatarClip;
    context: Awaited<ReturnType<typeof resolveProductionComponentContext>>;
    createdBy: string;
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
      engine: params.options.engine,
      job_type: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
      output_format: params.options.outputFormat,
      script_hash: scriptHash,
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
    });

    if (job.status !== PRODUCTION_JOB_STATUSES.PENDING) {
      return {
        clipId: params.clip.id,
        jobId: job.id,
        providerJobId: job.provider_job_id || readProviderJobId(job.output_snapshot),
        status: job.status,
      };
    }

    const requestPayload = buildHeygenCreateClipPayload({
      avatarId: avatar.heygen_avatar_look_id,
      componentId: params.context.componentId,
      clip: params.clip,
      options: params.options,
      providerVoiceId,
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
      },
    });

    return {
      clipId: params.clip.id,
      jobId: job.id,
      providerJobId: createdVideo.videoId,
      status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
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

function buildHeygenCreateClipPayload(params: {
  avatarId: string;
  clip: AvatarClip;
  componentId: string;
  options: HeygenSceneClipGenerationOptions;
  providerVoiceId: string;
}): HeygenCreateVideoRequest {
  return {
    aspect_ratio: params.options.aspectRatio,
    avatar_id: params.avatarId,
    background: params.clip.background,
    callback_id: `${params.componentId}:${params.clip.id}`,
    caption: params.options.caption
      ? { file_format: "srt", style: "default" }
      : undefined,
    engine: { type: params.options.engine },
    output_format: params.options.outputFormat,
    resolution: params.options.resolution,
    script: params.clip.script_text,
    title: `Avatar ${params.clip.order}`,
    type: "avatar",
    voice_id: params.providerVoiceId,
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
      script_characters: requestPayload.script.length,
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
