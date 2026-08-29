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

const ADJACENCY_TOLERANCE_SECONDS = 0.08;

export type CompositionPresetExtractionDiagnostic = {
  code: "CUSTOM_TRACK_SKIPPED" | "NON_PRESET_ANIMATION_SKIPPED";
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
  const clipsByRole = new Map<CompositionTrackRole, CompositionClip[]>();

  for (const clip of document.clips) {
    const track = trackById.get(clip.trackId);
    const semanticRole = resolveSemanticRole(track);
    if (!semanticRole) {
      diagnostics.push({
        code: "CUSTOM_TRACK_SKIPPED",
        entityId: clip.id,
        message: `Se omitió ${clip.label} porque su track no declara un rol semántico reutilizable.`,
      });
      continue;
    }
    const clips = clipsByRole.get(semanticRole) || [];
    clips.push(clip);
    clipsByRole.set(semanticRole, clips);
  }

  const rules = [...clipsByRole.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([semanticRole, clips]) => buildRule({ diagnostics, document, semanticRole, clips, trackById }));
  if (rules.length === 0) throw new Error("La edición no contiene tracks semánticos que puedan convertirse en preset.");

  return {
    definition: compositionDynamicPresetDefinitionSchema.parse({
      audioMix: {
        ducking: {
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
  diagnostics: CompositionPresetExtractionDiagnostic[];
  document: CompositionEditorDocument;
  semanticRole: CompositionTrackRole;
  trackById: Map<string, CompositionTrack>;
}): CompositionPresetSlotRule {
  const clips = [...params.clips].sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));
  const rangeStart = Math.min(...clips.map((clip) => clip.startSeconds));
  const rangeEnd = Math.max(...clips.map((clip) => clip.startSeconds + clip.durationSeconds));
  const sourceTrack = params.trackById.get(clips[0]!.trackId)!;
  return {
    id: `slot-${params.semanticRole.toLowerCase()}`,
    minItems: 0,
    replaceAnimations: true,
    selector: {
      kinds: [...new Set(clips.map((clip) => clip.kind))],
      semanticRole: params.semanticRole,
    },
    timing: {
      endRatio: clampRatio(rangeEnd / params.document.canvas.durationSeconds),
      mode: detectTimingMode(clips, params.document.canvas.durationSeconds),
      startRatio: clampRatio(rangeStart / params.document.canvas.durationSeconds),
    },
    trackSettings: {
      hidden: sourceTrack.hidden,
      muted: sourceTrack.muted,
      volume: sourceTrack.volume,
    },
    variants: clips.slice(0, 24).map((clip) => buildVariant(clip, params.document, params.diagnostics)),
  };
}

function buildVariant(
  clip: CompositionClip,
  document: CompositionEditorDocument,
  diagnostics: CompositionPresetExtractionDiagnostic[],
): CompositionPresetVariant {
  const animations = document.motion.animations
    .filter((animation) => animation.target.clipId === clip.id)
    .flatMap((animation) => {
      if (!animation.preset) {
        diagnostics.push({
          code: "NON_PRESET_ANIMATION_SKIPPED",
          entityId: animation.id,
          message: `Se omitió ${animation.id}; solo las animaciones basadas en presets son parametrizables.`,
        });
        return [];
      }
      return [{
        cycles: animation.preset.parameters?.cycles || 1,
        durationRatio: clampPositiveRatio(animation.timing.durationSeconds / clip.durationSeconds),
        intensity: animation.preset.parameters?.intensity || 1,
        offsetRatio: clampRatio(animation.timing.offsetSeconds / clip.durationSeconds),
        presetId: animation.preset.id,
      }];
    });
  const crop = clip.crop ? resolveCompositionCropInsets(clip.crop, clip.layout) : null;
  return {
    animations,
    ...(crop ? {
      crop: {
        bottomRatio: clampRatio(crop.bottom / clip.layout.height),
        leftRatio: clampRatio(crop.left / clip.layout.width),
        rightRatio: clampRatio(crop.right / clip.layout.width),
        topRatio: clampRatio(crop.top / clip.layout.height),
      },
    } : {}),
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
    ...(clip.mediaFit ? { mediaFit: clip.mediaFit } : {}),
    ...(clip.volume !== undefined ? { volume: clip.volume } : {}),
  };
}

function detectTimingMode(clips: CompositionClip[], canvasDurationSeconds: number): CompositionPresetSlotRule["timing"]["mode"] {
  if (clips.length === 1) {
    const clip = clips[0]!;
    return clip.startSeconds <= ADJACENCY_TOLERANCE_SECONDS
      && clip.startSeconds + clip.durationSeconds >= canvasDurationSeconds - ADJACENCY_TOLERANCE_SECONDS
      ? "STACK"
      : "PRESERVE";
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
  return sameWindow ? "STACK" : isSequence ? "SEQUENCE" : "PRESERVE";
}

function resolveSemanticRole(track: CompositionTrack | undefined): CompositionTrackRole | null {
  if (track?.semanticRole) return track.semanticRole;
  const candidate = track?.id.toUpperCase();
  return candidate === "DECK" || candidate === "AVATAR" || candidate === "VOICE" || candidate === "MUSIC"
    || candidate === "BROLL" || candidate === "VISUAL" || candidate === "OVERLAY"
    ? candidate
    : null;
}

function clampRatio(value: number) { return Math.max(0, Math.min(1, value)); }
function clampPositiveRatio(value: number) { return Math.max(0.0001, Math.min(1, value)); }

