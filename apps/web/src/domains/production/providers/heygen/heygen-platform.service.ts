import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HeygenClient } from "./heygen.client";
import { estimateHeygenCost } from "./heygen-cost.service";
import type { HeygenPlatformOperationType } from "./heygen.types";
import type { HeygenPlatformAction } from "./heygen-platform.validators";
import { toRecord } from "./heygen.validators";
import { resolveProductionComponentContext } from "../../jobs/production-jobs.service";

type AdminClient = SupabaseClient<any, "public", any>;

export class HeygenPlatformServiceError extends Error {
  constructor(message: string, readonly status = 400, readonly code = "HEYGEN_PLATFORM_ERROR") {
    super(message);
    this.name = "HeygenPlatformServiceError";
  }
}

export class HeygenPlatformService {
  constructor(
    private readonly supabase: AdminClient,
    private readonly client: HeygenClient,
  ) {}

  async getDashboard(organizationId: string) {
    const [account, languages, templates, glossaries, brandKits, styles, providerAssets, settings, operations, assets] =
      await Promise.all([
        safeFeature(() => this.client.getCurrentUser()),
        safeFeature(() => this.client.platformRequest({ path: "/v3/video-translations/languages" })),
        safeFeature(() => this.client.platformRequest({ path: "/v3/templates?limit=100" })),
        safeFeature(() => this.client.platformRequest({ path: "/v3/brand-glossaries?limit=100" })),
        safeFeature(() => this.client.platformRequest({ path: "/v3/brand-kits?limit=100" })),
        safeFeature(() => this.client.platformRequest({ path: "/v3/video-agents/styles?limit=100" })),
        safeFeature(() => this.client.platformRequest({ path: "/v3/assets?limit=50" })),
        this.readSettings(organizationId),
        this.listOperations(organizationId),
        this.listStandaloneAssets(organizationId),
      ]);
    const refreshable = operations.filter((item) =>
      item.status === "WAITING_PROVIDER" && typeof item.provider_id === "string").slice(0, 5);
    if (refreshable.length > 0) {
      await Promise.allSettled(refreshable.map((item) => this.refreshOperation({
        operationId: item.id,
        organizationId,
      })));
    }
    const currentOperations = refreshable.length > 0
      ? await this.listOperations(organizationId)
      : operations;
    const activeOperations = currentOperations.filter((item) =>
      item.status === "PENDING" || item.status === "WAITING_PROVIDER");
    return {
      account,
      activeOperations: activeOperations.length,
      assets,
      brandKits: unwrapList(brandKits),
      capabilities: buildCapabilityManifest(),
      glossaries: unwrapList(glossaries),
      languages: unwrapList(languages),
      maxConcurrentJobs: 10,
      operations: currentOperations,
      providerAssets: unwrapList(providerAssets),
      settings,
      styles: unwrapList(styles),
      templates: unwrapList(templates),
    };
  }

  async searchAudio(params: { limit: number; query: string; type: "music" | "sound_effects" }) {
    const query = new URLSearchParams({
      limit: String(params.limit),
      query: params.query,
      type: params.type,
    });
    return this.client.platformRequest({ path: `/v3/audio/sounds?${query}` });
  }

  async updateSettings(organizationId: string, settings: Record<string, unknown>) {
    const row = {
      default_brand_glossary_id: settings.defaultBrandGlossaryId || null,
      default_brand_kit_id: settings.defaultBrandKitId || null,
      default_locale: settings.defaultLocale || "es-MX",
      liveavatar_avatar_id: settings.liveavatarAvatarId || null,
      liveavatar_context_id: settings.liveavatarContextId || null,
      liveavatar_sandbox: settings.liveavatarSandbox !== false,
      monthly_budget_usd: settings.monthlyBudgetUsd ?? null,
      organization_id: organizationId,
      per_course_budget_usd: settings.perCourseBudgetUsd ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await this.supabase
      .from("heygen_workspace_settings")
      .upsert(row, { onConflict: "organization_id" })
      .select("*")
      .single();
    if (error) throw error;
    return normalizeSettings(data);
  }

  async submit(params: {
    action: HeygenPlatformAction;
    createdBy: string;
    organizationId: string;
  }) {
    const callbackId = crypto.randomUUID();
    const componentContext = params.action.componentId
      ? await resolveProductionComponentContext({ componentId: params.action.componentId, supabase: this.supabase })
      : null;
    if (componentContext && componentContext.organizationId !== params.organizationId) {
      throw new HeygenPlatformServiceError("El componente no pertenece a la empresa activa.", 403);
    }
    const workspaceSettings = await this.readSettings(params.organizationId);
    const config = buildOperationRequest(params.action, callbackId, {
      defaultBrandGlossaryId: workspaceSettings.defaultBrandGlossaryId,
      defaultBrandKitId: workspaceSettings.defaultBrandKitId,
    });
    const estimatedCostUsd = estimateActionCost(params.action, config.operationType);
    await this.assertConcurrency(params.organizationId);
    await this.assertBudget({
      artifactId: componentContext?.artifactId || null,
      estimatedCostUsd,
      organizationId: params.organizationId,
    });

    const { data: operation, error: insertError } = await this.supabase
      .from("heygen_platform_operations")
      .insert({
        callback_id: callbackId,
        artifact_id: componentContext?.artifactId || null,
        created_by: params.createdBy,
        estimated_cost_usd: estimatedCostUsd || null,
        input_snapshot: redactOperationInput(params.action),
        material_component_id: params.action.componentId || null,
        operation_type: config.operationType,
        organization_id: params.organizationId,
        status: "PENDING",
        title: params.action.title || config.defaultTitle,
      })
      .select("*")
      .single();
    if (insertError) throw insertError;

    try {
      const raw = await this.client.platformRequest({
        body: config.body,
        idempotencyKey: operation.id,
        method: "POST",
        path: config.path,
      });
      const responseData = unwrapData(raw);
      const providerIds = extractProviderIds(responseData);
      const isSynchronous = config.synchronous || providerIds.length === 0;
      const nextStatus = isSynchronous ? "SUCCEEDED" : "WAITING_PROVIDER";
      const { data: updated, error: updateError } = await this.supabase
        .from("heygen_platform_operations")
        .update({
          completed_at: isSynchronous ? new Date().toISOString() : null,
          output_snapshot: { provider_ids: providerIds, response: responseData },
          provider_id: providerIds[0] || null,
          provider_status: readStatus(responseData) || nextStatus.toLowerCase(),
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq("id", operation.id)
        .select("*")
        .single();
      if (updateError) throw updateError;
      return updated;
    } catch (error) {
      await this.supabase.from("heygen_platform_operations").update({
        failure_message: error instanceof Error ? error.message.slice(0, 1000) : "HeyGen operation failed.",
        status: "FAILED",
        updated_at: new Date().toISOString(),
      }).eq("id", operation.id);
      throw error;
    }
  }

  async refreshOperation(params: { operationId: string; organizationId: string }) {
    const { data: operation, error } = await this.supabase
      .from("heygen_platform_operations")
      .select("*")
      .eq("id", params.operationId)
      .eq("organization_id", params.organizationId)
      .maybeSingle();
    if (error) throw error;
    if (!operation) throw new HeygenPlatformServiceError("Operación HeyGen no encontrada.", 404);
    if (operation.status === "SUCCEEDED" || operation.status === "FAILED" || !operation.provider_id) {
      return operation;
    }
    const paths = statusPaths(operation.operation_type, operation.output_snapshot, operation.provider_id);
    if (paths.length === 0) return operation;
    const results = await Promise.all(paths.map((path) => this.client.platformRequest({ path })));
    const details = results.map(unwrapData);
    const statuses = details.map(readStatus).filter(Boolean) as string[];
    const failed = statuses.some((status) => isFailed(status));
    const completed = statuses.length > 0 && statuses.every((status) => isCompleted(status));
    const nextStatus = failed ? "FAILED" : completed ? "SUCCEEDED" : "WAITING_PROVIDER";
    const { data: updated, error: updateError } = await this.supabase
      .from("heygen_platform_operations")
      .update({
        completed_at: failed || completed ? new Date().toISOString() : null,
        failure_message: failed ? readFailure(details.find((detail) => isFailed(readStatus(detail)))) : null,
        output_snapshot: { ...(toRecord(operation.output_snapshot) || {}), details },
        provider_status: statuses.join(",") || operation.provider_status,
        status: nextStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", operation.id)
      .select("*")
      .single();
    if (updateError) throw updateError;
    return updated;
  }

  private async assertBudget(params: { artifactId: string | null; estimatedCostUsd: number; organizationId: string }) {
    if (params.estimatedCostUsd <= 0) return;
    const settings = await this.readSettings(params.organizationId);
    if (settings.monthlyBudgetUsd !== null) {
      const start = new Date();
      start.setUTCDate(1);
      start.setUTCHours(0, 0, 0, 0);
      const { data, error } = await this.supabase
        .from("heygen_platform_operations")
        .select("estimated_cost_usd, actual_cost_usd")
        .eq("organization_id", params.organizationId)
        .gte("created_at", start.toISOString())
        .neq("status", "CANCELLED");
      if (error) throw error;
      const committed = (data || []).reduce((sum, row) =>
        sum + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0), 0);
      if (committed + params.estimatedCostUsd > settings.monthlyBudgetUsd) {
        throw new HeygenPlatformServiceError(
          `La operación supera el presupuesto mensual de HeyGen (USD ${settings.monthlyBudgetUsd.toFixed(2)}).`,
          409,
          "HEYGEN_BUDGET_EXCEEDED",
        );
      }
    }
    if (params.artifactId && settings.perCourseBudgetUsd !== null) {
      const { data: courseRows, error: courseError } = await this.supabase
        .from("heygen_platform_operations")
        .select("estimated_cost_usd, actual_cost_usd")
        .eq("artifact_id", params.artifactId)
        .neq("status", "CANCELLED");
      if (courseError) throw courseError;
      const courseCommitted = (courseRows || []).reduce((sum, row) =>
        sum + Number(row.actual_cost_usd ?? row.estimated_cost_usd ?? 0), 0);
      if (courseCommitted + params.estimatedCostUsd > settings.perCourseBudgetUsd) {
        throw new HeygenPlatformServiceError(
          `La operación supera el presupuesto del curso (USD ${settings.perCourseBudgetUsd.toFixed(2)}).`,
          409,
          "HEYGEN_COURSE_BUDGET_EXCEEDED",
        );
      }
    }
  }

  private async assertConcurrency(organizationId: string) {
    const { count, error } = await this.supabase
      .from("heygen_platform_operations")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .in("status", ["PENDING", "WAITING_PROVIDER"]);
    if (error) throw error;
    if ((count || 0) >= 10) {
      throw new HeygenPlatformServiceError(
        "HeyGen permite hasta 10 operaciones PayGo concurrentes. Espera a que termine una operación activa.",
        429,
        "HEYGEN_CONCURRENCY_LIMIT",
      );
    }
  }

  private async listOperations(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_platform_operations")
      .select("id, operation_type, title, provider_id, provider_status, status, estimated_cost_usd, actual_cost_usd, failure_message, output_snapshot, created_at, updated_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  private async listStandaloneAssets(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_standalone_assets")
      .select("id, title, asset_type, public_url, mime_type, duration_seconds, metadata, created_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    return data || [];
  }

  private async readSettings(organizationId: string) {
    const { data, error } = await this.supabase
      .from("heygen_workspace_settings")
      .select("*")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw error;
    return normalizeSettings(data || { organization_id: organizationId });
  }
}

function buildOperationRequest(
  action: HeygenPlatformAction,
  callbackId: string,
  defaults: { defaultBrandGlossaryId: string | null; defaultBrandKitId: string | null },
) {
  const common = { callback_id: callbackId };
  switch (action.action) {
    case "design_voice": return {
      body: { gender: action.gender, locale: action.locale, prompt: action.prompt, seed: action.seed },
      defaultTitle: "Diseño de voz", operationType: "VOICE_DESIGN" as const, path: "/v3/voices", synchronous: true,
    };
    case "clone_voice": return {
      body: { audio: action.audio, language: action.language, remove_background_noise: action.removeBackgroundNoise, voice_name: action.voiceName },
      defaultTitle: action.voiceName, operationType: "VOICE_CLONE" as const, path: "/v3/voices/clone", synchronous: false,
    };
    case "create_glossary": return {
      body: { name: action.name, terms: action.terms }, defaultTitle: action.name,
      operationType: "BRAND_GLOSSARY" as const, path: "/v3/brand-glossaries", synchronous: true,
    };
    case "create_brand_kit": return {
      body: { name: action.name, url: action.url }, defaultTitle: action.name || "Brand kit",
      operationType: "BRAND_KIT" as const, path: "/v3/brand-kits", synchronous: false,
    };
    case "translate_video": return {
      body: { ...common, brand_glossary_id: action.brandGlossaryId || defaults.defaultBrandGlossaryId, disable_music_track: action.disableMusicTrack,
        enable_speech_enhancement: action.enableSpeechEnhancement, input_language: action.inputLanguage,
        mode: action.mode, output_languages: action.outputLanguages, speaker_num: action.speakerNum,
        title: action.title, translate_audio_only: action.translateAudioOnly, video: action.video },
      defaultTitle: "Traducción de video", operationType: "VIDEO_TRANSLATION" as const,
      path: "/v3/video-translations", synchronous: false,
    };
    case "create_proofread": return {
      body: { brand_glossary_id: action.brandGlossaryId || defaults.defaultBrandGlossaryId, disable_music_track: action.disableMusicTrack,
        enable_speech_enhancement: action.enableSpeechEnhancement, mode: action.mode,
        output_languages: action.outputLanguages, speaker_num: action.speakerNum,
        title: action.title || "Revisión de traducción", video: action.video },
      defaultTitle: "Revisión de traducción", operationType: "PROOFREAD" as const,
      path: "/v3/video-translations/proofreads", synchronous: false,
    };
    case "lipsync": return {
      body: { ...common, audio: action.audio, disable_music_track: action.disableMusicTrack,
        enable_speech_enhancement: action.enableSpeechEnhancement, mode: action.mode,
        title: action.title, video: action.video }, defaultTitle: "Corrección lipsync",
      operationType: "LIPSYNC" as const, path: "/v3/lipsyncs", synchronous: false,
    };
    case "ai_clipping": return {
      body: { ...common, input_language: action.inputLanguage, output_settings: {
        aspect_ratio: action.aspectRatio, captions: action.captions, duration_types: action.durationTypes,
        prompt: action.prompt }, title: action.title, video: action.video },
      defaultTitle: "Clips automáticos", operationType: "AI_CLIPPING" as const,
      path: "/v3/ai-clipping", synchronous: false,
    };
    case "remove_fillers": return {
      body: { ...common, title: action.title, video: action.video }, defaultTitle: "Limpieza de muletillas",
      operationType: "FILLER_REMOVAL" as const, path: "/v3/filler-word-removals", synchronous: false,
    };
    case "generate_template": return {
      body: { ...common, brand_glossary_id: action.brandGlossaryId || defaults.defaultBrandGlossaryId, caption: action.caption,
        fps: action.fps, title: action.title, variables: action.variables }, defaultTitle: "Video desde plantilla",
      operationType: "TEMPLATE_VIDEO" as const,
      path: `/v3/templates/${encodeURIComponent(action.templateId)}`, synchronous: false,
    };
    case "video_agent": return {
      body: { ...common, avatar_id: action.avatarId, brand_kit_id: action.brandKitId || defaults.defaultBrandKitId, files: action.files,
        incognito_mode: action.incognitoMode, mode: action.mode, orientation: action.orientation,
        prompt: action.prompt, style_id: action.styleId, voice_id: action.voiceId },
      defaultTitle: "Video Agent", operationType: "VIDEO_AGENT" as const,
      path: "/v3/video-agents", synchronous: false,
    };
    case "video_batch": return {
      body: { callback_url: undefined, folder_id: action.folderId, title: action.title, videos: action.videos },
      defaultTitle: "Lote de videos", operationType: "VIDEO_BATCH" as const,
      path: "/v3/videos/batches", synchronous: false,
    };
  }
}

function statusPaths(type: HeygenPlatformOperationType, output: unknown, providerId: string) {
  const providerIds = readStringArray(toRecord(output)?.provider_ids);
  const ids = providerIds.length > 0 ? providerIds : [providerId];
  const prefix: Partial<Record<HeygenPlatformOperationType, string>> = {
    AI_CLIPPING: "/v3/ai-clipping/", BRAND_KIT: "/v3/brand-kits/",
    FILLER_REMOVAL: "/v3/filler-word-removals/", LIPSYNC: "/v3/lipsyncs/",
    PROOFREAD: "/v3/video-translations/proofreads/", TEMPLATE_VIDEO: "/v3/videos/",
    VIDEO_AGENT: "/v3/video-agents/", VIDEO_BATCH: "/v3/videos/batches/",
    VIDEO_TRANSLATION: "/v3/video-translations/", VOICE_CLONE: "/v3/voices/",
  };
  return prefix[type] ? ids.map((id) => `${prefix[type]}${encodeURIComponent(id)}`) : [];
}

function extractProviderIds(value: unknown): string[] {
  const record = toRecord(value);
  if (!record) return [];
  for (const key of ["video_translation_ids", "proofread_ids", "video_ids"]) {
    const values = readStringArray(record[key]);
    if (values.length > 0) return values;
  }
  for (const key of ["ai_clipping_id", "batch_id", "brand_glossary_id", "brand_kit_id",
    "filler_word_removal_id", "lipsync_id", "proofread_id", "session_id", "video_id",
    "voice_clone_id", "voice_id", "id"]) {
    const valueAtKey = record[key];
    if (typeof valueAtKey === "string" && valueAtKey.trim()) return [valueAtKey.trim()];
  }
  return [];
}

function estimateActionCost(action: HeygenPlatformAction, operation: HeygenPlatformOperationType) {
  if (operation === "VIDEO_TRANSLATION") return estimateHeygenCost({ durationSeconds: action.durationSeconds,
    itemCount: action.action === "translate_video" ? action.outputLanguages.length : 1,
    mode: action.action === "translate_video" ? action.mode : "speed", operation });
  if (operation === "LIPSYNC") return estimateHeygenCost({ durationSeconds: action.durationSeconds,
    mode: action.action === "lipsync" ? action.mode : "speed", operation });
  if (operation === "FILLER_REMOVAL") return estimateHeygenCost({ durationSeconds: action.durationSeconds, operation });
  if (operation === "AI_CLIPPING") return estimateHeygenCost({ itemCount: action.action === "ai_clipping" ? action.durationTypes.length : 1, operation });
  if (operation === "VIDEO_AGENT") return estimateHeygenCost({ durationSeconds: action.durationSeconds, operation });
  return 0;
}

function normalizeSettings(row: Record<string, unknown>) {
  return {
    defaultBrandGlossaryId: readNullableString(row.default_brand_glossary_id),
    defaultBrandKitId: readNullableString(row.default_brand_kit_id),
    defaultLocale: readNullableString(row.default_locale) || "es-MX",
    liveavatarAvatarId: readNullableString(row.liveavatar_avatar_id),
    liveavatarContextId: readNullableString(row.liveavatar_context_id),
    liveavatarSandbox: row.liveavatar_sandbox !== false,
    monthlyBudgetUsd: readNullableNumber(row.monthly_budget_usd),
    perCourseBudgetUsd: readNullableNumber(row.per_course_budget_usd),
  };
}

function buildCapabilityManifest() {
  return [
    "voiceover", "avatar_video", "transparent_avatar", "video_translation", "proofread",
    "lipsync", "voice_design", "voice_clone", "brand_glossary", "brand_kit", "templates",
    "video_agent", "video_batches", "ai_clipping", "filler_removal", "audio_search",
    "hyperframes", "liveavatar",
  ];
}

function unwrapData(value: unknown) { return toRecord(value)?.data ?? value; }
function unwrapList(value: unknown) {
  const unwrapped = unwrapData(value);
  if (Array.isArray(unwrapped)) return unwrapped;
  const record = toRecord(unwrapped);
  if (!record) return [];
  for (const key of ["items", "templates", "brand_glossaries", "brand_kits", "styles", "languages", "data"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}
function readStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : [];
}
function readNullableString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function readNullableNumber(value: unknown) {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : null;
}
function readStatus(value: unknown) {
  const record = toRecord(value);
  const explicit = readNullableString(record?.status) || readNullableString(record?.state);
  if (explicit) return explicit;
  if (readNullableString(record?.failure_message) || readNullableString(record?.error_message)) return "failed";
  if (["video_url", "audio_url", "output_url", "download_url"].some((key) => readNullableString(record?.[key]))) {
    return "completed";
  }
  return null;
}
function isCompleted(status: string | null) { return Boolean(status && ["complete", "completed", "success", "succeeded"].includes(status.toLowerCase())); }
function isFailed(status: string | null) { return Boolean(status && ["cancelled", "canceled", "error", "failed", "failure"].includes(status.toLowerCase())); }
function readFailure(value: unknown) {
  const record = toRecord(value);
  const error = toRecord(record?.error);
  return readNullableString(record?.failure_message) || readNullableString(record?.error_message)
    || readNullableString(error?.message) || "HeyGen reportó que la operación falló.";
}
function redactOperationInput(action: HeygenPlatformAction) {
  return JSON.parse(JSON.stringify(action, (_key, value) => typeof value === "string" && value.length > 20_000 ? "[omitted]" : value));
}
async function safeFeature<T>(loader: () => Promise<T>): Promise<T | { unavailable: true; message: string }> {
  try { return await loader(); }
  catch (error) { return { unavailable: true, message: error instanceof Error ? error.message : "Unavailable" }; }
}
