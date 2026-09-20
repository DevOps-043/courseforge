import type {
  HeygenAvatarPresetGenerationRow,
  HeygenGeneratedSpeech,
  HeygenProductionAssetRow,
  HeygenProductionJobRow,
  HeygenSupabaseClient,
  HeygenVoicePresetGenerationRow,
} from "./heygen.types";
import { HEYGEN_VIDEO_STORAGE_BUCKET } from "./heygen.types";
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
          "ownership",
          "provider_state",
          "last_seen_at",
          "missing_since",
          "is_default",
          "metadata",
          "archived_at",
          "synced_at",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .eq("ownership", "private")
      .eq("provider_state", "AVAILABLE")
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .order("synced_at", { ascending: false, nullsFirst: false })
      .limit(1000);

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
          "ownership",
          "provider_state",
          "last_seen_at",
          "missing_since",
          "preview_audio_url",
          "is_default",
          "metadata",
          "archived_at",
          "synced_at",
        ].join(", "),
      )
      .eq("organization_id", organizationId)
      .eq("ownership", "private")
      .eq("provider_state", "AVAILABLE")
      .is("archived_at", null)
      .order("is_default", { ascending: false })
      .order("synced_at", { ascending: false, nullsFirst: false })
      .limit(1000);

    if (error) throw error;
    return data || [];
  }

  async listArchivedAvatarPresets(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_avatar_presets")
      .select("id, heygen_avatar_look_id, name, is_default, archived_at")
      .eq("organization_id", organizationId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return data || [];
  }

  async listArchivedVoicePresets(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_voice_presets")
      .select("id, heygen_voice_id, name, is_default, archived_at")
      .eq("organization_id", organizationId)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return data || [];
  }

  async listUnavailableCatalog(organizationId: string) {
    const [avatars, voices, assets] = await Promise.all([
      this.supabase.from("heygen_avatar_presets")
        .select("id, heygen_avatar_look_id, name, provider_state, missing_since, last_seen_at")
        .eq("organization_id", organizationId).neq("provider_state", "AVAILABLE")
        .order("updated_at", { ascending: false }).limit(250),
      this.supabase.from("heygen_voice_presets")
        .select("id, heygen_voice_id, name, provider_state, missing_since, last_seen_at")
        .eq("organization_id", organizationId).neq("provider_state", "AVAILABLE")
        .order("updated_at", { ascending: false }).limit(250),
      this.supabase.from("heygen_provider_assets")
        .select("id, heygen_asset_id, name, mime_type, provider_state, missing_since, last_seen_at")
        .eq("organization_id", organizationId).neq("provider_state", "AVAILABLE")
        .order("updated_at", { ascending: false }).limit(250),
    ]);
    if (avatars.error) throw avatars.error;
    if (voices.error) throw voices.error;
    if (assets.error) throw assets.error;
    return { assets: assets.data || [], avatars: avatars.data || [], voices: voices.data || [] };
  }

  async getWorkspaceSyncStatus(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_workspace_connections")
      .select("account_label, last_sync_status, last_sync_error, last_sync_request_id, last_synced_at, metadata, updated_at")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async beginCatalogSync(params: { organizationId: string; requestId?: string }) {
    const staleBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    const { error: staleError } = await this.supabase
      .from("heygen_catalog_sync_runs")
      .update({
        completed_at: new Date().toISOString(),
        error_message: "La sincronización excedió el tiempo máximo y fue cerrada automáticamente.",
        status: "FAILED",
      })
      .eq("organization_id", params.organizationId)
      .eq("status", "RUNNING")
      .lt("started_at", staleBefore);
    if (staleError) throw staleError;
    const { data, error } = await this.supabase
      .from("heygen_catalog_sync_runs")
      .insert({ organization_id: params.organizationId, request_id: params.requestId || null, status: "RUNNING" })
      .select("id")
      .single();
    if (error) throw error;
    const now = new Date().toISOString();
    const { error: workspaceError } = await this.supabase
      .from("heygen_workspace_connections")
      .upsert({
        organization_id: params.organizationId,
        last_sync_request_id: params.requestId || null,
        last_sync_status: "RUNNING",
        updated_at: now,
      }, { onConflict: "organization_id" });
    if (workspaceError) throw workspaceError;
    return data.id as string;
  }

  async reconcileCatalogSnapshot(params: {
    accountSnapshot: Record<string, unknown>;
    avatars: Record<string, unknown>[];
    organizationId: string;
    syncRunId: string;
    syncedAt: string;
    voices: Record<string, unknown>[];
  }) {
    const { data, error } = await this.supabase.rpc("reconcile_heygen_private_catalog_snapshot", {
      p_account_snapshot: params.accountSnapshot,
      p_avatars: params.avatars,
      p_organization_id: params.organizationId,
      p_sync_run_id: params.syncRunId,
      p_synced_at: params.syncedAt,
      p_voices: params.voices,
    });
    if (error) {
      if (isMissingRpc(error)) {
        return this.reconcilePrivateCatalogSnapshotCompat(params);
      }
      throw error;
    }
    return (data || {}) as {
      assetCount?: number;
      missingAssetCount?: number;
      missingAvatarCount?: number;
      missingVoiceCount?: number;
    };
  }

  private async reconcilePrivateCatalogSnapshotCompat(params: {
    accountSnapshot: Record<string, unknown>;
    avatars: Record<string, unknown>[];
    organizationId: string;
    syncRunId: string;
    syncedAt: string;
    voices: Record<string, unknown>[];
  }) {
    const [existingAvatars, existingVoices, workspace] = await Promise.all([
      this.supabase.from("heygen_avatar_presets")
        .select("id, heygen_avatar_look_id")
        .eq("organization_id", params.organizationId)
        .or("ownership.eq.private,ownership.is.null"),
      this.supabase.from("heygen_voice_presets")
        .select("id, heygen_voice_id")
        .eq("organization_id", params.organizationId)
        .or("ownership.eq.private,ownership.is.null"),
      this.getWorkspaceSyncStatus(params.organizationId),
    ]);
    if (existingAvatars.error) throw existingAvatars.error;
    if (existingVoices.error) throw existingVoices.error;

    const avatarRows = params.avatars.map((avatar) => ({
      avatar_type: readNullableString(avatar.avatar_type),
      default_voice_id: readNullableString(avatar.default_voice_id),
      heygen_avatar_group_id: readNullableString(avatar.group_id),
      heygen_avatar_look_id: readRequiredString(avatar.provider_id, "avatar provider id"),
      last_seen_at: params.syncedAt,
      metadata: readRecord(avatar.metadata),
      missing_since: null,
      name: readRequiredString(avatar.name, "avatar name"),
      organization_id: params.organizationId,
      ownership: "private",
      preview_image_url: readNullableString(avatar.preview_image_url),
      preview_video_url: readNullableString(avatar.preview_video_url),
      provider_state: toAvatarProviderState(avatar.status),
      status: readNullableString(avatar.status),
      supported_api_engines: Array.isArray(avatar.supported_api_engines)
        ? avatar.supported_api_engines
        : [],
      synced_at: params.syncedAt,
      updated_at: params.syncedAt,
    }));
    const voiceRows = params.voices.map((voice) => ({
      gender: readNullableString(voice.gender),
      heygen_voice_id: readRequiredString(voice.provider_id, "voice provider id"),
      language: readNullableString(voice.language),
      last_seen_at: params.syncedAt,
      metadata: readRecord(voice.metadata),
      missing_since: null,
      name: readRequiredString(voice.name, "voice name"),
      organization_id: params.organizationId,
      ownership: "private",
      preview_audio_url: readNullableString(voice.preview_audio_url),
      provider_state: "AVAILABLE",
      synced_at: params.syncedAt,
      updated_at: params.syncedAt,
      voice_type: readNullableString(voice.voice_type),
    }));

    if (avatarRows.length > 0) {
      const { error: avatarError } = await this.supabase.from("heygen_avatar_presets")
        .upsert(avatarRows, { onConflict: "organization_id,heygen_avatar_look_id" });
      if (avatarError) throw avatarError;
    }
    if (voiceRows.length > 0) {
      const { error: voiceError } = await this.supabase.from("heygen_voice_presets")
        .upsert(voiceRows, { onConflict: "organization_id,heygen_voice_id" });
      if (voiceError) throw voiceError;
    }

    const avatarIds = new Set(avatarRows.map((row) => row.heygen_avatar_look_id));
    const voiceIds = new Set(voiceRows.map((row) => row.heygen_voice_id));
    const missingAvatarRowIds = (existingAvatars.data || [])
      .filter((row) => !avatarIds.has(String(row.heygen_avatar_look_id)))
      .map((row) => String(row.id));
    const missingVoiceRowIds = (existingVoices.data || [])
      .filter((row) => !voiceIds.has(String(row.heygen_voice_id)))
      .map((row) => String(row.id));

    if (missingAvatarRowIds.length > 0) {
      const { error } = await this.supabase.from("heygen_avatar_presets").update({
        is_default: false,
        provider_state: "MISSING",
        updated_at: params.syncedAt,
      }).in("id", missingAvatarRowIds);
      if (error) throw error;
      const { error: timestampError } = await this.supabase.from("heygen_avatar_presets")
        .update({ missing_since: params.syncedAt })
        .in("id", missingAvatarRowIds)
        .is("missing_since", null);
      if (timestampError) throw timestampError;
    }
    if (missingVoiceRowIds.length > 0) {
      const { error } = await this.supabase.from("heygen_voice_presets").update({
        is_default: false,
        provider_state: "MISSING",
        updated_at: params.syncedAt,
      }).in("id", missingVoiceRowIds);
      if (error) throw error;
      const { error: timestampError } = await this.supabase.from("heygen_voice_presets")
        .update({ missing_since: params.syncedAt })
        .in("id", missingVoiceRowIds)
        .is("missing_since", null);
      if (timestampError) throw timestampError;
    }

    const [assets, missingAssets] = await Promise.all([
      countCatalogRows(this.supabase, "heygen_provider_assets", params.organizationId),
      countCatalogRows(this.supabase, "heygen_provider_assets", params.organizationId, "MISSING"),
    ]);
    const accountUsername = readNullableString(params.accountSnapshot.username);
    const workspaceMetadata = readRecord(workspace?.metadata);
    const [runUpdate, workspaceUpdate] = await Promise.all([
      this.supabase.from("heygen_catalog_sync_runs").update({
        account_snapshot: params.accountSnapshot,
        asset_count: assets,
        avatar_count: avatarRows.length,
        completed_at: params.syncedAt,
        error_message: null,
        missing_asset_count: missingAssets,
        missing_avatar_count: missingAvatarRowIds.length,
        missing_voice_count: missingVoiceRowIds.length,
        status: "SUCCEEDED",
        voice_count: voiceRows.length,
      }).eq("id", params.syncRunId).eq("organization_id", params.organizationId),
      this.supabase.from("heygen_workspace_connections").upsert({
        account_label: accountUsername || workspace?.account_label || null,
        last_sync_error: null,
        last_sync_status: "SUCCEEDED",
        last_synced_at: params.syncedAt,
        metadata: { ...workspaceMetadata, account: params.accountSnapshot },
        organization_id: params.organizationId,
        updated_at: params.syncedAt,
      }, { onConflict: "organization_id" }),
    ]);
    if (runUpdate.error) throw runUpdate.error;
    if (workspaceUpdate.error) throw workspaceUpdate.error;

    return {
      assetCount: assets,
      missingAssetCount: missingAssets,
      missingAvatarCount: missingAvatarRowIds.length,
      missingVoiceCount: missingVoiceRowIds.length,
    };
  }

  async markCatalogSyncIncomplete(params: {
    errorMessage: string;
    organizationId: string;
    status: "FAILED" | "PARTIAL";
    syncRunId: string;
    syncedAt: string;
  }) {
    const safeMessage = params.errorMessage.slice(0, 500);
    const [run, workspace] = await Promise.all([
      this.supabase.from("heygen_catalog_sync_runs").update({
        completed_at: params.syncedAt,
        error_message: safeMessage,
        status: params.status,
      }).eq("id", params.syncRunId).eq("organization_id", params.organizationId),
      this.supabase.from("heygen_workspace_connections").upsert({
        organization_id: params.organizationId,
        last_sync_error: safeMessage,
        last_sync_status: params.status,
        updated_at: params.syncedAt,
      }, { onConflict: "organization_id" }),
    ]);
    if (run.error) throw run.error;
    if (workspace.error) throw workspace.error;
  }

  async setCatalogPresetArchived(params: {
    actorUserId?: string;
    archived: boolean;
    kind: "avatar" | "voice";
    organizationId: string;
    presetId: string;
  }) {
    const { data, error } = await this.supabase.rpc(
      "set_heygen_catalog_preset_archived",
      {
        p_actor_user_id: params.actorUserId || null,
        p_archived: params.archived,
        p_organization_id: params.organizationId,
        p_preset_id: params.presetId,
        p_resource_kind: params.kind,
      },
    );
    if (error) {
      if (isMissingRpc(error)) return this.setCatalogPresetArchivedCompat(params);
      throw error;
    }
    if (data === "NOT_FOUND" || data === "DEFAULT") return data;
    return "UPDATED" as const;
  }

  private async setCatalogPresetArchivedCompat(params: {
    archived: boolean;
    kind: "avatar" | "voice";
    organizationId: string;
    presetId: string;
  }) {
    const table = params.kind === "avatar" ? "heygen_avatar_presets" : "heygen_voice_presets";
    const { data: preset, error: readError } = await this.supabase
      .from(table)
      .select("id, is_default")
      .eq("organization_id", params.organizationId)
      .eq("id", params.presetId)
      .maybeSingle();
    if (readError) throw readError;
    if (!preset) return "NOT_FOUND" as const;
    if (params.archived && preset.is_default === true) return "DEFAULT" as const;

    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from(table)
      .update({ archived_at: params.archived ? now : null, updated_at: now })
      .eq("organization_id", params.organizationId)
      .eq("id", params.presetId);
    if (error) throw error;
    return "UPDATED" as const;
  }

  async getDefaultAvatarPresetId(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_avatar_presets")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("ownership", "private")
      .eq("provider_state", "AVAILABLE")
      .eq("is_default", true)
      .is("archived_at", null)
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
          "metadata",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId)
      .eq("ownership", "private")
      .eq("provider_state", "AVAILABLE")
      .is("archived_at", null);

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
      .eq("organization_id", params.organizationId)
      .eq("ownership", "private")
      .eq("provider_state", "AVAILABLE")
      .is("archived_at", null);

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
      .eq("ownership", "private")
      .eq("provider_state", "AVAILABLE")
      .eq("is_default", true)
      .is("archived_at", null)
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
          "job_type",
          "output_snapshot",
          "provider_job_id",
          "provider_error",
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

  async listAvatarClipJobsForComponent(params: {
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
          "job_type",
          "output_snapshot",
          "provider_job_id",
          "provider_error",
          "provider_model",
          "duration_seconds",
          "created_at",
          "updated_at",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("provider", PRODUCTION_PROVIDERS.HEYGEN)
      .eq("job_type", PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []) as unknown as HeygenProductionJobRow[];
  }

  async restoreProviderJobId(params: { jobId: string; providerJobId: string }) {
    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        provider_job_id: params.providerJobId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.jobId)
      .is("provider_job_id", null);

    if (error) throw error;
  }

  async backfillGeneratedAssetDisplayName(params: {
    asset: HeygenProductionAssetRow;
    displayName: string;
  }) {
    const fileName = params.asset.storage_path?.split("/").at(-1) || null;
    const metadata = params.asset.metadata || {};
    if (
      metadata.asset_display_name === params.displayName
      && (!fileName || metadata.file_name === fileName)
    ) return false;

    const { error } = await this.supabase
      .from("production_assets")
      .update({
        metadata: {
          ...metadata,
          asset_display_name: params.displayName,
          ...(fileName ? { file_name: fileName } : {}),
        },
        updated_at: new Date().toISOString(),
      })
      .eq("id", params.asset.id);

    if (error) throw error;
    return true;
  }

  async getLatestHeygenMediaJobForComponent(params: {
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
          "job_type",
          "output_snapshot",
          "provider_job_id",
          "provider_error",
          "provider_model",
          "duration_seconds",
          "created_at",
          "updated_at",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("provider", PRODUCTION_PROVIDERS.HEYGEN)
      .in("job_type", [
        PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_VIDEO,
        PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
        PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
      ])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    return (data || null) as HeygenProductionJobRow | null;
  }

  async listRecoverableSceneMediaJobs(params: {
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
          "job_type",
          "output_snapshot",
          "provider_job_id",
          "provider_error",
          "duration_seconds",
          "updated_at",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId)
      .eq("material_component_id", params.componentId)
      .eq("provider", PRODUCTION_PROVIDERS.HEYGEN)
      .in("status", [
        PRODUCTION_JOB_STATUSES.SUCCEEDED,
        PRODUCTION_JOB_STATUSES.FAILED,
      ])
      .in("job_type", [
        PRODUCTION_JOB_TYPES.HEYGEN_AVATAR_CLIP,
        PRODUCTION_JOB_TYPES.HEYGEN_VOICEOVER,
      ])
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) throw error;
    return (data || []) as unknown as HeygenProductionJobRow[];
  }

  async markVideoJobWaitingProvider(params: {
    jobId: string;
    outputFormat?: string | null;
    providerJobId: string;
    providerStatus?: string | null;
    requestSnapshot: Record<string, unknown>;
  }) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
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
      .eq("id", params.jobId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("No se pudo persistir la correlación del video de HeyGen.");
  }

  async checkpointGeneratedSpeech(params: {
    jobId: string;
    outputSnapshot?: Record<string, unknown> | null;
    speech: HeygenGeneratedSpeech;
  }) {
    const now = new Date().toISOString();
    const { data, error } = await this.supabase
      .from("production_jobs")
      .update({
        output_snapshot: {
          ...(params.outputSnapshot || {}),
          speech_checkpoint: {
            audio_url: params.speech.audioUrl,
            duration_seconds: params.speech.durationSeconds,
            generated_at: now,
            provider_request_id: params.speech.requestId || null,
            word_timestamps: params.speech.wordTimestamps,
          },
        },
        started_at: now,
        status: PRODUCTION_JOB_STATUSES.RUNNING,
        updated_at: now,
      })
      .eq("id", params.jobId)
      .select("id")
      .maybeSingle();

    if (error) throw error;
    if (!data?.id) throw new Error("No se pudo guardar el checkpoint del audio de HeyGen.");
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
      .select("id, public_url, storage_bucket, storage_path, duration_milliseconds, duration_seconds, mime_type, metadata")
      .eq("production_job_id", jobId)
      .eq("asset_type", assetType)
      .neq("qa_status", PRODUCTION_QA_STATUSES.ARCHIVED)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    const asset = (data || null) as HeygenProductionAssetRow | null;
    if (!asset) return null;

    const objectPath = resolveHeygenStorageObjectPath(asset);
    if (!objectPath) {
      await this.archiveUnavailableGeneratedAsset({
        asset,
        assetType,
        jobId,
        reason: "INVALID_STORAGE_REFERENCE",
      });
      return null;
    }

    const pathSeparatorIndex = objectPath.lastIndexOf("/");
    const directory = objectPath.slice(0, pathSeparatorIndex);
    const fileName = objectPath.slice(pathSeparatorIndex + 1);
    const { data: storageObjects, error: storageError } = await this.supabase.storage
      .from(HEYGEN_VIDEO_STORAGE_BUCKET)
      .list(directory, { limit: 100, search: fileName });
    if (storageError) throw storageError;
    if (storageObjects?.some((object) => object.name === fileName)) return asset;

    await this.archiveUnavailableGeneratedAsset({
      asset,
      assetType,
      jobId,
      reason: "STORAGE_OBJECT_MISSING",
    });
    return null;
  }

  private async archiveUnavailableGeneratedAsset(params: {
    asset: HeygenProductionAssetRow;
    assetType: (typeof PRODUCTION_ASSET_TYPES)[keyof typeof PRODUCTION_ASSET_TYPES];
    jobId: string;
    reason: "INVALID_STORAGE_REFERENCE" | "STORAGE_OBJECT_MISSING";
  }) {
    const archivedAt = new Date().toISOString();
    const { error } = await this.supabase
      .from("production_assets")
      .update({
        metadata: {
          ...(params.asset.metadata || {}),
          archive_reason: params.reason,
          archived_at: archivedAt,
        },
        public_url: null,
        qa_status: PRODUCTION_QA_STATUSES.ARCHIVED,
      })
      .eq("id", params.asset.id);

    if (error) throw error;
    console.warn("[HeygenRepository] Archived unavailable generated asset", {
      assetId: params.asset.id,
      assetType: params.assetType,
      jobId: params.jobId,
      reason: params.reason,
      storagePath: params.asset.storage_path || null,
    });
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

  async promoteVoiceAudioToMaterialAssets(params: {
    componentId: string;
    durationSeconds?: number | null;
    providerRequestId?: string | null;
    publicUrl: string;
    scriptHash: string;
    storagePath: string;
    wordTimestamps?: unknown[];
  }) {
    const now = new Date().toISOString();
    const fileName = params.storagePath.split("/").at(-1) || "heygen-voice.mp3";
    const { data: nextAssets, error } = await this.supabase.rpc(
      "patch_material_component_assets",
      {
        p_assets_patch: {
          avatar_generation_mode: "voiceover",
          avatar_clips: [],
          avatar_video: null,
          voice_clips: [],
          voice_audio: {
            duration: params.durationSeconds || undefined,
            external_id: params.providerRequestId || undefined,
            file_name: fileName,
            last_uploaded_at: now,
            provider: PRODUCTION_PROVIDERS.HEYGEN,
            public_url: params.publicUrl,
            script_hash: params.scriptHash,
            storage_path: params.storagePath,
            word_timestamps: params.wordTimestamps || [],
          },
          updated_at: now,
        },
        p_component_id: params.componentId,
      },
    );
    if (error) throw error;
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

export function resolveHeygenStorageObjectPath(
  asset: Pick<HeygenProductionAssetRow, "storage_bucket" | "storage_path">,
) {
  if (!asset.storage_path) return null;
  if (
    asset.storage_bucket &&
    asset.storage_bucket !== HEYGEN_VIDEO_STORAGE_BUCKET
  ) {
    return null;
  }

  const normalizedPath = asset.storage_path.trim().replace(/^\/+/, "");
  if (!normalizedPath || /^https?:\/\//i.test(normalizedPath)) return null;

  const bucketPrefix = `${HEYGEN_VIDEO_STORAGE_BUCKET}/`;
  const objectPath = normalizedPath.startsWith(bucketPrefix)
    ? normalizedPath.slice(bucketPrefix.length)
    : normalizedPath;
  if (
    !objectPath.startsWith("heygen/") ||
    objectPath.split("/").some((segment) => segment === "." || segment === "..")
  ) {
    return null;
  }

  return objectPath;
}

function isMissingRpc(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "PGRST202",
  );
}

function readNullableString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRequiredString(value: unknown, field: string) {
  const normalized = readNullableString(value);
  if (!normalized) throw new Error(`HeyGen snapshot is missing ${field}.`);
  return normalized;
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toAvatarProviderState(status: unknown) {
  const normalized = readNullableString(status)?.toLowerCase();
  if (normalized === "processing") return "PROCESSING";
  if (normalized === "failed") return "FAILED";
  return "AVAILABLE";
}

async function countCatalogRows(
  supabase: HeygenSupabaseClient,
  table: "heygen_provider_assets",
  organizationId: string,
  providerState?: "MISSING",
) {
  let query = supabase.from(table)
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId);
  if (providerState) query = query.eq("provider_state", providerState);
  const { count, error } = await query;
  if (error) throw error;
  return count || 0;
}
