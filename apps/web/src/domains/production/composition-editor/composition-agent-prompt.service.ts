import type { CompositionEditorDocument } from "./composition-document.types";

/** Builds the minimum safe context required for constrained editing proposals. */
export function buildCompositionAgentContext(document: CompositionEditorDocument) {
  return {
    audioMix: document.audioMix,
    canvas: document.canvas,
    clips: document.clips.map((clip) => ({
      durationSeconds: clip.durationSeconds,
      hidden: clip.hidden,
      id: clip.id,
      kind: clip.kind,
      label: clip.label,
      layout: clip.layout,
      startSeconds: clip.startSeconds,
      trackId: clip.trackId,
    })),
    motion: document.motion.animations.map((animation) => ({
      id: animation.id,
      keyframeCount: animation.keyframes.length,
      origin: animation.origin,
      preset: animation.preset,
      propertyGroup: animation.propertyGroup,
      targetClipId: animation.target.clipId,
      timing: animation.timing,
    })),
    tracks: document.tracks.map((track) => ({
      hidden: track.hidden || false,
      id: track.id,
      kind: track.kind,
      label: track.label,
      locked: track.locked,
      muted: track.muted || false,
      order: track.order,
      semanticRole: track.semanticRole,
      volume: track.volume ?? 1,
    })),
  };
}

export function buildCompositionProposalPrompt(params: {
  context: ReturnType<typeof buildCompositionAgentContext>;
  instruction: string;
  selectedClipId: string | null;
}) {
  return [
    "Eres un asistente de edición de video. Propón cambios seguros para un documento de composición.",
    "Responde SOLO JSON con {summary, operations}. summary debe explicar en español, de forma concreta y en futuro, qué harás antes de que el usuario confirme.",
    "Cada operación debe ser una de: clip.move, clip.duration, clip.layout, clip.visibility, track.update, audio-mix.update, animation.add-preset, animation.update-timing, animation.remove.",
    "No inventes clips, tracks, assets, HTML, URLs, scripts ni propiedades fuera del documento.",
    "Respeta semanticRole: VOICE es narración, MUSIC es música de fondo, AVATAR es presentador, BROLL es apoyo visual, DECK son diapositivas, OVERLAY son gráficos y VISUAL son otros medios.",
    "Los tracks organizan solapamiento temporal; track.order no controla qué elemento aparece delante. Solo layout.zIndex controla la profundidad visual y debe ser un entero entre -100 y 100. No cambies zIndex en clips AUDIO.",
    "Para track.update usa {type, trackId, settings}; settings solo puede contener hidden, locked, muted o volume (0 a 1). No edites clips de un track bloqueado salvo que la solicitud sea desbloquear ese track.",
    "Para audio-mix.update usa {type, settings}; settings solo puede contener enabled, duckedVolumeRatio (0 a 1), attackSeconds (0 a 5) o releaseSeconds (0 a 5). VOICE y AVATAR disparan el ducking y MUSIC es el objetivo.",
    "Para animation.add-preset usa {type, animationId, clipId, presetId, durationSeconds}. animationId debe iniciar con motion- y contener solo letras, números o guiones. presetId solo puede ser FADE_IN, FADE_OUT, SLIDE_IN_LEFT, SLIDE_IN_RIGHT, ZOOM_IN o POP. durationSeconds debe ser mayor a 0 y máximo 2.",
    "Para animation.update-timing usa {type, animationId, timing}; timing puede contener anchor (CLIP_START o CLIP_END), offsetSeconds o durationSeconds. No solapes animaciones del mismo propertyGroup.",
    "Para animation.remove usa {type, animationId}. No inventes animationId al editar o eliminar: usa uno presente en motion.",
    "La propuesta NO se guarda todavía. Mantén el resultado entre 1 y 12 operaciones.",
    `Clip seleccionado: ${params.selectedClipId || "ninguno"}`,
    `Solicitud del usuario: ${params.instruction}`,
    `Documento disponible: ${JSON.stringify(params.context)}`,
  ].join("\n");
}
