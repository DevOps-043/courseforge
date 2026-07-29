import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  normalizeAvatarLooks,
  normalizeVoices,
} from "../heygen-normalizers";

describe("HeyGen catalog service", () => {
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
