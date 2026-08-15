import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionVolumeAutomations } from "../composition-audio-mix.service";
import {
  COMPOSITION_DOCUMENT_FORMAT,
  compositionEditorDocumentSchema,
  type CompositionEditorDocument,
} from "../composition-document.types";

const MUSIC_ASSET_ID = "11111111-1111-4111-8111-111111111111";
const VOICE_ASSET_ID = "22222222-2222-4222-8222-222222222222";
const AVATAR_ASSET_ID = "33333333-3333-4333-8333-333333333333";

test("builds one deterministic music envelope from voice timing", () => {
  const document = createAudioDocument();

  const first = buildCompositionVolumeAutomations(document);
  const second = buildCompositionVolumeAutomations(document);

  assert.deepEqual(first, second);
  assert.deepEqual(first, [{
    baselineVolume: 0.25,
    points: [
      { timeSeconds: 0, volume: 0.25 },
      { timeSeconds: 2.8, volume: 0.25 },
      { timeSeconds: 3, volume: 0.0875 },
      { timeSeconds: 5, volume: 0.0875 },
      { timeSeconds: 5.35, volume: 0.25 },
      { timeSeconds: 10, volume: 0.25 },
    ],
    targetClipId: "music-clip",
  }]);
});

test("keeps music ducked across nearby voice and avatar intervals", () => {
  const document = createAudioDocument({ includeAvatar: true });

  const [automation] = buildCompositionVolumeAutomations(document);

  assert.ok(automation);
  assert.equal(automation.points.find((point) => point.timeSeconds === 3)?.volume, 0.0875);
  assert.equal(automation.points.find((point) => point.timeSeconds === 6.3)?.volume, 0.0875);
  assert.equal(automation.points.some((point) => point.timeSeconds === 5.35 && point.volume === 0.25), false);
});

test("does not duck for hidden or muted narration", () => {
  const hiddenVoice = createAudioDocument({ hideVoice: true });
  const mutedVoice = createAudioDocument({ muteVoice: true });

  assert.deepEqual(buildCompositionVolumeAutomations(hiddenVoice), []);
  assert.deepEqual(buildCompositionVolumeAutomations(mutedVoice), []);
});

test("supports disabling ducking without changing static track volume", () => {
  const document = createAudioDocument();
  document.audioMix.ducking.enabled = false;

  assert.deepEqual(buildCompositionVolumeAutomations(document), []);
  assert.equal(document.tracks.find((track) => track.id === "music")?.volume, 0.25);
});

function createAudioDocument(options: {
  hideVoice?: boolean;
  includeAvatar?: boolean;
  muteVoice?: boolean;
} = {}): CompositionEditorDocument {
  const layout = { height: 1, opacity: 1, rotation: 0, width: 1, x: 0, y: 0, zIndex: 0 };
  return compositionEditorDocumentSchema.parse({
    canvas: { durationMode: "AUTO", durationSeconds: 10, durationSource: "voice", fps: 30, height: 1080, width: 1920 },
    clips: [
      {
        durationSeconds: 10,
        hfId: "music-clip",
        hidden: false,
        id: "music-clip",
        kind: "AUDIO",
        label: "Música",
        layout,
        source: { productionAssetId: MUSIC_ASSET_ID, type: "PRODUCTION_ASSET" },
        sourceDurationSeconds: 10,
        sourceOffsetSeconds: 0,
        startSeconds: 0,
        timingSource: "ESTIMATED",
        trackId: "music",
      },
      {
        durationSeconds: 2,
        hfId: "voice-clip",
        hidden: options.hideVoice ?? false,
        id: "voice-clip",
        kind: "AUDIO",
        label: "Voz",
        layout,
        source: { productionAssetId: VOICE_ASSET_ID, type: "PRODUCTION_ASSET" },
        sourceDurationSeconds: 2,
        sourceOffsetSeconds: 0,
        startSeconds: 3,
        timingSource: "ESTIMATED",
        trackId: "voice",
      },
      ...(options.includeAvatar ? [{
        durationSeconds: 1,
        hfId: "avatar-clip",
        hidden: false,
        id: "avatar-clip",
        kind: "VIDEO" as const,
        label: "Avatar",
        layout: { ...layout, height: 700, width: 500 },
        source: { productionAssetId: AVATAR_ASSET_ID, type: "PRODUCTION_ASSET" as const },
        sourceDurationSeconds: 1,
        sourceOffsetSeconds: 0,
        startSeconds: 5.3,
        timingSource: "ESTIMATED" as const,
        trackId: "avatar",
      }] : []),
    ],
    deckStyles: null,
    format: COMPOSITION_DOCUMENT_FORMAT,
    tracks: [
      { hidden: false, id: "avatar", kind: "VISUAL", label: "Avatar", locked: false, muted: false, order: 10, semanticRole: "AVATAR", volume: 1 },
      { hidden: false, id: "voice", kind: "AUDIO", label: "Voz", locked: false, muted: options.muteVoice ?? false, order: 20, semanticRole: "VOICE", volume: 1 },
      { hidden: false, id: "music", kind: "AUDIO", label: "Música", locked: false, muted: false, order: 30, semanticRole: "MUSIC", volume: 0.25 },
    ],
    variables: { accent: "#00d4b3", subtitle: "Prueba", title: "Composición" },
  });
}
