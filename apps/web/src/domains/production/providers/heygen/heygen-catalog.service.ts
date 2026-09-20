import { HeygenClient } from "./heygen.client";
import {
  normalizeAvatarLooks,
  normalizeVoices,
} from "./heygen-normalizers";
import { HeygenRepository } from "./heygen.repository";
import type {
  HeygenCatalogSyncResult,
  HeygenSupabaseClient,
} from "./heygen.types";

interface HeygenCatalogServiceOptions {
  client?: Pick<HeygenClient,
    "getApiKeySelf" | "getCurrentUser" | "listAllPrivateAvatarLooks" | "listAllPrivateVoices"
  >;
  repository?: HeygenRepository;
  supabase?: HeygenSupabaseClient;
}

export class HeygenCatalogService {
  private readonly client: Pick<HeygenClient,
    "getApiKeySelf" | "getCurrentUser" | "listAllPrivateAvatarLooks" | "listAllPrivateVoices"
  >;
  private readonly repository: HeygenRepository;

  constructor(options: HeygenCatalogServiceOptions = {}) {
    if (!options.repository && !options.supabase) {
      throw new Error("HeygenCatalogService requiere repository o supabase.");
    }

    this.client = options.client || new HeygenClient();
    this.repository =
      options.repository || new HeygenRepository(options.supabase as HeygenSupabaseClient);
  }

  async syncCatalog(
    organizationId: string,
    requestId?: string,
    reservedSyncRunId?: string,
  ): Promise<HeygenCatalogSyncResult> {
    let syncRunId = reservedSyncRunId;
    if (!syncRunId) {
      try {
        syncRunId = await this.repository.beginCatalogSync({ organizationId, requestId });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new HeygenCatalogSyncInProgressError();
        }
        throw error;
      }
    }
    const syncedAt = new Date().toISOString();

    try {
      const [account, apiKey, avatarResponse, voiceResponse] = await Promise.all([
        readOptionalProviderMetadata(() => this.client.getCurrentUser()),
        readOptionalProviderMetadata(() => this.client.getApiKeySelf()),
        this.client.listAllPrivateAvatarLooks(),
        this.client.listAllPrivateVoices(),
      ]);
      if (avatarResponse.hasMore || voiceResponse.hasMore) {
        const message = "HeyGen devolvió un catálogo incompleto; no se aplicaron ausencias remotas.";
        await this.repository.markCatalogSyncIncomplete({
          errorMessage: message,
          organizationId,
          status: "PARTIAL",
          syncRunId,
          syncedAt,
        });
        throw new HeygenCatalogSyncIncompleteError(message);
      }
      const avatars = normalizeAvatarLooks(avatarResponse);
      const voices = normalizeVoices(voiceResponse);
      const accountSnapshot = {
        assetsCatalogAuthoritative: false,
        billingType: account?.billingType || null,
        scopeMode: apiKey?.scopeMode || null,
        scopes: apiKey?.scopes || [],
        subscription: account?.subscription || null,
        usageBased: account?.usageBased || null,
        username: account?.username || null,
        wallet: account?.wallet || null,
      };
      const reconciliation = await this.repository.reconcileCatalogSnapshot({
        accountSnapshot,
        avatars: avatars.map((avatar) => ({
          avatar_type: avatar.avatarType,
          default_voice_id: avatar.defaultVoiceId,
          group_id: avatar.groupId,
          metadata: avatar.metadata,
          name: avatar.name,
          ownership: readOwnership(avatar.metadata),
          preview_image_url: avatar.previewImageUrl,
          preview_video_url: avatar.previewVideoUrl,
          provider_id: avatar.id,
          status: avatar.status,
          supported_api_engines: avatar.supportedApiEngines,
        })),
        organizationId,
        syncRunId,
        syncedAt,
        voices: voices.map((voice) => ({
          gender: voice.gender,
          language: voice.language,
          metadata: voice.metadata,
          name: voice.name,
          ownership: readOwnership(voice.metadata) || voice.type,
          preview_audio_url: voice.previewAudioUrl,
          provider_id: voice.id,
          voice_type: voice.type,
        })),
      });
      const [avatarRows, voiceRows] = await Promise.all([
        this.repository.listAvatarPresets(organizationId),
        this.repository.listVoicePresets(organizationId),
      ]);
      const activeAvatarRows = avatarRows as unknown as Array<{
        default_voice_id?: string | null;
        id: string;
        is_default: boolean;
      }>;
      const activeVoiceRows = voiceRows as unknown as Array<{
        heygen_voice_id: string;
        id: string;
        is_default: boolean;
      }>;

      const defaultAvatarPresetId = await this.ensureDefaultAvatarPreset({
        avatarRows: activeAvatarRows,
        organizationId,
        syncedAt,
      });
      const defaultVoicePresetId = await this.ensureDefaultVoicePreset({
        avatarRows: activeAvatarRows,
        organizationId,
        syncedAt,
        voiceRows: activeVoiceRows,
      });

      return {
        accountUsername: account?.username || null,
        assetCount: reconciliation.assetCount || 0,
        avatarCount: avatars.length,
        defaultAvatarPresetId,
        defaultVoicePresetId,
        missingAssetCount: reconciliation.missingAssetCount || 0,
        missingAvatarCount: reconciliation.missingAvatarCount || 0,
        missingVoiceCount: reconciliation.missingVoiceCount || 0,
        organizationId,
        scopeMode: apiKey?.scopeMode || null,
        scopes: apiKey?.scopes || [],
        syncedAt,
        voiceCount: voices.length,
      };
    } catch (error) {
      if (!(error instanceof HeygenCatalogSyncIncompleteError)) {
        await this.repository.markCatalogSyncIncomplete({
          errorMessage: getErrorMessage(error), organizationId, status: "FAILED", syncRunId, syncedAt,
        });
      }
      throw error;
    }
  }

  private async ensureDefaultAvatarPreset(params: {
    avatarRows: { id: string; is_default: boolean }[];
    organizationId: string;
    syncedAt: string;
  }) {
    const existingDefault = await this.repository.getDefaultAvatarPresetId(
      params.organizationId,
    );
    if (existingDefault) return existingDefault;

    if (params.avatarRows.length !== 1) return null;

    const [singleAvatar] = params.avatarRows;
    await this.repository.setDefaultAvatarPreset({
      organizationId: params.organizationId,
      presetId: singleAvatar.id,
      updatedAt: params.syncedAt,
    });

    return singleAvatar.id;
  }

  private async ensureDefaultVoicePreset(params: {
    avatarRows: { default_voice_id?: string | null }[];
    organizationId: string;
    syncedAt: string;
    voiceRows: { heygen_voice_id: string; id: string }[];
  }) {
    const existingDefault = await this.repository.getDefaultVoicePresetId(
      params.organizationId,
    );
    if (existingDefault) return existingDefault;

    const avatarDefaultVoiceId = params.avatarRows.find(
      (avatar) => avatar.default_voice_id,
    )?.default_voice_id;
    const matchingAvatarVoice = params.voiceRows.find(
      (voice) => voice.heygen_voice_id === avatarDefaultVoiceId,
    );
    const fallbackVoice =
      matchingAvatarVoice || (params.voiceRows.length === 1 ? params.voiceRows[0] : null);

    if (!fallbackVoice) return null;

    await this.repository.setDefaultVoicePreset({
      organizationId: params.organizationId,
      presetId: fallbackVoice.id,
      updatedAt: params.syncedAt,
    });

    return fallbackVoice.id;
  }
}

export class HeygenCatalogSyncIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HeygenCatalogSyncIncompleteError";
  }
}

export class HeygenCatalogSyncInProgressError extends Error {
  constructor() {
    super("Ya existe una sincronización de HeyGen en curso para esta empresa.");
    this.name = "HeygenCatalogSyncInProgressError";
  }
}

function readOwnership(metadata: Record<string, unknown>) {
  return typeof metadata.ownership === "string" ? metadata.ownership : null;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Error desconocido al sincronizar HeyGen.";
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "23505");
}

async function readOptionalProviderMetadata<T>(request: () => Promise<T>): Promise<T | null> {
  try {
    return await request();
  } catch {
    return null;
  }
}
