import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeAvatarLooks,
  normalizeVoices,
} from "../heygen-normalizers";
import {
  HeygenCatalogService,
  HeygenCatalogSyncIncompleteError,
} from "../heygen-catalog.service";

describe("HeyGen catalog service", () => {
  it("reconciles avatars and voices while treating account metadata as optional", async () => {
    let reconciled: Record<string, unknown> | null = null;
    const repository = {
      async beginCatalogSync() { return "11111111-1111-4111-8111-111111111111"; },
      async getDefaultAvatarPresetId() { return null; },
      async getDefaultVoicePresetId() { return null; },
      async listAvatarPresets() { return [{ default_voice_id: "voice-1", id: "22222222-2222-4222-8222-222222222222", is_default: false }]; },
      async listVoicePresets() { return [{ heygen_voice_id: "voice-1", id: "33333333-3333-4333-8333-333333333333", is_default: false }]; },
      async markCatalogSyncIncomplete() { throw new Error("unexpected incomplete sync"); },
      async reconcileCatalogSnapshot(params: Record<string, unknown>) {
        reconciled = params;
        return { assetCount: 4, missingAssetCount: 0, missingAvatarCount: 2, missingVoiceCount: 3 };
      },
      async setDefaultAvatarPreset() {},
      async setDefaultVoicePreset() {},
    };
    const service = new HeygenCatalogService({
      client: {
        async getApiKeySelf() { return { expiresAt: null, name: "Courseforge", raw: {}, scopeMode: "custom", scopes: ["avatars:read"] }; },
        async getCurrentUser() { return { billingType: "wallet", email: null, firstName: null, lastName: null, raw: {}, subscription: null, usageBased: null, username: "workspace", wallet: { remaining_balance: 10 } }; },
        async listAllPrivateAvatarLooks() { return { data: [{ id: "avatar-1", name: "Avatar", ownership: "private", supported_api_engines: ["avatar_iv"] }], hasMore: false, nextToken: null, raw: {} }; },
        async listAllPrivateVoices() { return { data: [{ voice_id: "voice-1", name: "Voice", type: "private" }], hasMore: false, nextToken: null, raw: {} }; },
      } as never,
      repository: repository as never,
    });

    const result = await service.syncCatalog("44444444-4444-4444-8444-444444444444");
    assert.equal(result.assetCount, 4);
    assert.equal(result.missingAvatarCount, 2);
    assert.equal((reconciled as unknown as { avatars: Array<{ ownership: string }> }).avatars[0]?.ownership, "private");
  });

  it("does not reconcile removals when any provider catalog is incomplete", async () => {
    let reconciled = false;
    let incompleteStatus = "";
    const service = new HeygenCatalogService({
      client: {
        async getApiKeySelf() { return { expiresAt: null, name: null, raw: {}, scopeMode: "full", scopes: [] }; },
        async getCurrentUser() { return { billingType: null, email: null, firstName: null, lastName: null, raw: {}, subscription: null, usageBased: null, username: "workspace", wallet: null }; },
        async listAllPrivateAvatarLooks() { return { data: [], hasMore: true, nextToken: "next", raw: {} }; },
        async listAllPrivateVoices() { return { data: [], hasMore: false, nextToken: null, raw: {} }; },
      } as never,
      repository: {
        async beginCatalogSync() { return "11111111-1111-4111-8111-111111111111"; },
        async markCatalogSyncIncomplete(params: { status: string }) { incompleteStatus = params.status; },
        async reconcileCatalogSnapshot() { reconciled = true; return {}; },
      } as never,
    });

    await assert.rejects(
      () => service.syncCatalog("44444444-4444-4444-8444-444444444444"),
      HeygenCatalogSyncIncompleteError,
    );
    assert.equal(incompleteStatus, "PARTIAL");
    assert.equal(reconciled, false);
  });

  it("keeps core catalog synchronization available without account metadata permissions", async () => {
    const accountSnapshots: Record<string, unknown>[] = [];
    const service = new HeygenCatalogService({
      client: {
        async getApiKeySelf() { throw new Error("not supported"); },
        async getCurrentUser() { throw new Error("insufficient_api_key_scope"); },
        async listAllPrivateAvatarLooks() { return { data: [], hasMore: false, nextToken: null, raw: {} }; },
        async listAllPrivateVoices() { return { data: [], hasMore: false, nextToken: null, raw: {} }; },
      } as never,
      repository: {
        async beginCatalogSync() { return "11111111-1111-4111-8111-111111111111"; },
        async getDefaultAvatarPresetId() { return null; },
        async getDefaultVoicePresetId() { return null; },
        async listAvatarPresets() { return []; },
        async listVoicePresets() { return []; },
        async markCatalogSyncIncomplete() {},
        async reconcileCatalogSnapshot(params: { accountSnapshot: Record<string, unknown> }) {
          accountSnapshots.push(params.accountSnapshot);
          return { assetCount: 0 };
        },
      } as never,
    });

    const result = await service.syncCatalog("44444444-4444-4444-8444-444444444444");
    assert.equal(result.accountUsername, null);
    assert.equal(result.avatarCount, 0);
    assert.equal(accountSnapshots[0]?.assetsCatalogAuthoritative, false);
  });

  it("normalizes private avatar looks from a HeyGen-style data wrapper", () => {
    const avatars = normalizeAvatarLooks({
      data: {
        avatar_looks: [
          {
            avatar_type: "digital_twin",
            default_voice_id: "voice-1",
            group_id: "group-1",
            id: "avatar-look-1",
            name: "Instructor principal",
            preview_image_url: "https://cdn.heygen.com/avatar.png",
            preview_video_url: "https://cdn.heygen.com/avatar.mp4",
            status: "ready",
            supported_api_engines: ["avatar_iv", "avatar_v"],
          },
        ],
      },
    });

    assert.equal(avatars.length, 1);
    assert.equal(avatars[0].id, "avatar-look-1");
    assert.equal(avatars[0].defaultVoiceId, "voice-1");
    assert.deepEqual(avatars[0].supportedApiEngines, ["avatar_iv", "avatar_v"]);
    assert.equal(avatars[0].metadata.source, "heygen_api_v3");
  });

  it("normalizes avatar looks from the official v3 data array response", () => {
    const avatars = normalizeAvatarLooks({
      data: [
        {
          default_voice_id: "voice-1",
          group_id: "group-1",
          id: "avatar-look-1",
          name: "Instructor principal",
          preview_image_url: "https://cdn.heygen.com/avatar.png",
          status: "completed",
          supported_api_engines: ["avatar_iv"],
        },
      ],
      has_more: false,
      next_token: null,
    });

    assert.equal(avatars.length, 1);
    assert.equal(avatars[0].id, "avatar-look-1");
    assert.equal(avatars[0].status, "completed");
  });

  it("normalizes voices from alternate field names without storing raw payloads", () => {
    const voices = normalizeVoices({
      data: {
        voices: [
          {
            display_name: "Narradora SofLIA",
            gender: "female",
            language_code: "es-MX",
            preview_url: "https://cdn.heygen.com/voice.mp3",
            voiceId: "voice-2",
            voice_type: "private",
          },
        ],
      },
    });

    assert.equal(voices.length, 1);
    assert.equal(voices[0].id, "voice-2");
    assert.equal(voices[0].name, "Narradora SofLIA");
    assert.equal(voices[0].language, "es-MX");
    assert.equal("voiceId" in voices[0].metadata, false);
  });

  it("normalizes voices from the official v3 data array response", () => {
    const voices = normalizeVoices({
      data: [
        {
          display_name: "Narradora SofLIA",
          gender: "female",
          id: "voice-2",
          language: "es-MX",
          preview_audio_url: "https://cdn.heygen.com/voice.mp3",
          voice_type: "private",
        },
      ],
    });

    assert.equal(voices.length, 1);
    assert.equal(voices[0].id, "voice-2");
    assert.equal(voices[0].name, "Narradora SofLIA");
  });

  it("rejects catalog items that cannot be mapped to provider ids", () => {
    assert.throws(() =>
      normalizeAvatarLooks({
        data: {
          avatar_looks: [{ name: "Avatar sin ID" }],
        },
      }),
    );
  });
});
