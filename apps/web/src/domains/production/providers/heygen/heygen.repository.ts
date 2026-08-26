import type {
  HeygenAvatarPresetGenerationRow,
  HeygenAvatarLook,
  HeygenAvatarPresetRow,
  HeygenProductionAssetRow,
  HeygenProductionJobRow,
  HeygenSupabaseClient,
  HeygenVoice,
  HeygenVoicePresetGenerationRow,
  HeygenVoicePresetRow,
} from "./heygen.types";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  PRODUCTION_QA_STATUSES,
  type ProductionComponentContext,
} from "../../types/production.types";

export class HeygenRepository {
  constructor(private readonly supabase: HeygenSupabaseClient) {}

  async listAvatarPresets(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_avatar_presets")
      .select(
        [
          "id",
          "heygen_avatar_group_id",
          "heygen_avatar_look_id",
          "name",
          "avatar_type",
          "default_voice_id",
          "supported_api_engines",
          "preview_image_url",
          "preview_video_url",
          "status",
          "is_default",
          "synced_at",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .order("is_default", { ascending: false })
      .order("synced_at", { ascending: false, nullsFirst: false })
      .limit(100);

    if (error) throw error;
    return data || [];
  }

  async listVoicePresets(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_voice_presets")
      .select(
        [
          "id",
          "heygen_voice_id",
          "name",
          "language",
          "gender",
          "voice_type",
          "preview_audio_url",
          "is_default",
          "synced_at",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .order("is_default", { ascending: false })
      .order("synced_at", { ascending: false, nullsFirst: false })
      .limit(100);

    if (error) throw error;
    return data || [];
  }

  async markWorkspaceSyncSucceeded(organizationId: string, syncedAt: string) {
    const { error } = await this.supabase
      .from("heygen_workspace_connections")
      .upsert(
        {
          organization_id: organizationId,
          last_sync_error: null,
          last_sync_status: "SUCCEEDED",
          last_synced_at: syncedAt,
          updated_at: syncedAt,
        },
        { onConflict: "organization_id" },
      );

    if (error) throw error;
  }

  async markWorkspaceSyncFailed(params: {
    errorMessage: string;
    organizationId: string;
    syncedAt: string;
  }) {
    const { error } = await this.supabase
      .from("heygen_workspace_connections")
      .upsert(
        {
          organization_id: params.organizationId,
          last_sync_error: params.errorMessage.slice(0, 500),
          last_sync_status: "FAILED",
          last_synced_at: params.syncedAt,
          updated_at: params.syncedAt,
        },
        { onConflict: "organization_id" },
      );

    if (error) throw error;
  }

  async upsertAvatarPresets(params: {
    avatars: HeygenAvatarLook[];
    organizationId: string;
    syncedAt: string;
  }) {
    if (params.avatars.length === 0) return [];

    const rows = params.avatars.map((avatar) => ({
      avatar_type: avatar.avatarType || null,
      default_voice_id: avatar.defaultVoiceId || null,
      heygen_avatar_group_id: avatar.groupId || null,
      heygen_avatar_look_id: avatar.id,
      metadata: avatar.metadata,
      name: avatar.name,
      organization_id: params.organizationId,
      preview_image_url: avatar.previewImageUrl || null,
      preview_video_url: avatar.previewVideoUrl || null,
      status: avatar.status || null,
      supported_api_engines: avatar.supportedApiEngines,
      synced_at: params.syncedAt,
      updated_at: params.syncedAt,
    }));

    const { data, error } = await this.supabase
      .from("heygen_avatar_presets")
      .upsert(rows, {
        onConflict: "organization_id,heygen_avatar_look_id",
      })
      .select("id, heygen_avatar_look_id, default_voice_id, is_default");

    if (error) throw error;
    return (data || []) as HeygenAvatarPresetRow[];
  }

  async upsertVoicePresets(params: {
    organizationId: string;
    syncedAt: string;
    voices: HeygenVoice[];
  }) {
    if (params.voices.length === 0) return [];

    const rows = params.voices.map((voice) => ({
      gender: voice.gender || null,
      heygen_voice_id: voice.id,
      language: voice.language || null,
      metadata: voice.metadata,
      name: voice.name,
      organization_id: params.organizationId,
      preview_audio_url: voice.previewAudioUrl || null,
      synced_at: params.syncedAt,
      updated_at: params.syncedAt,
      voice_type: voice.type || null,
    }));

    const { data, error } = await this.supabase
      .from("heygen_voice_presets")
      .upsert(rows, {
        onConflict: "organization_id,heygen_voice_id",
      })
      .select("id, heygen_voice_id, is_default");

    if (error) throw error;
    return (data || []) as HeygenVoicePresetRow[];
  }

  async getDefaultAvatarPresetId(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_avatar_presets")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle();

    if (error) throw error;
    return typeof data?.id === "string" ? data.id : null;
  }

  async getAvatarPresetForGeneration(params: {
    organizationId: string;
    presetId?: string;
  }) {
    let query = this.supabase
      .from("heygen_avatar_presets")
      .select(
        [
          "id",
          "heygen_avatar_look_id",
          "name",
          "default_voice_id",
          "supported_api_engines",
          "is_default",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId);

    query = params.presetId
      ? query.eq("id", params.presetId)
      : query.eq("is_default", true);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return (data || null) as HeygenAvatarPresetGenerationRow | null;
  }

  async getVoicePresetForGeneration(params: {
    organizationId: string;
    presetId?: string;
  }) {
    let query = this.supabase
      .from("heygen_voice_presets")
      .select("id, heygen_voice_id, name, is_default")
      .eq("organization_id", params.organizationId);

    query = params.presetId
      ? query.eq("id", params.presetId)
      : query.eq("is_default", true);

    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    return (data || null) as HeygenVoicePresetGenerationRow | null;
  }

  async getDefaultVoicePresetId(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_voice_presets")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("is_default", true)
      .maybeSingle();

    if (error) throw error;
    return typeof data?.id === "string" ? data.id : null;
  }

  async setDefaultAvatarPreset(params: {
    organizationId: string;
    presetId: string;
    updatedAt: string;
  }) {
    const { error: clearError } = await this.supabase
      .from("heygen_avatar_presets")
      .update({ is_default: false, updated_at: params.updatedAt })
      .eq("organization_id", params.organizationId)
      .eq("is_default", true);

    if (clearError) throw clearError;

    const { error: setError } = await this.supabase
      .from("heygen_avatar_presets")
      .update({ is_default: true, updated_at: params.updatedAt })
      .eq("organization_id", params.organizationId)
      .eq("id", params.presetId);

    if (setError) throw setError;
  }

  async setDefaultVoicePreset(params: {
    organizationId: string;
    presetId: string;
    updatedAt: string;
  }) {
    const { error: clearError } = await this.supabase
      .from("heygen_voice_presets")
      .update({ is_default: false, updated_at: params.updatedAt })
      .eq("organization_id", params.organizationId)
      .eq("is_default", true);

    if (clearError) throw clearError;

    const { error: setError } = await this.supabase
      .from("heygen_voice_presets")
      .update({ is_default: true, updated_at: params.updatedAt })
      .eq("organization_id", params.organizationId)
      .eq("id", params.presetId);

    if (setError) throw setError;
  }

  async getProductionJob(params: {
    jobId: string;
    organizationId: string;
  }) {
    const { data, error } = await this.supabase
      .from("production_jobs")
      .select(
        [
          "id",
          "artifact_id",
          "material_lesson_id",
          "material_component_id",
          "lesson_id",
          "module_id",
          "organization_id",
          "status",
          "input_snapshot",
          "output_snapshot",
          "provider_job_id",
          "duration_seconds",
        ].join(", "),
      )
      .eq("id", params.jobId)
      .eq("organization_id", params.organizationId)
      .eq("provider", PRODUCTION_PROVIDERS.HEYGEN)
      .maybeSingle();

    if (error) throw error;
    return (data || null) as HeygenProductionJobRow | null;
  }

  async getLatestAvatarVideoJobForComponent(params: {
    componentId: string;
    organizationId: string;
  }) {
    const { data, error } = await this.supabase
      .from("production_jobs")
      .select(
        [
          "id",
          "artifact_id",
          "material_lesson_id",
          "material_component_id",
          "lesson_id",
          "module_id",
          "organization_id",
          "status",
          "input_snapshot",
          "output_snapshot",
          "provider_job_id",
          "provider_model",
          "duration_seconds",
          "created_at",
          "updated_at",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("provider", PRODUCTION_PROVIDERS.HEYGEN)
      .eq("job_type", PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data || null) as HeygenProductionJobRow | null;
  }

  async markVideoJobWaitingProvider(params: {
    jobId: string;
    outputFormat?: string | null;
    providerJobId: string;
    providerStatus?: string | null;
    requestSnapshot: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        output_snapshot: {
          output_format: params.outputFormat || null,
          provider_job_id: params.providerJobId,
          provider_status: params.providerStatus || null,
          request: params.requestSnapshot,
        },
        provider_job_id: params.providerJobId,
        started_at: now,
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        updated_at: now,
      })
      .eq("id", params.jobId);

    if (error) throw error;
  }

  async markVideoJobSucceeded(params: {
    durationSeconds?: number | null;
    jobId: string;
    outputSnapshot: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        completed_at: now,
        duration_seconds: params.durationSeconds
          ? Math.round(params.durationSeconds)
          : null,
        output_snapshot: params.outputSnapshot,
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
        updated_at: now,
      })
      .eq("id", params.jobId);

    if (error) throw error;
  }

  async markVideoJobFailed(params: {
    errorPayload: Record<string, unknown>;
    jobId: string;
  }) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        failed_at: now,
        provider_error: params.errorPayload,
        status: PRODUCTION_JOB_STATUSES.FAILED,
        updated_at: now,
      })
      .eq("id", params.jobId);

    if (error) throw error;
  }

  async markVideoJobSubmissionUnknown(params: {
    errorPayload: Record<string, unknown>;
    jobId: string;
  }) {
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        failed_at: null,
        provider_error: params.errorPayload,
        status: PRODUCTION_JOB_STATUSES.RETRY_SCHEDULED,
        updated_at: now,
      })
      .eq("id", params.jobId);

    if (error) throw error;
  }

  async findGeneratedAssetByJob(
    jobId: string,
    assetType: (typeof PRODUCTION_ASSET_TYPES)[keyof typeof PRODUCTION_ASSET_TYPES] =
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
  ) {
    const { data, error } = await this.supabase
      .from("production_assets")
      .select("id, public_url, storage_path, duration_milliseconds, duration_seconds, mime_type, metadata")
      .eq("production_job_id", jobId)
      .eq("asset_type", assetType)
      .maybeSingle();

    if (error) throw error;
    return (data || null) as HeygenProductionAssetRow | null;
  }

  async findAvatarVideoAssetByJob(
    jobId: string,
    assetType: (typeof PRODUCTION_ASSET_TYPES)[keyof typeof PRODUCTION_ASSET_TYPES] =
      PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
  ) {
    return this.findGeneratedAssetByJob(jobId, assetType);
  }

  async findVoiceAudioAssetByJob(jobId: string) {
    return this.findGeneratedAssetByJob(
      jobId,
      PRODUCTION_ASSET_TYPES.VOICE_AUDIO,
    );
  }

  async insertGeneratedMediaAsset(params: {
    assetType?: (typeof PRODUCTION_ASSET_TYPES)[keyof typeof PRODUCTION_ASSET_TYPES];
    checksum: string;
    context: ProductionComponentContext;
    createdBy?: string | null;
    durationSeconds?: number | null;
    externalUrl?: string | null;
    fileSizeBytes: number;
    jobId: string;
    metadata: Record<string, unknown>;
    mimeType: string;
    providerJobId: string;
    publicUrl: string;
    storageBucket: string;
    storagePath: string;
  }) {
    const { data, error } = await this.supabase
      .from("production_assets")
      .insert({
        artifact_id: params.context.artifactId,
        asset_type: params.assetType || PRODUCTION_ASSET_TYPES.AVATAR_VIDEO,
        checksum: params.checksum,
        content: {
          provider_job_id: params.providerJobId,
        },
        created_by: params.createdBy || null,
        duration_seconds: params.durationSeconds
          ? Math.round(params.durationSeconds)
          : null,
        duration_milliseconds: params.durationSeconds
          ? Math.round(params.durationSeconds * 1000)
          : null,
        external_url: params.externalUrl || null,
        file_size_bytes: params.fileSizeBytes,
        lesson_id: params.context.lessonId,
        material_component_id: params.context.componentId,
        material_lesson_id: params.context.materialLessonId,
        metadata: params.metadata,
        mime_type: params.mimeType,
        module_id: params.context.moduleId,
        organization_id: params.context.organizationId,
        production_job_id: params.jobId,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
        public_url: params.publicUrl,
        qa_status: PRODUCTION_QA_STATUSES.READY_FOR_QA,
        storage_bucket: params.storageBucket,
        storage_path: params.storagePath,
      })
      .select("id, public_url, storage_path, duration_milliseconds, duration_seconds, mime_type, metadata")
      .single();

    if (error) throw error;
    return data as HeygenProductionAssetRow;
  }

  async promoteAvatarVideoToMaterialAssets(params: {
    componentId: string;
    durationSeconds?: number | null;
    providerJobId: string;
    publicUrl: string;
    storagePath: string;
  }) {
    const fileName = params.storagePath.split("/").at(-1) || "heygen-avatar.mp4";
    const assetsPatch = {
      avatar_generation_mode: "single_video",
      avatar_video: {
        duration: params.durationSeconds || undefined,
        external_id: params.providerJobId,
        file_name: fileName,
        has_audio: true,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
        public_url: params.publicUrl,
        storage_path: `${params.storagePath}`,
        sync_status: "COMPLETED",
      },
      updated_at: new Date().toISOString(),
    };

    const { data: nextAssets, error: updateError } = await this.supabase.rpc(
      "patch_material_component_assets",
      {
        p_assets_patch: assetsPatch,
        p_component_id: params.componentId,
      },
    );

    if (updateError) throw updateError;
    return nextAssets;
  }

  async promoteSeparatedAvatarTracks(params: {
    avatar: {
      durationSeconds?: number | null;
      providerJobId: string;
      publicUrl: string;
      storagePath: string;
    };
    componentId: string;
    scriptHash: string;
    voice: {
      durationSeconds?: number | null;
      providerRequestId?: string | null;
      publicUrl: string;
      storagePath: string;
      wordTimestamps?: unknown[];
    };
  }) {
    const avatarFileName = params.avatar.storagePath.split("/").at(-1) || "heygen-avatar.mp4";
    const voiceFileName = params.voice.storagePath.split("/").at(-1) || "heygen-voice.mp3";
    const now = new Date().toISOString();
    const assetsPatch = {
      avatar_generation_mode: "single_video",
      avatar_clips: [],
      voice_clips: [],
      avatar_video: {
        duration: params.avatar.durationSeconds || params.voice.durationSeconds || undefined,
        external_id: params.avatar.providerJobId,
        file_name: avatarFileName,
        has_audio: false,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
        public_url: params.avatar.publicUrl,
        script_hash: params.scriptHash,
        storage_path: params.avatar.storagePath,
        sync_status: "COMPLETED",
      },
      voice_audio: {
        duration: params.voice.durationSeconds || undefined,
        external_id: params.voice.providerRequestId || undefined,
        file_name: voiceFileName,
        last_uploaded_at: now,
        provider: PRODUCTION_PROVIDERS.HEYGEN,
        public_url: params.voice.publicUrl,
        script_hash: params.scriptHash,
        storage_path: params.voice.storagePath,
        word_timestamps: params.voice.wordTimestamps || [],
      },
      updated_at: now,
    };

    const { data: nextAssets, error: updateError } = await this.supabase.rpc(
      "patch_material_component_assets",
      {
        p_assets_patch: assetsPatch,
        p_component_id: params.componentId,
      },
    );
    if (updateError) throw updateError;
    return nextAssets;
  }
}
