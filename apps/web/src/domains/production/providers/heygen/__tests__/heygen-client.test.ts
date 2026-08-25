import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HeygenClient } from "../heygen.client";

describe("HeyGen separated track client", () => {
  it("lists only voices compatible with the TTS engine used for separated tracks", async () => {
    let capturedUrl = "";
    const client = new HeygenClient({
      apiKey: "test-key",
      fetchImpl: async (input) => {
        capturedUrl = String(input);
        return Response.json({ data: [] });
      },
    });

    await client.listVoices();

    assert.match(capturedUrl, /engine=starfish/);
  });

  it("generates speech and preserves word-level synchronization metadata", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> | null = null;
    const client = new HeygenClient({
      apiKey: "test-key",
      fetchImpl: async (input, init) => {
        capturedUrl = String(input);
        capturedBody = JSON.parse(String(init?.body));
        return Response.json({
          data: {
            audio_url: "https://resource2.heygen.ai/text_to_speech/voice.wav",
            duration: 2.75,
            request_id: "speech-request-1",
            word_timestamps: [
              { word: "Hola", start: 0.1, end: 0.4 },
              { word: "mundo", start: 0.5, end: 0.9 },
            ],
          },
        });
      },
    });

    const result = await client.generateSpeech({
      speed: 1,
      text: "Hola mundo",
      voice_id: "voice-1",
    });

    assert.equal(capturedUrl, "https://api.heygen.com/v3/voices/speech");
    assert.deepEqual(capturedBody, {
      speed: 1,
      text: "Hola mundo",
      voice_id: "voice-1",
    });
    assert.equal(result.durationSeconds, 2.75);
    assert.equal(result.requestId, "speech-request-1");
    assert.equal(result.wordTimestamps[1]?.word, "mundo");
  });

  it("submits the generated audio URL as the avatar timing source", async () => {
    let capturedBody: Record<string, unknown> | null = null;
    const client = new HeygenClient({
      apiKey: "test-key",
      fetchImpl: async (_input, init) => {
        capturedBody = JSON.parse(String(init?.body));
        return Response.json({ data: { video_id: "video-1", status: "pending" } });
      },
    });

    await client.createAvatarVideo({
      aspect_ratio: "16:9",
      audio_url: "https://courseforge.example.com/voice.wav",
      avatar_id: "avatar-1",
      output_format: "mp4",
      resolution: "1080p",
      title: "Leccion",
      type: "avatar",
    }, "job-1");

    const submittedBody = capturedBody as Record<string, unknown> | null;
    assert.equal(submittedBody?.audio_url, "https://courseforge.example.com/voice.wav");
    assert.equal("script" in (submittedBody || {}), false);
    assert.equal("voice_id" in (submittedBody || {}), false);
  });
});
