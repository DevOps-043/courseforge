import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HeygenApiError, HeygenClient } from "../heygen.client";
import { buildResolutionRejectionHint } from "../heygen-request-constraints";
import { heygenGenerateVoiceoverRequestSchema, heygenJobStatusResponseSchema } from "../heygen.validators";
import { readApiResponse } from "../../../../../lib/client/api-response";
import { estimateHeygenCost } from "../heygen-cost.service";
import { heygenPlatformActionSchema } from "../heygen-platform.validators";

describe("HeyGen separated track client", () => {
  it("paginates public and private Starfish voices without duplicates", async () => {
    const requested: string[] = [];
    const client = new HeygenClient({
      apiKey: "test-key",
      fetchImpl: async (input) => {
        const url = String(input); requested.push(url);
        const isPrivate = url.includes("type=private");
        const isSecond = url.includes("token=next");
        return Response.json({
          data: [{ id: isSecond ? `${isPrivate ? "private" : "public"}-2` : "shared" }],
          has_more: !isSecond,
          next_token: isSecond ? null : "next",
        });
      },
    });
    const result = await client.listAllVoices();
    assert.equal(result.data.length, 3);
    assert.ok(requested.some((url) => url.includes("type=public")));
    assert.ok(requested.some((url) => url.includes("type=private")));
  });

  it("paginates the remote video catalog used to repair orphaned jobs", async () => {
    const requested: string[] = [];
    const client = new HeygenClient({
      apiKey: "test-key",
      fetchImpl: async (input) => {
        const url = String(input);
        requested.push(url);
        const secondPage = url.includes("token=next-page");
        return Response.json({
          data: [{
            created_at: secondPage ? 2 : 1,
            status: "completed",
            title: secondPage ? "Second" : "First",
            video_id: secondPage ? "video-2" : "video-1",
          }],
          has_more: !secondPage,
          next_token: secondPage ? null : "next-page",
        });
      },
    });

    const result = await client.listAllVideos();

    assert.deepEqual(result.data.map((video) => video.videoId), ["video-1", "video-2"]);
    assert.ok(requested[0]?.includes("/v3/videos?"));
    assert.ok(requested[1]?.includes("token=next-page"));
  });

  it("validates audio-only translation and estimates its public rate", () => {
    const action = heygenPlatformActionSchema.parse({
      action: "translate_video",
      durationSeconds: 120,
      mode: "speed",
      outputLanguages: ["Spanish (Mexico)", "English"],
      translateAudioOnly: true,
      video: { type: "asset_id", asset_id: "asset-video" },
    });
    if (action.action !== "translate_video") throw new Error("Unexpected action type.");
    assert.equal(action.translateAudioOnly, true);
    assert.equal(estimateHeygenCost({
      durationSeconds: action.durationSeconds,
      itemCount: action.outputLanguages.length,
      mode: action.mode,
      operation: "VIDEO_TRANSLATION",
    }), 7.992);
  });

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

  it("accepts audio-only generation without requiring an avatar", () => {
    const payload = heygenGenerateVoiceoverRequestSchema.parse({
      script: "Narración independiente",
      speed: 1.15,
      voicePresetId: "550e8400-e29b-41d4-a716-446655440000",
    });

    assert.equal(payload.script, "Narración independiente");
    assert.equal(payload.speed, 1.15);
    assert.equal("avatarPresetId" in payload, false);
  });

  it("retries an idempotent video submission after a transient provider failure", async () => {
    let attempts = 0;
    const idempotencyKeys: string[] = [];
    const client = new HeygenClient({
      apiKey: "test-key",
      createVideoMaxAttempts: 2,
      createVideoRetryDelayMs: 0,
      fetchImpl: async (_input, init) => {
        attempts += 1;
        idempotencyKeys.push(new Headers(init?.headers).get("Idempotency-Key") || "");
        if (attempts === 1) {
          return Response.json(
            { error: { message: "temporary outage" } },
            { status: 503 },
          );
        }
        return Response.json({ data: { video_id: "video-recovered", status: "pending" } });
      },
    });

    const result = await client.createAvatarVideo({
      aspect_ratio: "16:9",
      audio_url: "https://courseforge.example.com/voice.wav",
      avatar_id: "avatar-1",
      output_format: "mp4",
      resolution: "1080p",
      title: "Leccion",
      type: "avatar",
    }, "job-retry-1");

    assert.equal(result.videoId, "video-recovered");
    assert.equal(attempts, 2);
    assert.deepEqual(idempotencyKeys, ["job-retry-1", "job-retry-1"]);
  });

  it("classifies a client-side abort as an uncertain timeout instead of a provider rejection", async () => {
    const client = new HeygenClient({
      apiKey: "test-key",
      createVideoMaxAttempts: 1,
      timeoutMs: 5,
      fetchImpl: async (_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    });

    await assert.rejects(
      () => client.createAvatarVideo({
        aspect_ratio: "16:9",
        audio_url: "https://courseforge.example.com/voice.wav",
        avatar_id: "avatar-1",
        output_format: "mp4",
        resolution: "1080p",
        title: "Leccion",
        type: "avatar",
      }, "job-timeout-1"),
      (error: unknown) => {
        assert.ok(error instanceof HeygenApiError);
        assert.equal(error.status, 408);
        return true;
      },
    );
  });

  it("only suggests lowering resolution when the provider actually mentions that restriction", () => {
    const genericHint = buildResolutionRejectionHint("1080p", {
      message: "temporary upstream error",
    });
    const resolutionHint = buildResolutionRejectionHint("1080p", {
      message: "resolution not available on current plan",
    });

    assert.doesNotMatch(genericHint, /720p/);
    assert.match(resolutionHint, /720p/);
    assert.match(resolutionHint, /1080p/);
  });

  it("turns an HTML gateway timeout into a useful API message", async () => {
    const response = new Response("<HTML><title>Gateway timeout</title></HTML>", {
      status: 504,
      headers: { "Content-Type": "text/html" },
    });

    await assert.rejects(
      () => readApiResponse(response),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(error.message, /excedio el tiempo de la API/);
        assert.doesNotMatch(error.message, /Unexpected token/);
        return true;
      },
    );
  });

  it("keeps provider failure details in the job status contract", () => {
    const parsed = heygenJobStatusResponseSchema.parse({
      asset: null,
      jobId: "1a2c324b-63f3-44c8-aa38-02d0e5043281",
      providerErrorCode: "MOVIO_PAYMENT_INSUFFICIENT_CREDIT",
      providerErrorMessage: "Insufficient credit.",
      providerJobId: "70ca554eb07f41bebb6c00e7c5fd768e",
      scriptHash: null,
      status: "FAILED",
      voiceAsset: null,
    });

    assert.equal(parsed.providerErrorCode, "MOVIO_PAYMENT_INSUFFICIENT_CREDIT");
    assert.equal(parsed.providerErrorMessage, "Insufficient credit.");
  });
});
