import type { CompositionClip } from "./composition-document.types";
import type { CompositionEditorPatchOperation } from "./editor-patch.types";
import { formatCompositionTimecode } from "./composition-timecode";

/** El formulario puede validar un grupo completo sin reenviarlo entero. */
export function buildCompositionInspectorPatches(clip: CompositionClip, candidates: CompositionEditorPatchOperation[], currentVolume = clip.volume ?? 1): CompositionEditorPatchOperation[] {
  return candidates.flatMap((operation): CompositionEditorPatchOperation[] => {
    if (!("clipId" in operation) || operation.clipId !== clip.id) return [operation];
    switch (operation.type) {
      case "clip.duration": return formatCompositionTimecode(operation.durationSeconds) === formatCompositionTimecode(clip.durationSeconds) ? [] : [operation];
      case "clip.move": return formatCompositionTimecode(operation.startSeconds) === formatCompositionTimecode(clip.startSeconds) ? [] : [operation];
      case "clip.volume": return operation.volume === currentVolume ? [] : [operation];
      case "clip.audio-fades": return operation.fadeInSeconds === (clip.fadeInSeconds ?? 0) && operation.fadeOutSeconds === (clip.fadeOutSeconds ?? 0) ? [] : [operation];
      case "clip.layout": {
        const layout = Object.fromEntries(Object.entries(operation.layout).filter(([key, value]) => value !== clip.layout[key as keyof typeof clip.layout]));
        return Object.keys(layout).length ? [{ ...operation, layout }] : [];
      }
      case "clip.text-content": return clip.source.type === "NATIVE_TEXT" && operation.text === clip.source.text ? [] : [operation];
      case "clip.text-style": {
        if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") return [operation];
        const currentStyle = clip.source.style;
        const style = Object.fromEntries(Object.entries(operation.style).filter(([key, value]) => value !== (key === "fontAssetId" ? currentStyle.fontAssetId ?? null : currentStyle[key as keyof typeof currentStyle])));
        return Object.keys(style).length ? [{ ...operation, style }] : [];
      }
      case "clip.caption-cues": return clip.source.type === "NATIVE_CAPTIONS" && operation.origin === clip.source.origin && JSON.stringify(operation.cues) === JSON.stringify(clip.source.cues) ? [] : [operation];
      case "clip.caption-effects": return clip.source.type === "NATIVE_CAPTIONS" && JSON.stringify(operation.effects ?? null) === JSON.stringify(clip.source.effects ?? null) ? [] : [operation];
      default: return [operation];
    }
  });
}
