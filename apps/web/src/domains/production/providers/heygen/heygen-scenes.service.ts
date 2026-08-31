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
  PRODUCTION_QA_STATUSES,
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
  type HeygenProductionJobRow,
  type HeygenSupabaseClient,
} from "./heygen.types";
import { HeygenVideoImportService } from "./heygen-video-import.service";
import {
  HeygenAudioImportService,
  parseHeygenSpeechCheckpoint,
  type HeygenImportedVoiceAsset,
} from "./heygen-audio-import.service";
import { assertTrackDurationsAligned } from "./heygen-video.service";
import { resetGeneratedSceneAssets } from "./heygen-scene-assets";
import { estimateHeygenAvatarGenerationBudget } from "./heygen-billing";
import {
  buildCorrelatedHeygenVideoTitle,
  buildHeygenSceneAssetNames,
  readHeygenJobIdFromVideoTitle,
} from "./heygen-asset-naming";

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

export interface HeygenHistoricalSceneRecoveryReport {
  alreadyAvailableAvatarCount: number;
  matchedJobCount: number;
  importedHistoricalAvatarCount: number;
  pendingAvatarCount: number;
  recoveredAvatarCount: number;
  recoveredVoiceCount: number;
  renamedAssetCount: number;
  skipped: string[];
  unresolvedSceneCount: number;
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
    preserveConcurrentGenerationProgress?: boolean;
    voiceClipIdsToRemove?: string[];
    voiceClips?: VoiceClip[];
  }) {
    const currentAssets = await this.readComponentAssets(params.componentId);
    const currentClipsById = new Map(
      (currentAssets.avatar_clips || []).map((clip) => [clip.id, clip]),
    );
    const sortedClips = params.preserveConcurrentGenerationProgress
      ? mergeSceneClipsForConcurrentGeneration(currentAssets.avatar_clips || [], params.clips)
      : sortClips(params.clips.map((clip) => (
          mergeAuthoredSceneClip(currentClipsById.get(clip.id), clip)
        )));
    const requestedVoiceClips = params.voiceClips ?? currentAssets.voice_clips ?? [];
    const concurrentVoiceClips = params.preserveConcurrentGenerationProgress
      ? mergeVoiceClipsForConcurrentGeneration({
          current: currentAssets.voice_clips || [],
          incoming: requestedVoiceClips,
          removeClipIds: params.voiceClipIdsToRemove || [],
        })
      : requestedVoiceClips;
    const nextVoiceClips = reconcileVoiceClips(
      concurrentVoiceClips,
      sortedClips,
    );
    return this.mergeSceneClipPatch({
      assetsPatch: {
        avatar_generation_mode:
          params.avatarGenerationMode || currentAssets.avatar_generation_mode || "scene_clips",
      },
      avatarClips: sortedClips,
      componentId: params.componentId,
      // Absence from an authored or worker snapshot is never a deletion. This
      // prevents a stale browser or worker from removing a newer scene.
      removeVoiceClipIds: params.voiceClipIdsToRemove || [],
      preserveAuthoredFields: Boolean(params.preserveConcurrentGenerationProgress),
      voiceClips: nextVoiceClips,
    });
  }

  async resetSceneAssets(params: {
    clipIds: string[];
    componentId: string;
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
    const currentClips = currentAssets.avatar_clips || [];
    const selectedIds = new Set(params.clipIds);
    const selectedClips = currentClips.filter(
      (clip) => selectedIds.has(clip.id) && !clip.deleted,
    );
    if (selectedClips.length !== selectedIds.size) {
      throw new HeygenScenesServiceError(
        "Una o más escenas ya no existen. Actualiza el estudio e inténtalo de nuevo.",
        409,
      );
    }
    if (selectedClips.some((clip) => (
      clip.status === "WAITING_PROVIDER" || clip.voice_status === "WAITING_PROVIDER"
    ))) {
      throw new HeygenScenesServiceError(
        "Espera a que termine la generación activa antes de limpiar sus assets.",
        409,
      );
    }

    const currentVoiceClips = currentAssets.voice_clips || [];
    const reset = resetGeneratedSceneAssets({
      avatarClips: currentClips,
      clipIds: params.clipIds,
      voiceClips: currentVoiceClips,
    });
    const materialAssets = await this.mergeSceneClipPatch({
      assetsPatch: {
        avatar_generation_mode: currentAssets.avatar_generation_mode || "scene_clips",
      },
      avatarClips: reset.avatarClips.filter((clip) => selectedIds.has(clip.id)),
      componentId: params.componentId,
      removeVoiceClipIds: params.clipIds,
    });

    await this.archiveResetProductionAssets({
      assetIds: currentVoiceClips.flatMap((clip) => (
        selectedIds.has(clip.clip_id) && clip.asset_id ? [clip.asset_id] : []
      )),
      componentId: params.componentId,
      jobIds: selectedClips.flatMap((clip) => clip.job_id ? [clip.job_id] : []),
      organizationId: params.organizationId,
    });

    return {
      clips: materialAssets.avatar_clips || [],
      voiceClips: materialAssets.voice_clips || [],
    };
  }

  /**
   * Rebuilds scene media references from historical jobs. This method never
   * submits a create-video or text-to-speech request; it only promotes local
   * files or polls an existing provider video id.
   */
  async recoverHistoricalSceneAssets(params: {
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

    const { data: component, error: componentError } = await this.supabase
      .from("material_components")
      .select("content, assets")
      .eq("id", params.componentId)
      .single();
    if (componentError) throw componentError;

    const originalAssets = isRecord(component?.assets)
      ? component.assets as MaterialAssets
      : {};
    const originalClips = sortClips(originalAssets.avatar_clips || []);
    const originalVoiceClips = originalAssets.voice_clips || [];
    const clips = this.buildSceneClips({
      componentContent: component?.content,
      existingClips: originalClips,
    });
    let jobs = await this.repository.listAvatarClipJobsForComponent({
      componentId: params.componentId,
      organizationId: params.organizationId,
    });
    const skipped: string[] = [];
    jobs = await this.restoreProviderIdsFromHeygenCatalog(jobs, skipped);
    const importedHistoricalAvatarCount = await this.importHistoricalAvatarJobs({
      createdBy: params.createdBy,
      jobs,
      skipped,
    });
    const jobsByClipId = selectRecoverableHistoricalSceneJobsForClips(clips, jobs);
    let matchedJobCount = 0;
    let renamedAssetCount = 0;

    const stagedClips: AvatarClip[] = [];
    for (const clip of clips) {
      const names = buildHeygenSceneAssetNames({ clip, context });
      const recoveredName = clip.asset_name
        || readString(jobsByClipId.get(clip.id)?.input_snapshot?.asset_display_name)
        || names.displayName;
      if (!clip.asset_name && recoveredName) renamedAssetCount += 1;

      if (hasCompletedAvatarMedia(clip)) {
        stagedClips.push({ ...clip, asset_name: recoveredName });
        continue;
      }

      const job = jobsByClipId.get(clip.id);
      if (!job) {
        stagedClips.push({ ...clip, asset_name: recoveredName });
        skipped.push(`Escena ${clip.order}: no se encontró un job histórico recuperable.`);
        continue;
      }

      const existingVideo = await this.findSceneAvatarVideoAsset(job.id);
      const providerJobId = job.provider_job_id || readProviderJobId(job.output_snapshot);
      if (!existingVideo && !providerJobId) {
        stagedClips.push({ ...clip, asset_name: recoveredName });
        skipped.push(`Escena ${clip.order}: el job no conserva un video ni un identificador de HeyGen.`);
        continue;
      }

      matchedJobCount += 1;
      if (!job.provider_job_id && providerJobId) {
        await this.repository.restoreProviderJobId({ jobId: job.id, providerJobId });
      }
      stagedClips.push({
        ...clip,
        asset_name: recoveredName,
        error_message: undefined,
        generation_revision: readNonNegativeInteger(job.input_snapshot?.generation_revision)
          ?? clip.generation_revision,
        job_id: job.id,
        status: "WAITING_PROVIDER",
      });
    }

    await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips: stagedClips,
      componentId: params.componentId,
      voiceClips: originalVoiceClips,
    });
    const refreshed = await this.refreshSceneClipStatuses({
      componentId: params.componentId,
      createdBy: params.createdBy,
      organizationId: params.organizationId,
    });
    const recoveredClips = refreshed.clips;
    const recoveredVoiceClips = refreshed.voiceClips;

    let metadataBackfillCount = 0;
    for (const clip of recoveredClips) {
      if (!clip.job_id || !clip.asset_name) continue;
      const [videoAsset, voiceAsset] = await Promise.all([
        this.findSceneAvatarVideoAsset(clip.job_id),
        this.repository.findVoiceAudioAssetByJob(clip.job_id),
      ]);
      for (const asset of [videoAsset, voiceAsset]) {
        if (!asset) continue;
        if (await this.repository.backfillGeneratedAssetDisplayName({
          asset,
          displayName: clip.asset_name,
        })) metadataBackfillCount += 1;
      }
    }

    const originallyCompleted = new Set(
      originalClips.filter(hasCompletedAvatarMedia).map((clip) => clip.id),
    );
    const originalCompletedVoices = new Set(
      originalVoiceClips.filter(hasCompletedVoiceMedia).map((clip) => clip.clip_id),
    );
    const report: HeygenHistoricalSceneRecoveryReport = {
      alreadyAvailableAvatarCount: originallyCompleted.size,
      matchedJobCount,
      importedHistoricalAvatarCount,
      pendingAvatarCount: recoveredClips.filter((clip) => clip.status === "WAITING_PROVIDER").length,
      recoveredAvatarCount: recoveredClips.filter((clip) => (
        hasCompletedAvatarMedia(clip) && !originallyCompleted.has(clip.id)
      )).length,
      recoveredVoiceCount: recoveredVoiceClips.filter((clip) => (
        hasCompletedVoiceMedia(clip) && !originalCompletedVoices.has(clip.clip_id)
      )).length,
      renamedAssetCount: renamedAssetCount + metadataBackfillCount,
      skipped,
      unresolvedSceneCount: recoveredClips.filter((clip) => (
        !clip.deleted && !hasCompletedAvatarMedia(clip) && clip.status !== "WAITING_PROVIDER"
      )).length,
    };

    return {
      clips: recoveredClips,
      report,
      voiceClips: recoveredVoiceClips,
    };
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

    const currentAssets = await this.readComponentAssets(params.componentId);
    const currentClips = sortClips(currentAssets.avatar_clips || params.clips);
    const selectedIds = new Set(params.clipIds);
    if (!currentClips.some((clip) => selectedIds.has(clip.id) && !clip.deleted)) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar.");
    }

    const queuedClips = currentClips.filter((clip) => !clip.deleted).map((clip) => {
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
    const assets = await this.mergeSceneClipPatch({
      assetsPatch: { avatar_generation_mode: "scene_clips" },
      avatarClips: queuedClips.filter((clip) => selectedIds.has(clip.id)),
      componentId: params.componentId,
    });
    return {
      clips: sortClips(assets.avatar_clips || queuedClips),
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
    const assets = await this.mergeSceneClipPatch({
      assetsPatch: { avatar_generation_mode: "scene_clips" },
      avatarClips: clips.filter((clip) => selectedIds.has(clip.id)),
      componentId: params.componentId,
    });
    return { clips: sortClips(assets.avatar_clips || clips), voiceClips: assets.voice_clips || [] };
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

    const materialAssets = await this.mergeSceneClipPatch({
      assetsPatch: { avatar_generation_mode: "scene_clips" },
      avatarClips: clips.filter((clip) => selectedIds.has(clip.id)),
      componentId: params.componentId,
      voiceClips: voiceClips.filter((clip) => selectedIds.has(clip.clip_id)),
    });
    return {
      clips: sortClips(materialAssets.avatar_clips || clips),
      jobs,
      voiceClips: materialAssets.voice_clips || [],
    };
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

    const currentAssets = await this.readComponentAssets(context.componentId);
    const authoritativeClips = sortClips(
      (currentAssets.avatar_clips || params.options.clips).filter((clip) => !clip.deleted),
    );
    const selectedIds = new Set(params.options.clipIds);
    const selectedClips = authoritativeClips.filter(
      (clip) => selectedIds.has(clip.id) && !clip.deleted,
    );
    if (selectedClips.length === 0) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar.");
    }

    await this.assertAvatarGenerationPreflight({
      clipIds: params.options.clipIds,
      clips: authoritativeClips,
      componentId: params.options.componentId,
      engine: params.options.engine,
      speed: params.options.speed,
    });

    const jobs: HeygenSceneClipJobResult[] = [];
    let clips = authoritativeClips;
    let voiceClips = reconcileVoiceClips(
      currentAssets.voice_clips || [],
      clips,
    );
    await this.saveSceneClips({
      avatarGenerationMode: "scene_clips",
      clips,
      componentId: context.componentId,
      preserveConcurrentGenerationProgress: true,
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
        selectPromotableAvatarVoices(batchResults),
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

      const materialAssets = await this.mergeSceneClipPatch({
        assetsPatch: { avatar_generation_mode: "scene_clips" },
        avatarClips: clips.filter((clip) => batch.some((entry) => entry.id === clip.id)),
        componentId: context.componentId,
        voiceClips: selectPromotableAvatarVoices(batchResults),
      });
      clips = sortClips(materialAssets.avatar_clips || clips);
      voiceClips = reconcileVoiceClips(materialAssets.voice_clips || voiceClips, clips);
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

    const currentAssets = await this.readComponentAssets(context.componentId);
    const authoritativeClips = sortClips(
      (currentAssets.avatar_clips || params.options.clips).filter((clip) => !clip.deleted),
    );
    const selectedIds = new Set(params.options.clipIds);
    const selectedClips = authoritativeClips.filter((clip) => selectedIds.has(clip.id));
    if (selectedClips.length === 0) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar voz.");
    }

    let clips = authoritativeClips;
    let voiceClips = reconcileVoiceClips(
      currentAssets.voice_clips || [],
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
      const materialAssets = await this.mergeSceneClipPatch({
        assetsPatch: { avatar_generation_mode: "scene_clips" },
        avatarClips: clips.filter((clip) => batch.some((entry) => entry.id === clip.id)),
        componentId: context.componentId,
        voiceClips: results.flatMap((result) => result.voiceClip ? [result.voiceClip] : []),
      });
      clips = sortClips(materialAssets.avatar_clips || clips);
      voiceClips = reconcileVoiceClips(materialAssets.voice_clips || voiceClips, clips);
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
      const assetNames = buildHeygenSceneAssetNames({
        clip: params.clip,
        context: params.context,
      });
      const jobInput = {
        asset_display_name: assetNames.displayName,
        audio_file_stem: assetNames.audioFileStem,
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

      const persistedJob = await this.repository.getProductionJob({ jobId: job.id, organizationId: params.organizationId });
      if (!persistedJob) throw new HeygenScenesServiceError("No se pudo recuperar el job de voz.", 500);
      const voiceAsset = await this.audioImportService.resolveVoiceAsset({
        createdBy: params.createdBy,
        generateSpeech: () => this.client.generateSpeech({
          locale: params.options.locale,
          speed: params.options.speed,
          text: params.clip.script_text,
          voice_id: voice.heygen_voice_id,
        }),
        job: persistedJob,
        scriptHash,
        voiceProviderId: voice.heygen_voice_id,
      });
      if (job.status !== PRODUCTION_JOB_STATUSES.SUCCEEDED) {
        await this.repository.markVideoJobSucceeded({
          durationSeconds: voiceAsset.durationSeconds,
          jobId: job.id,
          outputSnapshot: {
            audio_asset_id: voiceAsset.id,
            duration_seconds: voiceAsset.durationSeconds,
            generation_target: "voice_only",
            provider_request_id: voiceAsset.providerRequestId,
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

  async recoverCompletedSceneAssets(params: {
    componentId: string;
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

    const { data: component, error: componentError } = await this.supabase
      .from("material_components")
      .select("content, assets")
      .eq("id", params.componentId)
      .single();
    if (componentError) throw componentError;
    const currentAssets = isRecord(component?.assets)
      ? component.assets as MaterialAssets
      : {};
    const currentClips = sortClips(currentAssets.avatar_clips || []);
    const clips = this.buildSceneClips({
      componentContent: component?.content,
      existingClips: currentClips,
    });
    if (clips.length === 0) return currentAssets;

    const jobs = await this.repository.listRecoverableSceneMediaJobs(params);
    const currentVoiceByClipId = new Map(
      (currentAssets.voice_clips || []).map((clip) => [clip.clip_id, clip]),
    );
    const recoveredAvatarClipIds = new Set(clips.flatMap((clip) => (
      clip.status === "COMPLETED"
      && Boolean(clip.storage_path)
      && clip.script_hash === hashText(clip.script_text)
        ? [clip.id]
        : []
    )));
    const recoveredVoiceClipIds = new Set(clips.flatMap((clip) => {
      const voice = currentVoiceByClipId.get(clip.id);
      return voice?.status === "COMPLETED"
        && Boolean(voice.storage_path)
        && voice.script_hash === hashText(clip.script_text)
        ? [clip.id]
        : [];
    }));
    const currentClipIds = new Set(currentClips.map((clip) => clip.id));
    const avatarPatches = new Map(
      clips
        .filter((clip) => !currentClipIds.has(clip.id))
        .map((clip) => [clip.id, clip]),
    );
    const voicePatches: VoiceClip[] = [];

    const voiceJobGroups = [
      jobs.filter((job) => job.job_type === PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER),
      jobs.filter((job) => (
        job.job_type === PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP
        && job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED
      )),
    ];
    for (const voiceJobs of voiceJobGroups) {
      const recoverableVoiceJobs = selectRecoverableHistoricalSceneJobsForClips(clips, voiceJobs);
      for (const [clipId, job] of recoverableVoiceJobs) {
        if (recoveredVoiceClipIds.has(clipId)) continue;
        const clip = clips.find((candidate) => candidate.id === clipId && !candidate.deleted);
        if (!clip) continue;
        const scriptHash = hashText(clip.script_text);
        const voiceProviderId = readString(job.input_snapshot?.voice_provider_id);
        const speechCheckpoint = parseHeygenSpeechCheckpoint(job.output_snapshot);
        let voiceAsset = await this.audioImportService.findImportedVoice(job.id);
        if (!voiceAsset && voiceProviderId) {
          voiceAsset = await this.audioImportService.recoverUploadedVoice({
            job,
            scriptHash,
            speech: speechCheckpoint,
            voiceProviderId,
          });
        }
        if (!voiceAsset && voiceProviderId && speechCheckpoint) {
          try {
            voiceAsset = await this.audioImportService.importGeneratedSpeech({
              job,
              scriptHash,
              speech: speechCheckpoint,
              voiceProviderId,
            });
          } catch (error) {
            console.warn("[HeyGen voice recovery] Historical provider URL is no longer importable", {
              jobId: job.id,
              message: error instanceof Error ? error.message : String(error),
            });
          }
        }
        if (!voiceAsset) continue;
        recoveredVoiceClipIds.add(clipId);
        voicePatches.push(toVoiceClip({ asset: voiceAsset, clip, scriptHash }));
      }
    }

    const avatarJobs = selectRecoverableHistoricalSceneJobsForClips(
      clips,
      jobs.filter((job) => (
        job.job_type === PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP
        && job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED
      )),
    );
    for (const [clipId, job] of avatarJobs) {
      const clip = clips.find((candidate) => candidate.id === clipId && !candidate.deleted);
      if (!clip) continue;
      const scriptHash = hashText(clip.script_text);
      if (!recoveredAvatarClipIds.has(clipId)) {
        const avatarAsset = await this.findSceneAvatarVideoAsset(job.id);
        if (avatarAsset?.public_url && avatarAsset.storage_path) {
          recoveredAvatarClipIds.add(clipId);
          avatarPatches.set(clip.id, {
            ...clip,
            duration: preciseAssetDuration(avatarAsset) || job.duration_seconds || clip.duration,
            external_id: job.provider_job_id || clip.external_id,
            file_name: avatarAsset.storage_path.split("/").at(-1) || clip.file_name,
            has_audio: false,
            job_id: job.id,
            provider: PRODUCTION_PROVIDERS.HEYGEN,
            public_url: avatarAsset.public_url,
            script_hash: scriptHash,
            status: "COMPLETED",
            storage_path: avatarAsset.storage_path,
          });
        }
      }
    }

    if (avatarPatches.size === 0 && voicePatches.length === 0) return currentAssets;
    return this.mergeSceneClipPatch({
      assetsPatch: { avatar_generation_mode: "scene_clips" },
      avatarClips: [...avatarPatches.values()],
      componentId: params.componentId,
      voiceClips: voicePatches,
    });
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

    await this.recoverCompletedSceneAssets({
      componentId: params.componentId,
      organizationId: params.organizationId,
    });
    const currentAssets = await this.readComponentAssets(params.componentId);
    const originalClips = sortClips(currentAssets.avatar_clips || []);
    const originalVoiceClips = reconcileVoiceClips(currentAssets.voice_clips || [], originalClips);
    let clips = originalClips;
    let voiceClips = originalVoiceClips;
    const voiceClipIdsToRemove = new Set<string>();

    for (const clip of clips) {
      if (clip.status === "FAILED" && clip.job_id) {
        const provisionalVoice = await this.audioImportService.findImportedVoice(clip.job_id);
        const leakedVoice = provisionalVoice
          ? voiceClips.find((voiceClip) => (
              voiceClip.clip_id === clip.id && voiceClip.asset_id === provisionalVoice.id
            ))
          : undefined;
        if (provisionalVoice && leakedVoice) {
          await this.discardFailedAvatarVoice({ asset: provisionalVoice, clipId: clip.id });
          voiceClipIdsToRemove.add(clip.id);
          voiceClips = voiceClips.filter((voiceClip) => voiceClip !== leakedVoice);
          clips = replaceClip(clips, clip.id, {
            ...clip,
            voice_error_message: undefined,
            voice_status: "DRAFT",
          });
        }
        continue;
      }
      if (clip.status !== "WAITING_PROVIDER" || !clip.job_id) continue;

      const job = await this.repository.getProductionJob({
        jobId: clip.job_id,
        organizationId: params.organizationId,
      });
      if (!job) continue;

      const scriptHash = readString(job.input_snapshot?.script_hash) || hashText(clip.script_text);
      const materialVoice = getReusableSceneVoiceAsset(
        voiceClips.find((voiceClip) => voiceClip.clip_id === clip.id),
        scriptHash,
      );
      const provisionalVoice = await this.audioImportService.findImportedVoice(job.id);
      const importedVoice = materialVoice || provisionalVoice;
      const requestSnapshot = toRecord(job.output_snapshot?.request);
      const voiceAudioReused = requestSnapshot?.voice_audio_reused === true
        || Boolean(materialVoice && (!provisionalVoice || materialVoice.id !== provisionalVoice.id));

      if (job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED) {
        const existingAsset = await this.findSceneAvatarVideoAsset(job.id);
        if (existingAsset?.public_url && existingAsset.storage_path) {
          if (importedVoice) {
            voiceClips = upsertVoiceClips(voiceClips, [
              toVoiceClip({ asset: importedVoice, clip, scriptHash }),
            ]);
          }
          clips = replaceClip(clips, clip.id, {
            ...clip,
            duration: job.duration_seconds || clip.duration,
            file_name: existingAsset.storage_path.split("/").at(-1) || clip.file_name,
            public_url: existingAsset.public_url,
            has_audio: importedVoice ? false : clip.has_audio,
            script_hash: scriptHash,
            storage_path: existingAsset.storage_path,
            status: "COMPLETED",
          });
          continue;
        }
        // A worker can finish importing and mark the provider job before the
        // material JSON is promoted. If the registry row was lost/archived,
        // query HeyGen again and rebuild the local MP4 instead of leaving the
        // scene permanently represented only by its separated voice track.
      }

      if (job.status === PRODUCTION_JOB_STATUSES.FAILED) {
        if (provisionalVoice && !voiceAudioReused) {
          await this.discardFailedAvatarVoice({
            asset: provisionalVoice,
            clipId: clip.id,
          });
          voiceClipIdsToRemove.add(clip.id);
          voiceClips = voiceClips.filter((voiceClip) => (
            voiceClip.clip_id !== clip.id || voiceClip.asset_id !== provisionalVoice.id
          ));
        }
        clips = replaceClip(clips, clip.id, {
          ...clip,
          ...(provisionalVoice && !voiceAudioReused
            ? { voice_error_message: undefined, voice_status: "DRAFT" as const }
            : {}),
          status: "FAILED",
        });
        continue;
      }

      const providerJobId = job.provider_job_id
        || readProviderJobId(job.output_snapshot)
        || clip.external_id;
      if (!providerJobId) continue;
      if (!job.provider_job_id) {
        await this.repository.restoreProviderJobId({ jobId: job.id, providerJobId });
        job.provider_job_id = providerJobId;
      }

      let video;
      try {
        video = await this.client.getVideo(providerJobId);
      } catch (error) {
        // A transient failure for one provider video must not prevent the
        // remaining completed scenes from reaching the editor.
        console.warn("[HeyGen scene clips] Could not refresh one provider clip:", {
          clipId: clip.id,
          componentId: params.componentId,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
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
        if (provisionalVoice && !voiceAudioReused) {
          await this.discardFailedAvatarVoice({
            asset: provisionalVoice,
            clipId: clip.id,
          });
          voiceClipIdsToRemove.add(clip.id);
          voiceClips = voiceClips.filter((voiceClip) => (
            voiceClip.clip_id !== clip.id || voiceClip.asset_id !== provisionalVoice.id
          ));
        }
        clips = replaceClip(clips, clip.id, {
          ...clip,
          error_message: video.failureMessage || "HeyGen marco el clip como fallido.",
          ...(provisionalVoice && !voiceAudioReused
            ? { voice_error_message: undefined, voice_status: "DRAFT" as const }
            : {}),
          status: "FAILED",
        });
        continue;
      }

      if (providerStatus !== HEYGEN_VIDEO_STATUSES.COMPLETED) {
        continue;
      }

      let imported;
      try {
        imported = await this.importService.importCompletedClipVideo({
          createdBy: params.createdBy || null,
          job,
          video,
        });
      } catch (error) {
        console.warn("[HeyGen scene clips] Could not import one completed clip:", {
          clipId: clip.id,
          componentId: params.componentId,
          message: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

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

      if (importedVoice) {
        voiceClips = upsertVoiceClips(voiceClips, [
          toVoiceClip({ asset: importedVoice, clip, scriptHash }),
        ]);
      }

      clips = replaceClip(clips, clip.id, {
        ...clip,
        duration: video.durationSeconds || clip.duration,
        external_id: video.videoId,
        file_name: imported.asset.storagePath.split("/").at(-1) || clip.file_name,
        has_audio: importedVoice ? false : true,
        public_url: imported.asset.publicUrl,
        storage_path: imported.asset.storagePath,
        script_hash: scriptHash,
        status: "COMPLETED",
      });
    }

    const removedVoiceClipIds = originalVoiceClips
      .filter((original) => !voiceClips.some((clip) => clip.clip_id === original.clip_id))
      .map((clip) => clip.clip_id);
    const materialAssets = await this.mergeSceneClipPatch({
      assetsPatch: { avatar_generation_mode: "scene_clips" },
      avatarClips: changedAvatarClips(originalClips, clips),
      componentId: params.componentId,
      removeVoiceClipIds: [...new Set([...removedVoiceClipIds, ...voiceClipIdsToRemove])],
      voiceClips: changedVoiceClips(originalVoiceClips, voiceClips),
    });

    return {
      clips: sortClips(materialAssets.avatar_clips || clips),
      materialAssets,
      voiceClips: materialAssets.voice_clips || voiceClips,
    };
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
    const assetNames = buildHeygenSceneAssetNames({
      clip: params.clip,
      context: params.context,
    });
    const jobInput = {
      asset_display_name: assetNames.displayName,
      audio_file_stem: assetNames.audioFileStem,
      avatar_preset_id: avatar.id,
      background: params.clip.background || null,
      clip_id: params.clip.id,
      component_id: params.context.componentId,
      component_type: params.context.componentType,
      engine: params.options.engine,
      generation_revision: params.clip.generation_revision ?? 0,
      job_type: PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
      output_format: params.options.outputFormat,
      scene_order: params.clip.order,
      script_hash: scriptHash,
      separate_tracks: true,
      video_file_stem: assetNames.videoFileStem,
      video_title: assetNames.videoTitle,
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

    const reusableVoiceAsset = getReusableSceneVoiceAsset(params.existingVoiceClip, scriptHash);
    const voiceAudioReused = Boolean(reusableVoiceAsset);
    let voiceAsset = reusableVoiceAsset;
    if (!voiceAsset) {
      try {
        voiceAsset = await this.audioImportService.resolveVoiceAsset({
          createdBy: params.createdBy,
          generateSpeech: () => this.client.generateSpeech({
            locale: params.options.locale,
            speed: params.options.speed,
            text: params.clip.script_text,
            voice_id: providerVoiceId,
          }),
          job: persistedJob,
          scriptHash,
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
      title: buildCorrelatedHeygenVideoTitle(assetNames.videoTitle, job.id),
    });
    let createdVideo;
    try {
      createdVideo = await this.client.createAvatarVideo(requestPayload, job.id);
    } catch (error) {
      await this.repository.markVideoJobFailed({
        errorPayload: buildCreateFailurePayload(error, requestPayload, params.clip),
        jobId: job.id,
      });
      if (!voiceAudioReused) {
        await this.audioImportService.discardImportedVoice(voiceAsset).catch((cleanupError) => {
          console.error("[HeyGen scene clips] Could not discard provisional voice:", {
            assetId: voiceAsset.id,
            clipId: params.clip.id,
            message: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        });
      }

      return {
        clipId: params.clip.id,
        errorMessage: error instanceof Error ? error.message : String(error),
        jobId: job.id,
        providerJobId: null,
        status: PRODUCTION_JOB_STATUSES.FAILED,
      };
    }

    try {
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
          voice_audio_reused: voiceAudioReused,
        },
      });
    } catch (persistenceError) {
      // HeyGen already accepted the video. Keep its id in the material clip so
      // polling can continue; the correlated remote title repairs the job row
      // on the next historical recovery even if this worker now terminates.
      console.error("[HeyGen scene clips] Provider video accepted but job persistence failed", {
        clipId: params.clip.id,
        event: "heygen_provider_video_unlinked",
        jobId: job.id,
        message: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
        providerJobId: createdVideo.videoId,
      });
    }

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
    const assetNames = buildHeygenSceneAssetNames({
      clip: params.clip,
      context: params.context,
    });
    const jobInput = {
      asset_display_name: assetNames.displayName,
      audio_file_stem: assetNames.audioFileStem,
      clip_id: params.clip.id,
      component_id: params.context.componentId,
      component_type: params.context.componentType,
      generation_revision: params.clip.generation_revision ?? 0,
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

    let voiceAsset;
    try {
      await markProductionJobRunning({ jobId: job.id, supabase: this.supabase });
      voiceAsset = await this.audioImportService.resolveVoiceAsset({
        createdBy: params.createdBy,
        generateSpeech: () => this.client.generateSpeech({
          speed: params.clip.voice_speed ?? 1,
          text: params.clip.script_text,
          voice_id: voice.heygen_voice_id,
        }),
        job: persistedJob,
        scriptHash,
        voiceProviderId: voice.heygen_voice_id,
      });
    } catch (error) {
      await failProductionJob({ error, jobId: job.id, supabase: this.supabase });
      throw error;
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

  async assertAvatarGenerationPreflight(params: {
    clipIds: string[];
    clips: AvatarClip[];
    componentId: string;
    engine: HeygenAvatarVideoEngine;
    speed: number;
  }) {
    const selectedIds = new Set(params.clipIds);
    const selectedClips = params.clips.filter(
      (clip) => selectedIds.has(clip.id) && !clip.deleted,
    );
    if (selectedClips.length === 0) {
      throw new HeygenScenesServiceError("Selecciona al menos una escena para generar.");
    }

    const [account, currentAssets] = await Promise.all([
      this.client.getCurrentUser(),
      this.readComponentAssets(params.componentId),
    ]);
    const budget = estimateHeygenAvatarGenerationBudget({
      account,
      clips: selectedClips,
      engine: params.engine,
      speed: params.speed,
      voiceClips: currentAssets.voice_clips || [],
    });
    if (budget.available !== null && budget.available + Number.EPSILON < budget.estimatedCost) {
      const unitLabel = budget.unit === "usd" ? "USD" : "créditos";
      throw new HeygenScenesServiceError(
        `HeyGen no tiene saldo suficiente para generar los videos seleccionados. Disponible: ${budget.available.toFixed(2)} ${unitLabel}; estimado: ${budget.estimatedCost.toFixed(2)} ${unitLabel} para ${budget.estimatedDurationSeconds}s. No se generó audio ni video.`,
        402,
      );
    }

    return budget;
  }

  private async restoreProviderIdsFromHeygenCatalog(
    jobs: HeygenProductionJobRow[],
    skipped: string[],
  ) {
    const missingProviderId = jobs.filter((job) => (
      !job.provider_job_id && !readProviderJobId(job.output_snapshot)
    ));
    if (missingProviderId.length === 0) return jobs;

    const missingByJobId = new Map(missingProviderId.map((job) => [job.id.toLowerCase(), job]));
    const catalog = await this.client.listAllVideos();
    const recoveredProviderIds = new Map<string, string>();
    for (const video of catalog.data) {
      const jobId = readHeygenJobIdFromVideoTitle(video.title);
      if (!jobId || !missingByJobId.has(jobId) || recoveredProviderIds.has(jobId)) continue;
      recoveredProviderIds.set(jobId, video.videoId);
    }

    for (const [jobId, providerJobId] of recoveredProviderIds) {
      await this.repository.restoreProviderJobId({ jobId, providerJobId });
    }
    if (catalog.hasMore) {
      skipped.push("El catálogo de HeyGen superó el límite de seguridad de 1,000 videos; algunos jobs huérfanos podrían requerir revisión manual.");
    }

    return jobs.map((job) => {
      const providerJobId = recoveredProviderIds.get(job.id.toLowerCase());
      return providerJobId ? { ...job, provider_job_id: providerJobId } : job;
    });
  }

  private async findSceneAvatarVideoAsset(jobId: string) {
    const sceneAsset = await this.repository.findAvatarVideoAssetByJob(
      jobId,
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO_CLIP,
    );
    if (sceneAsset) return sceneAsset;
    // Early scene generations were registered as AVATAR_VIDEO before the
    // dedicated clip type existed. Reuse that file instead of downloading a
    // duplicate from HeyGen.
    return this.repository.findAvatarVideoAssetByJob(
      jobId,
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
    );
  }

  private async importHistoricalAvatarJobs(params: {
    createdBy?: string | null;
    jobs: HeygenProductionJobRow[];
    skipped: string[];
  }) {
    let importedCount = 0;
    for (const job of params.jobs) {
      const providerJobId = job.provider_job_id || readProviderJobId(job.output_snapshot);
      if (!providerJobId) continue;
      const existing = await this.findSceneAvatarVideoAsset(job.id);
      if (existing?.public_url && existing.storage_path) continue;

      try {
        const video = await this.client.getVideo(providerJobId);
        const providerStatus = video.status.toLowerCase();
        if (providerStatus === HEYGEN_VIDEO_STATUSES.FAILED) {
          await this.repository.markVideoJobFailed({
            errorPayload: {
              failure_code: video.failureCode || null,
              failure_message: video.failureMessage || "HeyGen marcó el clip histórico como fallido.",
              provider_status: video.status,
            },
            jobId: job.id,
          });
          continue;
        }
        if (providerStatus !== HEYGEN_VIDEO_STATUSES.COMPLETED) continue;

        const imported = await this.importService.importCompletedClipVideo({
          createdBy: params.createdBy || null,
          job: { ...job, provider_job_id: providerJobId },
          video,
        });
        await this.repository.markVideoJobSucceeded({
          durationSeconds: video.durationSeconds || null,
          jobId: job.id,
          outputSnapshot: {
            asset: imported.asset,
            duration_seconds: video.durationSeconds || null,
            historical_recovery: true,
            provider_job_id: providerJobId,
            provider_status: video.status,
            video_id: video.videoId,
          },
        });
        importedCount += 1;
      } catch (error) {
        params.skipped.push(
          `Job ${job.id.slice(0, 8)}: no se pudo importar su video histórico (${error instanceof Error ? error.message : String(error)}).`,
        );
      }
    }
    return importedCount;
  }

  private async archiveResetProductionAssets(params: {
    assetIds: string[];
    componentId: string;
    jobIds: string[];
    organizationId: string;
  }) {
    const archivedAt = new Date().toISOString();
    const uniqueAssetIds = [...new Set(params.assetIds)];
    const uniqueJobIds = [...new Set(params.jobIds)];
    const archiveBy = async (column: "id" | "production_job_id", ids: string[]) => {
      if (ids.length === 0) return;
      const { error } = await this.supabase
        .from("production_assets")
        .update({
          qa_status: PRODUCTION_QA_STATUSES.ARCHIVED,
          updated_at: archivedAt,
        })
        .eq("organization_id", params.organizationId)
        .eq("material_component_id", params.componentId)
        .in(column, ids);
      if (error) throw error;
    };

    await archiveBy("id", uniqueAssetIds);
    await archiveBy("production_job_id", uniqueJobIds);
  }

  private async discardFailedAvatarVoice(params: {
    asset: HeygenImportedVoiceAsset;
    clipId: string;
  }) {
    await this.audioImportService.discardImportedVoice(params.asset).catch((error) => {
      console.error("[HeyGen scene clips] Could not discard failed avatar voice:", {
        assetId: params.asset.id,
        clipId: params.clipId,
        message: error instanceof Error ? error.message : String(error),
      });
    });
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

  private async mergeSceneClipPatch(params: {
    assetsPatch?: Partial<MaterialAssets>;
    avatarClips?: AvatarClip[];
    componentId: string;
    preserveAuthoredFields?: boolean;
    removeAvatarClipIds?: string[];
    removeVoiceClipIds?: string[];
    voiceClips?: VoiceClip[];
  }): Promise<MaterialAssets> {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase.rpc(
      "merge_material_component_scene_assets",
      {
        p_assets_patch: {
          ...(params.assetsPatch || {}),
          final_video_assembly_stale: true,
          final_video_layout_stale: true,
          updated_at: now,
        },
        p_avatar_clips: params.avatarClips || [],
        p_component_id: params.componentId,
        p_preserve_authored_fields: params.preserveAuthoredFields ?? true,
        p_remove_avatar_clip_ids: params.removeAvatarClipIds || [],
        p_remove_voice_clip_ids: params.removeVoiceClipIds || [],
        p_voice_clips: params.voiceClips || [],
      },
    );
    if (error) throw error;
    return data && typeof data === "object" ? data as MaterialAssets : {};
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
  title?: string;
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
    title: params.title || params.clip.asset_name || `Avatar ${params.clip.order}`,
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

export function mergeAuthoredSceneClip(existing: AvatarClip | undefined, incoming: AvatarClip) {
  if (!existing) return incoming;
  const scriptChanged = existing.script_text !== incoming.script_text;
  const generatedState = {
    duration: existing.duration,
    error_message: existing.error_message,
    external_id: existing.external_id,
    file_name: existing.file_name,
    generation_revision: scriptChanged
      ? (existing.generation_revision ?? 0) + 1
      : existing.generation_revision,
    has_audio: existing.has_audio,
    job_id: existing.job_id,
    provider: existing.provider,
    public_url: existing.public_url,
    script_hash: existing.script_hash,
    status: scriptChanged && ["COMPLETED", "WAITING_PROVIDER"].includes(existing.status)
      ? "STALE" as const
      : existing.status,
    storage_path: existing.storage_path,
    voice_error_message: existing.voice_error_message,
    voice_status: scriptChanged && ["COMPLETED", "WAITING_PROVIDER"].includes(existing.voice_status || "")
      ? "STALE" as const
      : existing.voice_status,
  };
  return {
    ...incoming,
    ...generatedState,
  };
}

function changedAvatarClips(previous: AvatarClip[], next: AvatarClip[]) {
  const previousById = new Map(previous.map((clip) => [clip.id, clip]));
  return next.filter((clip) => !sameSceneValue(previousById.get(clip.id), clip));
}

function changedVoiceClips(previous: VoiceClip[], next: VoiceClip[]) {
  const previousById = new Map(previous.map((clip) => [clip.clip_id, clip]));
  return next.filter((clip) => !sameSceneValue(previousById.get(clip.clip_id), clip));
}

function sameSceneValue(left: AvatarClip | VoiceClip | undefined, right: AvatarClip | VoiceClip) {
  return Boolean(left) && JSON.stringify(left) === JSON.stringify(right);
}

/** Selects the newest usable historical generation for each scene. */
export function selectRecoverableHistoricalSceneJobs(jobs: HeygenProductionJobRow[]) {
  const selected = new Map<string, HeygenProductionJobRow>();
  for (const job of jobs) {
    const clipId = readString(job.input_snapshot?.clip_id);
    if (!clipId || selected.has(clipId)) continue;
    const hasProviderVideo = Boolean(job.provider_job_id || readProviderJobId(job.output_snapshot));
    if (job.status !== PRODUCTION_JOB_STATUSES.SUCCEEDED && !hasProviderVideo) continue;
    selected.set(clipId, job);
  }
  return selected;
}

function hasCompletedAvatarMedia(clip: AvatarClip) {
  return clip.status === "COMPLETED" && Boolean(clip.public_url && clip.storage_path);
}

function hasCompletedVoiceMedia(clip: VoiceClip) {
  return clip.status === "COMPLETED" && Boolean(clip.public_url && clip.storage_path);
}

function readNonNegativeInteger(value: unknown) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const AVATAR_PROGRESS_KEYS = [
  "duration", "error_message", "external_id", "file_name", "generation_revision", "has_audio",
  "job_id", "provider", "public_url", "script_hash", "status", "storage_path",
] as const;
const VOICE_PROGRESS_KEYS = ["voice_error_message", "voice_status"] as const;

/** Prevents overlapping workers and provider polling from replacing newer scene results. */
export function mergeSceneClipsForConcurrentGeneration(
  currentClips: AvatarClip[],
  incomingClips: AvatarClip[],
) {
  const currentById = new Map(currentClips.map((clip) => [clip.id, clip]));
  const incomingById = new Map(incomingClips.map((clip) => [clip.id, clip]));
  const orderedIds = [
    ...incomingClips.map((clip) => clip.id),
    ...currentClips.map((clip) => clip.id).filter((id) => !incomingById.has(id)),
  ];

  return sortClips(orderedIds.flatMap((id) => {
    const current = currentById.get(id);
    const incoming = incomingById.get(id);
    if (!current) return incoming ? [incoming] : [];
    if (!incoming) return [current];

    // The stored scene owns the latest authored fields; only provider progress
    // is selected by revision and lifecycle state from the worker snapshot.
    const merged: AvatarClip = { ...incoming, ...current };
    copyProgressFields(merged, chooseAvatarProgressWinner(current, incoming), AVATAR_PROGRESS_KEYS);
    copyProgressFields(merged, chooseVoiceProgressWinner(current, incoming), VOICE_PROGRESS_KEYS);
    return [merged];
  }));
}

function mergeVoiceClipsForConcurrentGeneration(params: {
  current: VoiceClip[];
  incoming: VoiceClip[];
  removeClipIds: string[];
}) {
  const removed = new Set(params.removeClipIds);
  const currentByClipId = new Map(params.current.map((clip) => [clip.clip_id, clip]));
  const incomingByClipId = new Map(params.incoming.map((clip) => [clip.clip_id, clip]));
  const clipIds = new Set([...currentByClipId.keys(), ...incomingByClipId.keys()]);
  return [...clipIds].flatMap((clipId) => {
    if (removed.has(clipId)) return [];
    const current = currentByClipId.get(clipId);
    const incoming = incomingByClipId.get(clipId);
    if (!current) return incoming ? [incoming] : [];
    if (!incoming) return [current];
    if (current.status === "COMPLETED" && incoming.status !== "COMPLETED") return [current];
    if (incoming.status === "COMPLETED" && current.status !== "COMPLETED") return [incoming];
    return [current];
  }).sort((left, right) => left.order - right.order);
}

function chooseAvatarProgressWinner(current: AvatarClip, incoming: AvatarClip) {
  const currentRevision = current.generation_revision ?? 0;
  const incomingRevision = incoming.generation_revision ?? 0;
  if (currentRevision !== incomingRevision) return currentRevision > incomingRevision ? current : incoming;
  const currentRank = sceneProgressRank(current.status);
  const incomingRank = sceneProgressRank(incoming.status);
  if (currentRank !== incomingRank) return currentRank > incomingRank ? current : incoming;
  if (current.job_id && !incoming.job_id) return current;
  if (incoming.job_id && !current.job_id) return incoming;
  return current;
}

/**
 * Matches generated media to the current storyboard without trusting a
 * positional scene id after content regeneration. A legacy job without a
 * script hash may still use its original id; hashed jobs must match the exact
 * current narration and are remapped only when that hash is unique.
 */
export function selectRecoverableHistoricalSceneJobsForClips(
  clips: AvatarClip[],
  jobs: HeygenProductionJobRow[],
) {
  const selected = new Map<string, HeygenProductionJobRow>();
  const clipsById = new Map(clips.map((clip) => [clip.id, clip]));
  const clipsByScriptHash = new Map<string, AvatarClip[]>();
  for (const clip of clips) {
    const scriptHash = hashText(clip.script_text);
    clipsByScriptHash.set(scriptHash, [...(clipsByScriptHash.get(scriptHash) || []), clip]);
  }

  for (const job of jobs) {
    const hasProviderVideo = Boolean(job.provider_job_id || readProviderJobId(job.output_snapshot));
    const mayHaveRecoverableVoice = job.job_type === PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER;
    if (
      job.status !== PRODUCTION_JOB_STATUSES.SUCCEEDED
      && !hasProviderVideo
      && !mayHaveRecoverableVoice
    ) continue;
    const originalClipId = readString(job.input_snapshot?.clip_id);
    if (!originalClipId) continue;
    const jobScriptHash = readString(job.input_snapshot?.script_hash);
    let targetClip: AvatarClip | undefined;
    if (jobScriptHash) {
      const originalClip = clipsById.get(originalClipId);
      if (originalClip && hashText(originalClip.script_text) === jobScriptHash) {
        targetClip = originalClip;
      } else {
        const matches = clipsByScriptHash.get(jobScriptHash) || [];
        if (matches.length === 1) targetClip = matches[0];
      }
    } else {
      targetClip = clipsById.get(originalClipId);
    }
    if (!targetClip || selected.has(targetClip.id)) continue;
    selected.set(targetClip.id, job);
  }
  return selected;
}

function chooseVoiceProgressWinner(current: AvatarClip, incoming: AvatarClip) {
  const currentRevision = current.generation_revision ?? 0;
  const incomingRevision = incoming.generation_revision ?? 0;
  if (currentRevision !== incomingRevision) return currentRevision > incomingRevision ? current : incoming;
  return sceneProgressRank(current.voice_status) >= sceneProgressRank(incoming.voice_status)
    ? current
    : incoming;
}

function sceneProgressRank(status: AvatarClip["status"] | AvatarClip["voice_status"] | undefined) {
  switch (status) {
    case "COMPLETED": return 5;
    case "FAILED": return 4;
    case "WAITING_PROVIDER": return 3;
    case "STALE": return 2;
    case "DRAFT": return 1;
    default: return 0;
  }
}

function copyProgressFields(
  target: AvatarClip,
  source: AvatarClip,
  keys: readonly (keyof AvatarClip)[],
) {
  const writableTarget = target as unknown as Record<string, unknown>;
  const readableSource = source as unknown as Record<string, unknown>;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      writableTarget[key] = readableSource[key];
    } else {
      delete writableTarget[key];
    }
  }
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

export function selectPromotableAvatarVoices(results: HeygenSceneClipJobResult[]) {
  return results.flatMap((result) => (
    result.status === PRODUCTION_JOB_STATUSES.SUCCEEDED && result.voiceClip
      ? [result.voiceClip]
      : []
  ));
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

function preciseAssetDuration(asset: {
  duration_milliseconds?: number | null;
  duration_seconds?: number | null;
}) {
  if (
    typeof asset.duration_milliseconds === "number"
    && Number.isFinite(asset.duration_milliseconds)
    && asset.duration_milliseconds > 0
  ) {
    return asset.duration_milliseconds / 1_000;
  }
  return typeof asset.duration_seconds === "number"
    && Number.isFinite(asset.duration_seconds)
    && asset.duration_seconds > 0
    ? asset.duration_seconds
    : undefined;
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
