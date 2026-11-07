import { captureCompositionPresetMotion } from "./composition-preset-motion";
import { resolveCompositionPresetRole, selectCompositionPresetTracks } from "./composition-preset-selectors";
import { resolveCompositionPreviewMediaFit } from "./composition-preview-visual-state";
import type {
  CompositionClip,
  CompositionEditorDocument,
  CompositionTrack,
  CompositionTrackRole,
} from "./composition-document.types";
import { resolveCompositionCropInsets } from "./composition-visual-crop.service";
import {
  COMPOSITION_PRESET_SCHEMA_VERSION,
  compositionDynamicPresetDefinitionSchema,
  type CompositionDynamicPresetDefinition,
  type CompositionPresetSlotRule,
  type CompositionPresetVariant,
} from "./composition-preset.types";

const ADJACENCY_TOLERANCE_SECONDS = 0.000001;

export type CompositionPresetExtractionDiagnostic = {
  code: "CUSTOM_TRACK_SKIPPED" | "NON_PRESET_ANIMATION_SKIPPED" | "SOURCE_BOUND_SETTINGS_PRESERVED" | "DOCUMENT_STRUCTURE_PRESERVED" | "CONTENT_STYLING_PRESERVED";
  entityId: string;
  message: string;
};

/**
 * Converts authored editor state into a content-independent pattern. Asset ids,
 * labels, HTML and course variables are deliberately excluded.
 */
export function extractCompositionPresetDefinition(document: CompositionEditorDocument): {
  definition: CompositionDynamicPresetDefinition;
  diagnostics: CompositionPresetExtractionDiagnostic[];
} {
  const diagnostics: CompositionPresetExtractionDiagnostic[] = [];
  const trackById = new Map(document.tracks.map((track) => [track.id, track]));
  const clipsBySlot = new Map<string, { semanticRole: CompositionTrackRole; trackIndex: number; clips: CompositionClip[] }>();
  for (const clip of document.clips) {
    const track = trackById.get(clip.trackId);
    const semanticRole = track ? resolveCompositionPresetRole(track) : null;
    if (!semanticRole) {
      diagnostics.push({ code: "CUSTOM_TRACK_SKIPPED", entityId: clip.id,
        message: "Se omitió un clip porque su pista no declara un rol semántico reutilizable." });
      continue;
    }
    const trackIndex = selectCompositionPresetTracks(document, semanticRole).findIndex(candidate => candidate.id === clip.trackId);
    const key = semanticRole + ":" + trackIndex + ":" + clip.kind;
    const slot = clipsBySlot.get(key) ?? { semanticRole, trackIndex, clips: [] };
    slot.clips.push(clip);
    clipsBySlot.set(key, slot);
    if (clip.sourceOffsetSeconds || clip.playbackRate !== undefined || clip.freezeTailSeconds !== undefined || clip.volumeEnvelope?.length) {
      diagnostics.push({ code: "SOURCE_BOUND_SETTINGS_PRESERVED", entityId: clip.id,
        message: "El recorte de fuente, velocidad, congelación y envolvente de volumen pertenecen al medio original; se conservarán los del destino." });
    }
    if (((clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS") && clip.source.style.fontAssetId)
      || (clip.source.type === "NATIVE_CAPTIONS" && clip.source.cues.some(cue => cue.effects || cue.emphasis?.length))) {
      diagnostics.push({ code: "CONTENT_STYLING_PRESERVED", entityId: clip.id,
        message: "Las fuentes privadas, los efectos por frase y los énfasis ligados al texto se conservan en el destino." });
    }
  }
  if (document.groups?.length || document.transitions?.items.length || document.htmlEditing?.items.length) {
    diagnostics.push({ code: "DOCUMENT_STRUCTURE_PRESERVED", entityId: "document",
      message: "Las agrupaciones, transiciones y revisiones HTML dependen de la lección; el preset conserva las del destino." });
  }
  const rules = [...clipsBySlot.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([, slot]) => buildRule({ document, ...slot, trackById }));
  if (rules.length === 0) throw new Error("La edición no contiene tracks semánticos que puedan convertirse en preset.");

  return {
    definition: compositionDynamicPresetDefinitionSchema.parse({
      audioMix: {
        masterVolume: document.audioMix.masterVolume ?? 1,
        ducking: {
          targetRole: document.audioMix.ducking.targetRole,
          triggerRoles: [...document.audioMix.ducking.triggerRoles],
          attackSeconds: document.audioMix.ducking.attackSeconds,
          duckedVolumeRatio: document.audioMix.ducking.duckedVolumeRatio,
          enabled: document.audioMix.ducking.enabled,
          releaseSeconds: document.audioMix.ducking.releaseSeconds,
        },
      },
      rules,
      schemaVersion: COMPOSITION_PRESET_SCHEMA_VERSION,
    }),
    diagnostics,
  };
}

function buildRule(params: {
  clips: CompositionClip[];
  document: CompositionEditorDocument;
  semanticRole: CompositionTrackRole;
  trackIndex: number;
  trackById: Map<string, CompositionTrack>;
}): CompositionPresetSlotRule {
  const clips = [...params.clips].sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));
  const rangeStart = Math.min(...clips.map((clip) => clip.startSeconds));
  const rangeEnd = Math.max(...clips.map((clip) => clip.startSeconds + clip.durationSeconds));
  const sourceTrack = params.trackById.get(clips[0]!.trackId)!;
  return {
    id: `slot-${params.semanticRole.toLowerCase()}-${params.trackIndex}-${clips[0]!.kind.toLowerCase().replaceAll("_", "-")}`,
    minItems: 0,
    replaceAnimations: true,
    selector: {
      kinds: [...new Set(clips.map((clip) => clip.kind))],
      semanticRole: params.semanticRole,
      trackIndex: params.trackIndex,
    },
    timing: {
      endRatio: clampRatio(rangeEnd / params.document.canvas.durationSeconds),
      mode: detectTimingMode(clips, params.document.canvas.durationSeconds),
      startRatio: clampRatio(rangeStart / params.document.canvas.durationSeconds),
    },
    trackSettings: {
      hidden: sourceTrack.hidden ?? false,
      muted: sourceTrack.muted ?? false,
      volume: sourceTrack.volume ?? 1,
    },
    variants: clips.map((clip) => buildVariant(clip, params.document, sourceTrack)),
  };
}

function buildVariant(
  clip: CompositionClip,
  document: CompositionEditorDocument,
  track: CompositionTrack,
): CompositionPresetVariant {
  const crop = clip.crop ? resolveCompositionCropInsets(clip.crop, clip.layout) : null;
  return {
    animations: [],
    motion: captureCompositionPresetMotion(clip, document),
    startRatio: clip.startSeconds / document.canvas.durationSeconds,
    durationRatio: clip.durationSeconds / document.canvas.durationSeconds,
    fadeInRatio: (clip.fadeInSeconds ?? 0) / clip.durationSeconds,
    fadeOutRatio: (clip.fadeOutSeconds ?? 0) / clip.durationSeconds,
    colorGrading: clip.colorGrading ? structuredClone(clip.colorGrading) : null,
    ...((clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS") ? {
      textStyle: portableTextStyle(clip.source.style),
      preserveTargetFont: Boolean(clip.source.style.fontAssetId),
    } : {}),
    ...(clip.source.type === "NATIVE_CAPTIONS" ? { captionEffects: clip.source.effects ? structuredClone(clip.source.effects) : null } : {}),
    ...(crop ? {
      crop: {
        bottomRatio: clampRatio(crop.bottom / clip.layout.height),
        leftRatio: clampRatio(crop.left / clip.layout.width),
        rightRatio: clampRatio(crop.right / clip.layout.width),
        topRatio: clampRatio(crop.top / clip.layout.height),
      },
    } : {}),
    ...(clip.mask ? { mask: clip.mask } : {}),
    durationWeight: clip.durationSeconds,
    hidden: clip.hidden,
    ...(clip.kind !== "AUDIO" ? {
      layout: {
        heightRatio: clip.layout.height / document.canvas.height,
        opacity: clip.layout.opacity,
        rotation: clip.layout.rotation,
        widthRatio: clip.layout.width / document.canvas.width,
        xRatio: clip.layout.x / document.canvas.width,
        yRatio: clip.layout.y / document.canvas.height,
        zIndex: clip.layout.zIndex,
      },
    } : {}),
    ...((clip.kind === "IMAGE" || clip.kind === "VIDEO") ? { mediaFit: resolveCompositionPreviewMediaFit(clip, track) } : {}),
    volume: clip.volume ?? 1,
  };
}

function detectTimingMode(clips: CompositionClip[], canvasDurationSeconds: number): CompositionPresetSlotRule["timing"]["mode"] {
  if (clips.length === 1) {
    const clip = clips[0]!;
    return clip.startSeconds <= ADJACENCY_TOLERANCE_SECONDS
      && clip.startSeconds + clip.durationSeconds >= canvasDurationSeconds - ADJACENCY_TOLERANCE_SECONDS
      ? "STACK"
      : "PATTERN";
  }
  const sorted = [...clips].sort((left, right) => left.startSeconds - right.startSeconds);
  const isSequence = sorted.slice(1).every((clip, index) => {
    const previous = sorted[index]!;
    const previousEnd = previous.startSeconds + previous.durationSeconds;
    return Math.abs(clip.startSeconds - previousEnd) <= ADJACENCY_TOLERANCE_SECONDS;
  });
  const sameWindow = sorted.slice(1).every((clip) => (
    Math.abs(clip.startSeconds - sorted[0]!.startSeconds) <= ADJACENCY_TOLERANCE_SECONDS
    && Math.abs(clip.durationSeconds - sorted[0]!.durationSeconds) <= ADJACENCY_TOLERANCE_SECONDS
  ));
  return sameWindow ? "STACK" : isSequence ? "SEQUENCE" : "PATTERN";
}

function portableTextStyle(style: import("./composition-text-layer.types").CompositionTextLayerStyle) {
  const portable = structuredClone(style);
  delete portable.fontAssetId;
  return portable;
}

function clampRatio(value: number) { return Math.max(0, Math.min(1, value)); }

