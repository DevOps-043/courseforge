import { createHash } from "node:crypto";
import { compositionEditorDocumentSchema, NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT, type CompositionEditorDocument } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { deriveNarrativeNavigationOccurrences } from "../composition-narrative-occurrence.service";
import { buildNarrativeVoiceExtractionPlan } from "../composition-narrative-extraction.service";
import { buildNarrativeFragmentPlan } from "../composition-narrative-fragment.service";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { CORPUS_AUDIO_DURATION_SECONDS, type createCorpusStereoAudio } from "./composition-conformance-corpus-assets";

const ORGANIZATION_ID = "27000000-0000-4000-8000-000000000010";
const COMPONENT_ID = "27000000-0000-4000-8000-000000000011";
const COMMAND_ID = "27000000-0000-4000-8000-000000000012";

/** Synthetic timing tags over actual local PCM tones, NEVER speech alignment or provider approval. */
export function applyNarrativeConformanceRecipe(original: CompositionEditorDocument,
  audio: ReturnType<typeof createCorpusStereoAudio>, audiovisual: boolean): CompositionEditorDocument {
  const document = structuredClone(original);
  const voice = document.clips[0]!;
  voice.startSeconds = 1; voice.durationSeconds = 4; voice.sourceOffsetSeconds = 1;
  voice.sceneId = "corpus-narrative-scene";
  document.tracks.find(track => track.id === voice.trackId)!.semanticRole = "VOICE";
  const scriptText = "synthetic timing tags";
  const scriptHash = createHash("sha256").update(scriptText).digest("hex");
  const wordTimestamps = [{ word: "synthetic", start: 1.25, end: 2 }, { word: "timing", start: 2, end: 3 },
    { word: "tags", start: 3, end: 4.25 }];
  document.narrativeScenes = [{ id: voice.sceneId, label: "Synthetic tone timing — not spoken words", order: 1,
    needsReview: false, scriptText, scriptHash, wordTimestamps }];
  const selectedTrackIds = [voice.trackId];
  if (audiovisual) {
    document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
    for (const kind of ["TEXT", "CAPTION"] as const) {
      const created = createCompositionNativeOverlay({ document, id: `corpus-narrative-${kind.toLowerCase()}`, kind, playheadSeconds: 1 });
      if (created.track) document.tracks.push(created.track);
      created.clip.startSeconds = 1; created.clip.durationSeconds = 4;
      if (created.clip.source.type === "NATIVE_TEXT") created.clip.source.text = "Manual visual — not a transcript";
      if (created.clip.source.type === "NATIVE_CAPTIONS") {
        created.clip.source.cues = [{ id: "corpus-manual-cue", startSeconds: 0.5, endSeconds: 2.5, text: "Manual caption preserved",
          words: [{ id: "manual-word", text: "Manual", startSeconds: 0.5, endSeconds: 1.5 }] }];
      }
      document.clips.push(created.clip); selectedTrackIds.push(created.clip.trackId);
    }
  }
  const validated = compositionEditorDocumentSchema.parse(document);
  const documentHash = hashCompositionDocument(validated);
  const occurrence = deriveNarrativeNavigationOccurrences(validated).occurrences[0];
  if (!occurrence) throw new Error("NARRATIVE_CORPUS_OCCURRENCE_MISSING");
  const selection = { documentHash, occurrenceId: occurrence.id, firstSourceIndex: 1, lastSourceIndex: 1 };
  const registryAsset = { id: audio.id, organization_id: ORGANIZATION_ID, material_component_id: COMPONENT_ID,
    asset_type: "VOICE_AUDIO", mime_type: audio.mimeType, checksum: audio.checksum, qa_status: "READY_FOR_QA",
    duration_milliseconds: CORPUS_AUDIO_DURATION_SECONDS * 1000, metadata: { script_hash: scriptHash, word_timestamps: wordTimestamps } };
  const shared = { document: validated, documentHash, selection, organizationId: ORGANIZATION_ID, componentId: COMPONENT_ID,
    linkedAssetIds: [audio.id] };
  const result = audiovisual ? buildNarrativeFragmentPlan({ ...shared, selectedTrackIds, commandId: COMMAND_ID,
    registryAssets: new Map([[audio.id, registryAsset]]) })
    : buildNarrativeVoiceExtractionPlan({ ...shared, registryAsset,
      newClipId: `voice-extract-${COMMAND_ID}`, newHfId: `hf-voice-extract-${COMMAND_ID}` });
  if (!result.ok) throw new Error(`NARRATIVE_CORPUS_PLAN_REJECTED:${result.reason}`);
  return compositionEditorDocumentSchema.parse(applyCompositionEditorPatches(validated, result.plan.operations, "USER"));
}
