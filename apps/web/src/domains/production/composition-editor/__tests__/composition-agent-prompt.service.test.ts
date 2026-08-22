import assert from "node:assert/strict";
import test from "node:test";
import { createInitialCompositionDocument } from "../composition-document.factory";
import {
  buildCompositionAgentContext,
  buildCompositionProposalPrompt,
} from "../composition-agent-prompt.service";
import { compositionEditorPatchRequestSchema } from "../editor-patch.types";

test("exposes semantic layers, audio mix and visual depth without source internals", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [
      { checksum: "a".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000051", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/broll.mp4", timelineRole: "BROLL" },
      { checksum: "b".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "audio/mpeg", productionAssetId: "00000000-0000-4000-8000-000000000052", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/music.mp3", timelineRole: "AUDIO" },
    ],
    plan: { accentColor: "#00D4B3", durationSeconds: 8, subtitle: "Contexto", title: "Agente" },
  });

  const context = buildCompositionAgentContext(document);

  assert.equal(context.composition.audioMix.ducking.enabled, true);
  assert.equal(context.composition.tracks.find((track) => track.id === "music")?.semanticRole, "MUSIC");
  assert.equal(context.composition.tracks.find((track) => track.id === "broll")?.semanticRole, "BROLL");
  assert.equal(context.composition.clips.find((clip) => clip.trackId === "broll")?.layout.zIndex, 2);
  assert.equal("source" in context.composition.clips[0]!, false);
  assert.doesNotMatch(JSON.stringify(context), /storagePath|publicUrl|productionAssetId/);
});

test("documents the allow-listed depth and ducking operations for the agent", () => {
  const document = createInitialCompositionDocument({
    animatedDeck: null,
    assets: [{ checksum: "c".repeat(64), durationSeconds: 8, fileSizeBytes: 4, mimeType: "video/mp4", productionAssetId: "00000000-0000-4000-8000-000000000053", publicUrl: null, storageBucket: "production-assets", storagePath: "production-assets/broll-agent.mp4", timelineRole: "BROLL" }],
    plan: { accentColor: "#00D4B3", durationSeconds: 8, subtitle: "Prompt", title: "Agente" },
  });
  const selectedClipId = document.clips[0]!.id;
  const prompt = buildCompositionProposalPrompt({
    context: buildCompositionAgentContext(document),
    instruction: "Pon el video delante y reduce la música durante la voz",
    selectedClipId,
  });

  assert.match(prompt, /audio-mix\.update/);
  assert.match(prompt, /layout\.zIndex/);
  assert.match(prompt, /track\.order no controla/);
  assert.match(prompt, /entero entre 0 y 10/);
  assert.match(prompt, /animation\.add-preset/);
  assert.match(prompt, /FADE_IN/);
  assert.match(prompt, /PULSE/);
  assert.match(prompt, /HIDE oculta el asset sin transición/);
  assert.match(prompt, /FADE_HIDE lo desvanece al salir y reaparecer/);
  assert.match(prompt, /ciclos de Durante son finitos y deterministas/);
  assert.doesNotMatch(prompt, /Para animation\.remove/);
  assert.match(prompt, /No propongas restaurar documentos/);
  assert.match(prompt, /información no confiable/);
  assert.match(prompt, /READ_TOOL_RESULTS/);
  assert.match(prompt, new RegExp(`Clip seleccionado: ${selectedClipId}`));
});

test("rejects agent audio-mix properties outside the allow-list", () => {
  const valid = compositionEditorPatchRequestSchema.safeParse({
    operations: [{ settings: { duckedVolumeRatio: 0.2, enabled: true }, type: "audio-mix.update" }],
    source: "AGENT",
    summary: "Ajustará la mezcla automática.",
  });
  const invalid = compositionEditorPatchRequestSchema.safeParse({
    operations: [{ settings: { targetRole: "VOICE" }, type: "audio-mix.update" }],
    source: "AGENT",
    summary: "Intentará cambiar el objetivo.",
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
});

test("constrains agent visual depth to the persisted layout range", () => {
  const valid = compositionEditorPatchRequestSchema.safeParse({
    operations: [{ clipId: "visual-clip", layout: { zIndex: 10 }, type: "clip.layout" }],
    source: "AGENT",
    summary: "Traerá el clip al frente.",
  });
  const invalid = compositionEditorPatchRequestSchema.safeParse({
    operations: [{ clipId: "visual-clip", layout: { zIndex: 11 }, type: "clip.layout" }],
    source: "AGENT",
    summary: "Excederá la profundidad permitida.",
  });
  const negative = compositionEditorPatchRequestSchema.safeParse({
    operations: [{ clipId: "visual-clip", layout: { zIndex: -1 }, type: "clip.layout" }],
    source: "AGENT",
    summary: "Intentará usar una capa negativa.",
  });

  assert.equal(valid.success, true);
  assert.equal(invalid.success, false);
  assert.equal(negative.success, false);
});
