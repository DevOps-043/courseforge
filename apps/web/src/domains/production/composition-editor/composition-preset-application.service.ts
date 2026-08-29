import {
  compositionEditorDocumentSchema,
  type CompositionClip,
  type CompositionEditorDocument,
} from "./composition-document.types";
import { createCompositionPresetAnimation } from "./composition-motion-preset.service";
import {
  compositionDynamicPresetDefinitionSchema,
  type CompositionDynamicPresetDefinition,
  type CompositionPresetSlotRule,
  type CompositionPresetVariant,
} from "./composition-preset.types";

export class CompositionPresetApplicationError extends Error {
  constructor(
    message: string,
    readonly code = "COMPOSITION_PRESET_INVALID",
    readonly status = 400,
  ) { super(message); }
}

export type CompositionPresetApplicationWarning = {
  code: "LOCKED_TRACK_SKIPPED" | "OPTIONAL_SLOT_EMPTY";
  message: string;
  ruleId: string;
};

/** Applies a validated pattern without ever changing asset references or content. */
export function applyCompositionPresetDefinition(params: {
  definition: CompositionDynamicPresetDefinition;
  document: CompositionEditorDocument;
}) {
  const definition = compositionDynamicPresetDefinitionSchema.parse(params.definition);
  const next = structuredClone(params.document);
  const warnings: CompositionPresetApplicationWarning[] = [];
  let affectedClipCount = 0;
  let affectedTrackCount = 0;
  let generatedAnimationCount = 0;

  for (const rule of definition.rules) {
    const trackIds = new Set(next.tracks
      .filter((track) => track.semanticRole === rule.selector.semanticRole || track.id.toUpperCase() === rule.selector.semanticRole)
      .map((track) => track.id));
    const matchingTracks = next.tracks.filter((track) => trackIds.has(track.id));
    const matchingClips = next.clips
      .filter((clip) => trackIds.has(clip.trackId) && rule.selector.kinds.includes(clip.kind))
      .sort((left, right) => left.startSeconds - right.startSeconds || left.id.localeCompare(right.id));

    if (matchingClips.length < rule.minItems) {
      throw new CompositionPresetApplicationError(
        `El preset requiere al menos ${rule.minItems} elementos en ${rule.selector.semanticRole}.`,
        "COMPOSITION_PRESET_REQUIRED_SLOT_EMPTY",
        409,
      );
    }
    if (matchingClips.length === 0) {
      warnings.push({ code: "OPTIONAL_SLOT_EMPTY", message: `No hay elementos para el slot ${rule.selector.semanticRole}.`, ruleId: rule.id });
      continue;
    }
    const lockedTrackIds = new Set(matchingTracks.filter((track) => track.locked).map((track) => track.id));
    const editableClips = matchingClips.filter((clip) => !lockedTrackIds.has(clip.trackId));
    if (editableClips.length !== matchingClips.length) {
      warnings.push({ code: "LOCKED_TRACK_SKIPPED", message: `Se conservaron los elementos bloqueados de ${rule.selector.semanticRole}.`, ruleId: rule.id });
    }
    if (editableClips.length === 0) continue;

    for (const track of matchingTracks) {
      if (track.locked || !rule.trackSettings) continue;
      Object.assign(track, rule.trackSettings);
      affectedTrackCount += 1;
    }
    const timings = resolveRuleTimings(rule, editableClips, next);
    const editableClipIds = new Set(editableClips.map((clip) => clip.id));
    if (rule.replaceAnimations) {
      next.motion.animations = next.motion.animations.filter((animation) => !editableClipIds.has(animation.target.clipId));
    }
    editableClips.forEach((clip, index) => {
      const variant = rule.variants[index % rule.variants.length]!;
      applyVariant(clip, variant, timings[index], next);
      variant.animations.forEach((animation, animationIndex) => {
        if (next.motion.animations.length >= 200) {
          throw new CompositionPresetApplicationError(
            "El preset generaría más animaciones de las permitidas.",
            "COMPOSITION_PRESET_ANIMATION_LIMIT",
            409,
          );
        }
        next.motion.animations.push(createCompositionPresetAnimation({
          animationId: createAnimationId(rule.id, index, animationIndex),
          clipDurationSeconds: clip.durationSeconds,
          clipId: clip.id,
          cycles: animation.cycles,
          durationSeconds: Math.max(1 / next.canvas.fps, clip.durationSeconds * animation.durationRatio),
          intensity: animation.intensity,
          offsetSeconds: clip.durationSeconds * animation.offsetRatio,
          origin: "PRESET",
          presetId: animation.presetId,
        }));
        generatedAnimationCount += 1;
      });
      affectedClipCount += 1;
    });
  }

  if (definition.audioMix) {
    next.audioMix.ducking = { ...next.audioMix.ducking, ...definition.audioMix.ducking };
  }
  let document: CompositionEditorDocument;
  try {
    document = compositionEditorDocumentSchema.parse(next);
  } catch (error) {
    const message = error && typeof error === "object" && "issues" in error
      ? String((error as { issues?: Array<{ message?: unknown }> }).issues?.[0]?.message || "El preset produjo un documento inválido.")
      : "El preset produjo un documento inválido.";
    throw new CompositionPresetApplicationError(message);
  }
  if (affectedClipCount === 0) {
    throw new CompositionPresetApplicationError("El preset no encontró elementos editables.", "COMPOSITION_PRESET_NO_EFFECT", 409);
  }
  return { affectedClipCount, affectedTrackCount, document, generatedAnimationCount, warnings };
}

function resolveRuleTimings(
  rule: CompositionPresetSlotRule,
  clips: CompositionClip[],
  document: CompositionEditorDocument,
): Array<{ durationSeconds: number; startSeconds: number } | undefined> {
  if (rule.timing.mode === "PRESERVE") return clips.map(() => undefined);
  const startFrame = Math.round(rule.timing.startRatio * document.canvas.durationSeconds * document.canvas.fps);
  const endFrame = Math.round(rule.timing.endRatio * document.canvas.durationSeconds * document.canvas.fps);
  const availableFrames = endFrame - startFrame;
  if (availableFrames < clips.length) {
    throw new CompositionPresetApplicationError(
      `El rango de ${rule.selector.semanticRole} no alcanza para ${clips.length} elementos.`,
      "COMPOSITION_PRESET_TIMELINE_CAPACITY",
      409,
    );
  }
  if (rule.timing.mode === "STACK") {
    return clips.map(() => ({
      durationSeconds: availableFrames / document.canvas.fps,
      startSeconds: startFrame / document.canvas.fps,
    }));
  }
  const weights = clips.map((_, index) => rule.variants[index % rule.variants.length]!.durationWeight);
  const totalWeight = weights.reduce((total, weight) => total + weight, 0);
  const rawFrames = weights.map((weight) => availableFrames * weight / totalWeight);
  const allocatedFrames = rawFrames.map((frames) => Math.max(1, Math.floor(frames)));
  let remainingFrames = availableFrames - allocatedFrames.reduce((total, frames) => total + frames, 0);
  const remainderOrder = rawFrames
    .map((frames, index) => ({ index, remainder: frames - Math.floor(frames) }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  let cursor = 0;
  while (remainingFrames > 0) {
    allocatedFrames[remainderOrder[cursor % remainderOrder.length]!.index]! += 1;
    remainingFrames -= 1;
    cursor += 1;
  }
  while (remainingFrames < 0) {
    const target = allocatedFrames.findIndex((frames) => frames > 1);
    if (target < 0) throw new CompositionPresetApplicationError("No se pudo distribuir el rango del preset.");
    allocatedFrames[target]! -= 1;
    remainingFrames += 1;
  }
  let currentFrame = startFrame;
  return allocatedFrames.map((durationFrames) => {
    const timing = { durationSeconds: durationFrames / document.canvas.fps, startSeconds: currentFrame / document.canvas.fps };
    currentFrame += durationFrames;
    return timing;
  });
}

function applyVariant(
  clip: CompositionClip,
  variant: CompositionPresetVariant,
  timing: { durationSeconds: number; startSeconds: number } | undefined,
  document: CompositionEditorDocument,
) {
  if (timing) {
    clip.startSeconds = timing.startSeconds;
    clip.durationSeconds = timing.durationSeconds;
    clip.timingSource = "USER_EDITED";
  }
  clip.hidden = variant.hidden;
  if (variant.layout && clip.kind !== "AUDIO") {
    clip.layout = {
      height: variant.layout.heightRatio * document.canvas.height,
      opacity: variant.layout.opacity,
      rotation: variant.layout.rotation,
      width: variant.layout.widthRatio * document.canvas.width,
      x: variant.layout.xRatio * document.canvas.width,
      y: variant.layout.yRatio * document.canvas.height,
      zIndex: variant.layout.zIndex,
    };
  }
  if (variant.crop && clip.kind !== "AUDIO") {
    clip.crop = {
      bottom: variant.crop.bottomRatio * clip.layout.height,
      left: variant.crop.leftRatio * clip.layout.width,
      right: variant.crop.rightRatio * clip.layout.width,
      top: variant.crop.topRatio * clip.layout.height,
    };
  } else if (clip.kind !== "AUDIO") {
    delete clip.crop;
  }
  if (variant.mediaFit && (clip.kind === "IMAGE" || clip.kind === "VIDEO")) clip.mediaFit = variant.mediaFit;
  if (variant.volume !== undefined) clip.volume = variant.volume;
}

function createAnimationId(ruleId: string, clipIndex: number, animationIndex: number) {
  return `motion-preset-${ruleId.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 72)}-${clipIndex + 1}-${animationIndex + 1}`;
}

