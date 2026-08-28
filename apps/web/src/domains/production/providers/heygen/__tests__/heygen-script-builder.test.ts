import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildHeygenCreateClipPayload,
  getReusableSceneVoiceAsset,
  HeygenScenesService,
  reconcileVoiceClips,
} from "../heygen-scenes.service";
import { buildHeygenScriptFromComponent } from "../heygen-script-builder";

describe("HeyGen script builder", () => {
  it("builds a talking-head script from video script sections", () => {
    const script = buildHeygenScriptFromComponent({
      componentContent: {
        script: {
          sections: [
            {
              duration_seconds: 8,
              narration_text: "Primero revisaremos el objetivo de aprendizaje.",
            },
            {
              duration_seconds: 12,
              narration_text: "Despues conectaremos ese objetivo con una practica concreta.",
            },
          ],
          title: "Introduccion al modulo",
        },
      },
      componentType: "VIDEO_THEORETICAL",
    });

    assert.equal(script.durationEstimateSeconds, 20);
    assert.equal(script.sectionCount, 2);
    assert.equal(script.title, "Introduccion al modulo");
    assert.match(script.scriptHash, /^[a-f0-9]{64}$/);
    assert.equal(
      script.scriptText,
      [
        "Primero revisaremos el objetivo de aprendizaje.",
        "Despues conectaremos ese objetivo con una practica concreta.",
      ].join("\n\n"),
    );
  });

  it("falls back to storyboard narration when script sections are absent", () => {
    const script = buildHeygenScriptFromComponent({
      componentContent: {
        storyboard: [
          {
            narration_text:
              "Esta demostracion muestra como validar un resultado antes de publicarlo.",
          },
        ],
        title: "Demo QA",
      },
      componentType: "VIDEO_DEMO",
    });

    assert.equal(script.sectionCount, 1);
    assert.equal(script.title, "Demo QA");
    assert.ok(script.durationEstimateSeconds > 0);
  });

  it("rejects components without enough narration", () => {
    assert.throws(
      () =>
        buildHeygenScriptFromComponent({
          componentContent: { script: { sections: [{ narration_text: "Hola" }] } },
          componentType: "VIDEO_GUIDE",
        }),
      /guion narrativo suficiente/,
    );
  });
});

describe("HeyGen scene clip builder", () => {
  it("uses the separated voice URL as the timing source for every avatar clip", () => {
    const payload = buildHeygenCreateClipPayload({
      audioUrl: "https://files.heygen.ai/voice-scene-1.mp3",
      avatarId: "avatar-look-1",
      clip: {
        id: "scene-1",
        order: 1,
        script_text: "Narracion independiente por escena.",
        status: "DRAFT",
      },
      componentId: "component-1",
      options: {
        aspectRatio: "16:9",
        caption: false,
        clipIds: ["scene-1"],
        clips: [],
        componentId: "component-1",
        engine: "avatar_iv",
        outputFormat: "mp4",
        resolution: "1080p",
      },
    });

    assert.equal(payload.audio_url, "https://files.heygen.ai/voice-scene-1.mp3");
    assert.equal(payload.script, undefined);
    assert.equal(payload.voice_id, undefined);
  });

  it("marks a voice clip stale when its scene script changes", () => {
    const originalHash = createHash("sha256").update("Guion original").digest("hex");
    const reconciled = reconcileVoiceClips(
      [{
        clip_id: "scene-1",
        id: "voice-scene-1",
        order: 1,
        public_url: "https://cdn.example.com/voice.mp3",
        script_hash: originalHash,
        status: "COMPLETED",
        storage_path: "production-assets/voice.mp3",
      }],
      [{
        id: "scene-1",
        order: 1,
        script_text: "Guion actualizado",
        status: "DRAFT",
      }],
    );

    assert.equal(reconciled[0]?.status, "STALE");
  });

  it("reuses a current independent scene voice when submitting its avatar clip", () => {
    const scriptHash = createHash("sha256").update("Guion vigente").digest("hex");
    const reusableVoice = getReusableSceneVoiceAsset({
      asset_id: "6ae2d2dc-667d-4200-8e0d-0b49f051cf85",
      clip_id: "scene-1",
      duration: 4.2,
      id: "voice-scene-1",
      order: 1,
      public_url: "https://cdn.example.com/voice.mp3",
      script_hash: scriptHash,
      status: "COMPLETED",
      storage_path: "production-assets/voice.mp3",
    }, scriptHash);

    assert.equal(reusableVoice?.publicUrl, "https://cdn.example.com/voice.mp3");
    assert.equal(reusableVoice?.id, "6ae2d2dc-667d-4200-8e0d-0b49f051cf85");
    assert.equal(getReusableSceneVoiceAsset({
      clip_id: "scene-1",
      id: "voice-scene-1",
      order: 1,
      public_url: "https://cdn.example.com/old-voice.mp3",
      script_hash: "outdated",
      status: "COMPLETED",
      storage_path: "production-assets/old-voice.mp3",
    }, scriptHash), null);
  });

  it("preserves manual clips and hidden deleted storyboard clips", () => {
    const service = new HeygenScenesService({} as any, {} as any);
    const clips = service.buildSceneClips({
      componentContent: {
        storyboard: [
          {
            narration_text: "Escena base que se mantiene.",
            take_number: 1,
            visual_type: "avatar_focus",
          },
          {
            narration_text: "Escena base eliminada por edicion.",
            take_number: 2,
            visual_type: "avatar_focus",
          },
        ],
      },
      existingClips: [
        {
          deleted: true,
          id: "scene-2",
          order: 2,
          origin: "storyboard",
          script_text: "Escena base eliminada por edicion.",
          status: "DRAFT",
        },
        {
          id: "manual-split",
          order: 3,
          origin: "manual",
          script_text: "Nueva division manual del guion.",
          status: "DRAFT",
        },
      ],
    });

    assert.deepEqual(
      clips.map((clip) => [clip.id, clip.origin, clip.deleted === true]),
      [
        ["scene-1", "storyboard", false],
        ["scene-2", "storyboard", true],
        ["manual-split", "manual", false],
      ],
    );
  });
});
