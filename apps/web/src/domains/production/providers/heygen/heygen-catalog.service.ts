import { getErrorMessage } from "@/lib/errors";
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
  client?: Pick<HeygenClient, "listAllAvatarLooks" | "listAllVoices">;
  repository?: HeygenRepository;
  supabase?: HeygenSupabaseClient;
}

export class HeygenCatalogService {
  private readonly client: Pick<HeygenClient, "listAllAvatarLooks" | "listAllVoices">;
  private readonly repository: HeygenRepository;

  constructor(options: HeygenCatalogServiceOptions = {}) {
    if (!options.repository && !options.supabase) {
      throw new Error("HeygenCatalogService requiere repository o supabase.");
    }

    this.client = options.client || new HeygenClient();
    this.repository =
      options.repository || new HeygenRepository(options.supabase as HeygenSupabaseClient);
  }

  async syncCatalog(organizationId: string): Promise<HeygenCatalogSyncResult> {
    const syncedAt = new Date().toISOString();

    try {
      const [avatarResponse, voiceResponse] = await Promise.all([
        this.client.listAllAvatarLooks(),
        this.client.listAllVoices(),
      ]);
      const avatars = normalizeAvatarLooks(avatarResponse);
      const voices = normalizeVoices(voiceResponse);

      const [avatarRows, voiceRows] = await Promise.all([
        this.repository.upsertAvatarPresets({
          avatars,
          organizationId,
          syncedAt,
        }),
        this.repository.upsertVoicePresets({
          organizationId,
          syncedAt,
          voices,
        }),
      ]);

      const defaultAvatarPresetId = await this.ensureDefaultAvatarPreset({
        avatarRows,
        organizationId,
        syncedAt,
      });
      const defaultVoicePresetId = await this.ensureDefaultVoicePreset({
        avatarRows,
        organizationId,
        syncedAt,
        voiceRows,
      });

      await this.repository.markWorkspaceSyncSucceeded(organizationId, syncedAt);

      return {
        avatarCount: avatars.length,
        defaultAvatarPresetId,
        defaultVoicePresetId,
        organizationId,
        syncedAt,
        voiceCount: voices.length,
      };
    } catch (error) {
      await this.repository.markWorkspaceSyncFailed({
        errorMessage: getErrorMessage(error),
        organizationId,
        syncedAt,
      });
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
