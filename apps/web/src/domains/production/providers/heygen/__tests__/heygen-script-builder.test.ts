import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import {
  buildHeygenCreateClipPayload,
  getReusableSceneVoiceAsset,
  HeygenScenesService,
  mergeAuthoredSceneClip,
  mergeSceneClipsForConcurrentGeneration,
  reconcileVoiceClips,
  selectRecoverableHistoricalSceneJobs,
  selectRecoverableHistoricalSceneJobsForClips,
  selectPromotableAvatarVoices,
} from "../heygen-scenes.service";
import { resetGeneratedSceneAssets } from "../heygen-scene-assets";
import {
  estimateHeygenAvatarGenerationBudget,
  readHeygenAvailableBalance,
} from "../heygen-billing";
import { PRODUCTION_JOB_STATUSES } from "../../../types/production.types";
import { buildHeygenScriptFromComponent } from "../heygen-script-builder";
import {
  buildHeygenSceneAssetNames,
  buildCorrelatedHeygenVideoTitle,
  readHeygenJobIdFromVideoTitle,
  resolveHeygenJobFileStem,
} from "../heygen-asset-naming";

describe("HeyGen script builder", () => {
  it("uses an authored scene name for the HeyGen title and returned files", () => {
    const names = buildHeygenSceneAssetNames({
      clip: { asset_name: "Lección 6 – Cierre ejecutivo", id: "scene-4", order: 4 },
      context: { lessonTitle: "Título de respaldo" },
    });

    assert.equal(names.videoTitle, "Lección 6 – Cierre ejecutivo · Avatar");
    assert.equal(names.videoFileStem, "leccion-6-cierre-ejecutivo-avatar");
    assert.equal(names.audioFileStem, "leccion-6-cierre-ejecutivo-voz");
    assert.equal(resolveHeygenJobFileStem({ video_file_stem: names.videoFileStem }, "video"), names.videoFileStem);
  });

  it("falls back to a lesson and scene name when the author leaves it blank", () => {
    const names = buildHeygenSceneAssetNames({
      clip: { id: "scene-2", order: 2 },
      context: { lessonTitle: "Propuesta de valor" },
    });

    assert.equal(names.displayName, "Propuesta de valor · Escena 02");
    assert.equal(names.videoTitle, "Propuesta de valor · Escena 02 · Avatar");
  });

  it("does not let a stale worker collapse completed scene media to its last clip", () => {
    const current = [1, 2, 3, 4].map((order) => ({
      asset_name: order === 1 ? "Nombre actualizado" : undefined,
      duration: 10 + order,
      id: `scene-${order}`,
      job_id: `00000000-0000-4000-8000-00000000000${order}`,
      order,
      public_url: `https://cdn.example.com/avatar-${order}.mp4`,
      script_text: `Escena ${order}`,
      status: "COMPLETED" as const,
      storage_path: `production-assets/avatar-${order}.mp4`,
    }));
    const staleWorker = current.map((clip, index) => ({
      ...clip,
      asset_name: undefined,
      duration: index === 3 ? clip.duration : undefined,
      public_url: index === 3 ? clip.public_url : undefined,
      status: index === 3 ? "COMPLETED" as const : "WAITING_PROVIDER" as const,
      storage_path: index === 3 ? clip.storage_path : undefined,
    }));

    const merged = mergeSceneClipsForConcurrentGeneration(current, staleWorker);

    assert.equal(merged.filter((clip) => clip.status === "COMPLETED").length, 4);
    assert.deepEqual(merged.map((clip) => clip.public_url), current.map((clip) => clip.public_url));
    assert.equal(merged[0]?.asset_name, "Nombre actualizado");
  });

  it("embeds a durable job correlation without exceeding HeyGen's title limit", () => {
    const jobId = "7adc8b88-d144-432a-9046-2528e1c54bfd";
    const title = buildCorrelatedHeygenVideoTitle("Una lección con un título muy largo ".repeat(8), jobId);

    assert.ok(title.length <= 120);
    assert.equal(readHeygenJobIdFromVideoTitle(title), jobId);
    assert.equal(readHeygenJobIdFromVideoTitle("Avatar 1"), null);
  });

  it("prefers provider progress from the newest generation revision", () => {
    const merged = mergeSceneClipsForConcurrentGeneration(
      [{
        generation_revision: 2,
        id: "scene-1",
        job_id: "job-new",
        order: 1,
        script_text: "Guion vigente",
        status: "WAITING_PROVIDER",
      }],
      [{
        generation_revision: 1,
        id: "scene-1",
        job_id: "job-old",
        order: 1,
        public_url: "https://cdn.example.com/old.mp4",
        script_text: "Guion anterior",
        status: "COMPLETED",
        storage_path: "production-assets/old.mp4",
      }],
    );

    assert.equal(merged[0]?.generation_revision, 2);
    assert.equal(merged[0]?.job_id, "job-new");
    assert.equal(merged[0]?.status, "WAITING_PROVIDER");
    assert.equal(merged[0]?.public_url, undefined);
  });

  it("recovers the newest usable historical job without retrying a credit failure", () => {
    const common = {
      artifact_id: "artifact-1",
      material_component_id: "component-1",
      organization_id: "organization-1",
    };
    const selected = selectRecoverableHistoricalSceneJobs([
      {
        ...common,
        id: "job-credit-failure",
        input_snapshot: { clip_id: "scene-1" },
        provider_job_id: null,
        status: PRODUCTION_JOB_STATUSES.FAILED,
      },
      {
        ...common,
        id: "job-scene-1-completed",
        input_snapshot: { clip_id: "scene-1" },
        provider_job_id: "heygen-video-1",
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
      },
      {
        ...common,
        id: "job-scene-2-current",
        input_snapshot: { clip_id: "scene-2" },
        provider_job_id: "heygen-video-2-current",
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
      },
      {
        ...common,
        id: "job-scene-2-old",
        input_snapshot: { clip_id: "scene-2" },
        provider_job_id: "heygen-video-2-old",
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
      },
    ]);

    assert.equal(selected.get("scene-1")?.id, "job-scene-1-completed");
    assert.equal(selected.get("scene-2")?.id, "job-scene-2-current");
    assert.equal(selected.size, 2);
  });

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
  it("preserves completed generated media when the author saves a stale scene form", () => {
    const merged = mergeAuthoredSceneClip(
      {
        id: "scene-1",
        order: 1,
        script_text: "Guion vigente",
        public_url: "https://cdn.example.com/avatar-1.mp4",
        storage_path: "production-assets/avatar-1.mp4",
        job_id: "job-1",
        status: "COMPLETED",
      },
      {
        id: "scene-1",
        order: 1,
        script_text: "Guion vigente",
        status: "DRAFT",
      },
    );

    assert.equal(merged.status, "COMPLETED");
    assert.equal(merged.job_id, "job-1");
    assert.equal(merged.storage_path, "production-assets/avatar-1.mp4");
  });

  it("marks generated media stale when an authored scene changes its script", () => {
    const merged = mergeAuthoredSceneClip(
      {
        id: "scene-1",
        order: 1,
        script_text: "Guion anterior",
        status: "COMPLETED",
        voice_status: "COMPLETED",
      },
      {
        id: "scene-1",
        order: 1,
        script_text: "Guion nuevo",
        status: "DRAFT",
      },
    );

    assert.equal(merged.status, "STALE");
    assert.equal(merged.voice_status, "STALE");
    assert.equal(merged.generation_revision, 1);
  });

  it("does not attach a historical video to a reused scene id with a different script", () => {
    const currentScript = "Guion vigente";
    const historicalScript = "Guion anterior";
    const selected = selectRecoverableHistoricalSceneJobsForClips(
      [{ id: "scene-1", order: 1, script_text: currentScript, status: "DRAFT" }],
      [{
        artifact_id: "artifact-1",
        id: "job-old",
        input_snapshot: {
          clip_id: "scene-1",
          script_hash: createHash("sha256").update(historicalScript).digest("hex"),
        },
        material_component_id: "component-1",
        organization_id: "organization-1",
        provider_job_id: "heygen-video-old",
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
      }],
    );

    assert.equal(selected.size, 0);
  });

  it("remaps a historical job when its script hash uniquely moved to another scene id", () => {
    const script = "Guion que conserva identidad";
    const job = {
      artifact_id: "artifact-1",
      id: "job-moved",
      input_snapshot: {
        clip_id: "scene-9",
        script_hash: createHash("sha256").update(script).digest("hex"),
      },
      material_component_id: "component-1",
      organization_id: "organization-1",
      provider_job_id: "heygen-video-moved",
      status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
    };
    const selected = selectRecoverableHistoricalSceneJobsForClips(
      [
        { id: "scene-1", order: 1, script_text: "Otro guion", status: "DRAFT" },
        { id: "scene-2", order: 2, script_text: script, status: "DRAFT" },
      ],
      [job],
    );

    assert.equal(selected.get("scene-2")?.id, "job-moved");
  });

  it("keeps a failed voice job eligible only for non-generating historical recovery", () => {
    const clips = [{
      id: "scene-1",
      order: 1,
      script_text: "Narración vigente",
      status: "DRAFT" as const,
    }];
    const jobs = [{
      artifact_id: "artifact-1",
      id: "voice-job-1",
      input_snapshot: {
        clip_id: "scene-1",
        script_hash: createHash("sha256").update("Narración vigente").digest("hex"),
      },
      job_type: "HEYGEN_VOICEOVER",
      status: "FAILED",
    }];

    const selected = selectRecoverableHistoricalSceneJobsForClips(clips, jobs);

    assert.equal(selected.get("scene-1")?.id, "voice-job-1");
  });

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
        generationTarget: "avatar",
        outputFormat: "mp4",
        resolution: "1080p",
        speed: 1,
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

  it("clears generated avatar and voice assets without deleting the scene", () => {
    const reset = resetGeneratedSceneAssets({
      avatarClips: [
        {
          avatar_preset_id: "avatar-preset-1",
          duration: 33.9,
          external_id: "heygen-video-1",
          file_name: "scene-1.mp4",
          generation_revision: 2,
          has_audio: false,
          id: "scene-1",
          job_id: "job-1",
          order: 1,
          origin: "storyboard",
          provider: "HEYGEN",
          public_url: "https://cdn.example.com/scene-1.mp4",
          script_hash: "script-hash",
          script_text: "Guion que debe conservarse.",
          source_hash: "source-hash",
          status: "COMPLETED",
          storage_path: "heygen/scene-1.mp4",
          voice_preset_id: "voice-preset-1",
          voice_status: "COMPLETED",
          voice_speed: 1.1,
        },
        {
          id: "scene-2",
          order: 2,
          public_url: "https://cdn.example.com/scene-2.mp4",
          script_text: "Otra escena.",
          status: "COMPLETED",
        },
      ],
      clipIds: ["scene-1"],
      voiceClips: [
        {
          clip_id: "scene-1",
          id: "voice-scene-1",
          order: 1,
          public_url: "https://cdn.example.com/scene-1.mp3",
          script_hash: "script-hash",
          status: "COMPLETED",
        },
        {
          clip_id: "scene-2",
          id: "voice-scene-2",
          order: 2,
          public_url: "https://cdn.example.com/scene-2.mp3",
          script_hash: "other-hash",
          status: "COMPLETED",
        },
      ],
    });

    assert.deepEqual(reset.voiceClips.map((clip) => clip.clip_id), ["scene-2"]);
    assert.deepEqual(reset.avatarClips[0], {
      avatar_preset_id: "avatar-preset-1",
      generation_revision: 3,
      id: "scene-1",
      order: 1,
      origin: "storyboard",
      script_text: "Guion que debe conservarse.",
      source_hash: "source-hash",
      status: "DRAFT",
      voice_preset_id: "voice-preset-1",
      voice_speed: 1.1,
      voice_status: "DRAFT",
    });
    assert.equal(reset.avatarClips[1]?.public_url, "https://cdn.example.com/scene-2.mp4");
  });

  it("does not publish provisional voice tracks while an avatar is pending or failed", () => {
    const voiceClip = {
      clip_id: "scene-1",
      id: "voice-scene-1",
      order: 1,
      public_url: "https://cdn.example.com/scene-1.mp3",
      script_hash: "script-hash",
      status: "COMPLETED" as const,
    };
    const promotable = selectPromotableAvatarVoices([
      {
        clipId: "scene-1",
        jobId: "job-pending",
        providerJobId: "provider-pending",
        status: PRODUCTION_JOB_STATUSES.WAITING_PROVIDER,
        voiceClip,
      },
      {
        clipId: "scene-2",
        jobId: "job-failed",
        providerJobId: null,
        status: PRODUCTION_JOB_STATUSES.FAILED,
        voiceClip: { ...voiceClip, clip_id: "scene-2", id: "voice-scene-2" },
      },
      {
        clipId: "scene-3",
        jobId: "job-completed",
        providerJobId: "provider-completed",
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
        voiceClip: { ...voiceClip, clip_id: "scene-3", id: "voice-scene-3" },
      },
    ]);

    assert.deepEqual(promotable.map((clip) => clip.clip_id), ["scene-3"]);
  });
});

describe("HeyGen avatar billing preflight", () => {
  it("reads the documented wallet remaining_balance field", () => {
    assert.deepEqual(readHeygenAvailableBalance({
      billingType: "wallet",
      email: null,
      firstName: null,
      lastName: null,
      raw: {},
      subscription: null,
      usageBased: null,
      username: "QA",
      wallet: { currency: "usd", remaining_balance: 0 },
    }), { available: 0, unit: "usd" });
  });

  it("estimates the complete avatar batch before generating provisional audio", () => {
    const budget = estimateHeygenAvatarGenerationBudget({
      account: {
        billingType: "wallet",
        email: null,
        firstName: null,
        lastName: null,
        raw: {},
        subscription: null,
        usageBased: null,
        username: "QA",
        wallet: { currency: "usd", remaining_balance: 1 },
      },
      clips: [{
        id: "scene-1",
        order: 1,
        script_text: Array.from({ length: 145 }, () => "palabra").join(" "),
        status: "DRAFT",
      }],
      engine: "avatar_iv",
      speed: 1,
    });

    assert.equal(budget.estimatedDurationSeconds, 60);
    assert.ok(budget.estimatedCost > 4);
    assert.equal(budget.available, 1);
  });
});
