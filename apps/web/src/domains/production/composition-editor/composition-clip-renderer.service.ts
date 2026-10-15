import { COMPOSITION_COMPILATION_TARGETS, CompositionPreviewCompilerError, type CompositionCompilationTarget } from "./composition-compilation.types";
import { getCompositionClipMediaAssetId, type CompositionClip, type CompositionEditorDocument, type CompositionTrack } from "./composition-document.types";
import { renderCompositionNativeOverlay } from "./composition-native-overlay-renderer.service";
import { normalizeCompositionColorGrading, type CompositionColorGrading } from "./composition-color-grading.types";
import { resolveCompositionCropInsets } from "./composition-visual-crop.service";
import { compositionClipHasConfigurableAudio } from "./composition-clip-audio.service";
import { resolveCompositionPreviewAspectAnchor, resolveCompositionPreviewClipVolume, resolveCompositionPreviewMediaFit } from "./composition-preview-visual-state";
import type { CompositionTransitionRuntimeClipWindow, CompositionTransitionRuntimeItem } from "./composition-transition-runtime";
type HfColorGradingSerializer = (grading: CompositionColorGrading) => string;

export function renderCompositionClip(
  clip: CompositionClip,
  canvas: Pick<CompositionEditorDocument["canvas"], "height" | "width">,
  track: CompositionTrack | undefined,
  assetVariableNames: Map<string, string> | undefined,
  assetUrls: Map<string, string>,
  deckAssetUrls: Map<string, string> | undefined,
  deckAppearance: "light" | "dark",
  target: CompositionCompilationTarget,
  runtimeTrackIndex: number,
  runtimeAudioTrackIndex: number | undefined,
  hasVolumeAutomation: boolean,
  runtimeWindow: CompositionTransitionRuntimeClipWindow | undefined,
  audioRuntimeWindow: CompositionTransitionRuntimeClipWindow | undefined,
  serializeColorGrading: HfColorGradingSerializer | null,
  audioMetersEnabled: boolean,
  compiledDeckHtml?: string,
) {
  const isHyperframesRender = target === COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER;
  const audioCrossOrigin = audioMetersEnabled ? ' crossorigin="anonymous"' : "";
  const layout = `left:${clip.layout.x}px;top:${clip.layout.y}px;width:${clip.layout.width}px;height:${clip.layout.height}px;opacity:${clip.layout.opacity};z-index:${clip.layout.zIndex};transform:rotate(${clip.layout.rotation}deg);`;
  const mediaFit = resolveCompositionPreviewMediaFit(clip, track);
  const aspectAnchor = resolveCompositionPreviewAspectAnchor(mediaFit, track);
  const crop = resolveCompositionCropInsets(clip.crop, clip.layout);
  const cropData = ` data-crop-top="${crop.top}" data-crop-right="${crop.right}" data-crop-bottom="${crop.bottom}" data-crop-left="${crop.left}"`;
  const cropStyle = renderVisualCropStyle(crop);
  const common = `id="${escapeAttribute(clip.id)}" data-hf-id="${escapeAttribute(clip.hfId)}"${isHyperframesRender ? "" : ` data-editor-label="${escapeAttribute(clip.label)}"`} data-croppable="true" data-layout-opacity="${clip.layout.opacity}" data-media-fit="${mediaFit}"${cropData}${aspectAnchor ? ` data-preserve-aspect="${aspectAnchor}"` : ""} style="${layout}"`;
  const motionId = `${escapeAttribute(clip.id)}-motion`;
  const visualWindow = runtimeWindow || {
    durationSeconds: clip.durationSeconds,
    endSeconds: clip.startSeconds + clip.durationSeconds,
    sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
    startSeconds: clip.startSeconds,
  };
  const visualTiming = `data-start="${visualWindow.startSeconds}" data-duration="${visualWindow.durationSeconds}" data-track-index="${runtimeTrackIndex}"`;
  const canonicalTiming = `data-start="${clip.startSeconds}" data-duration="${clip.durationSeconds}" data-end="${clip.startSeconds + clip.durationSeconds}"`;
  const visualMediaOffset = `data-source-offset="${visualWindow.sourceOffsetSeconds}"${isHyperframesRender ? ` data-media-start="${visualWindow.sourceOffsetSeconds}"` : ""}`;
  const canonicalMediaOffset = `data-source-offset="${clip.sourceOffsetSeconds || 0}"${isHyperframesRender ? ` data-media-start="${clip.sourceOffsetSeconds || 0}"` : ""}`;
  const audioWindow = audioRuntimeWindow || {
    durationSeconds: clip.durationSeconds,
    endSeconds: clip.startSeconds + clip.durationSeconds,
    sourceOffsetSeconds: clip.sourceOffsetSeconds || 0,
    startSeconds: clip.startSeconds,
  };
  const audioTiming = `data-start="${audioWindow.startSeconds}" data-duration="${audioWindow.durationSeconds}" data-end="${audioWindow.startSeconds + audioWindow.durationSeconds}"`;
  const audioMediaOffset = `data-source-offset="${audioWindow.sourceOffsetSeconds}"${isHyperframesRender ? ` data-media-start="${audioWindow.sourceOffsetSeconds}"` : ""}`;
  const hidden = clip.hidden || track?.hidden ? (isHyperframesRender ? ' data-hidden="true"' : ' data-clip-hidden="true"') : "";
  const volumeAutomation = hasVolumeAutomation ? ' data-volume-automated="true"' : "";
  const volume = resolveCompositionPreviewClipVolume(clip, track);
  const colorGrading = renderColorGradingAttribute(clip, serializeColorGrading);
  const hasSynchronizedVideoAudio = clip.kind === "VIDEO"
    && compositionClipHasConfigurableAudio(clip, track);
  if (clip.kind === "TEXT" || clip.kind === "CAPTION") {
    return renderCompositionNativeOverlay({
      clip,
      commonAttributes: common,
      motionId,
      visualTiming,
    });
  }
  if (clip.source.type === "DECK_SLIDE") {
    const deckContainStyle = renderDeckContainStyle(clip, canvas);
    return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${visualTiming}><div ${common} class="clip-content"><div id="${motionId}" class="motion-subject deck-content" style="${cropStyle}"><div class="deck-scope"${clip.source.htmlAssetId ? ` data-html-asset="${escapeAttribute(clip.source.htmlAssetId)}"` : ""} data-appearance="${clip.source.appearance || deckAppearance}" style="${deckContainStyle}"><div class="deck-shell"><main class="deck-stage"><section class="${escapeAttribute(clip.source.classes)}">${compiledDeckHtml ?? replaceCompositionAssetUrls(clip.source.html, deckAssetUrls)}</section></main></div></div></div></div></section>`;
  }
  const mediaAssetId = getCompositionClipMediaAssetId(clip);
  if (!mediaAssetId) throw new CompositionPreviewCompilerError(`El clip ${clip.id} no tiene un asset multimedia válido.`);
  const sourceUrl = assetUrls.get(mediaAssetId);
  const variableName = isHyperframesRender
    ? assetVariableNames?.get(mediaAssetId)
    : undefined;
  if (!sourceUrl && !variableName) throw new CompositionPreviewCompilerError(`No existe URL de preview para el asset ${mediaAssetId}.`);
  const mediaSource = renderMediaSourceAttribute(sourceUrl, variableName, mediaAssetId);
  const videoRate = clip.playbackRate === undefined ? "" : ` data-playback-rate="${clip.playbackRate}"`;
  const videoLoop = clip.playbackRate === undefined && clip.freezeTailSeconds === undefined ? " loop" : "";
  if (clip.kind === "AUDIO") {
    return `<audio id="${escapeAttribute(clip.id)}" class="composition-audio${isHyperframesRender ? " clip" : ""}" data-hf-id="${escapeAttribute(clip.hfId)}"${audioCrossOrigin}${hidden}${volumeAutomation} ${canonicalMediaOffset} data-volume="${volume}" ${mediaSource} preload="metadata" ${canonicalTiming} data-track-index="${runtimeTrackIndex}"></audio>`;
  }
  if (clip.kind === "VIDEO" && isHyperframesRender) {
    const video = `<video id="${escapeAttribute(clip.id)}-media" class="composition-media clip" crossorigin="anonymous" ${mediaSource}${colorGrading} muted playsinline${videoLoop}${videoRate} preload="metadata" ${visualMediaOffset}${hidden} ${visualTiming}></video>`;
    const audio = hasSynchronizedVideoAudio
      ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio clip" ${mediaSource} loop preload="metadata" ${audioMediaOffset}${hidden}${volumeAutomation} data-volume="${volume}" ${audioTiming} data-track-index="${requireRuntimeAudioTrackIndex(runtimeAudioTrackIndex, clip.id)}"></audio>`
      : "";
    return `<div ${common} class="clip-content"><div id="${motionId}" class="motion-subject" style="${cropStyle}">${video}</div></div>${audio}`;
  }
  const media = clip.kind === "VIDEO"
    ? `<video id="${escapeAttribute(clip.id)}-media" class="composition-media" crossorigin="anonymous" ${mediaSource}${colorGrading} muted playsinline${videoLoop}${videoRate} preload="metadata" ${visualTiming} ${visualMediaOffset}${hidden}></video>${hasSynchronizedVideoAudio ? `<audio id="${escapeAttribute(clip.id)}-audio" class="composition-audio"${audioCrossOrigin}${hidden}${volumeAutomation} ${mediaSource} loop preload="metadata" ${audioTiming} ${audioMediaOffset} data-volume="${volume}"></audio>` : ""}`
    : `<img id="${escapeAttribute(clip.id)}-media" class="composition-media" crossorigin="anonymous" ${mediaSource}${colorGrading} alt="" />`;
  return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${visualTiming}><div ${common} class="clip-content"><div id="${motionId}" class="motion-subject" style="${cropStyle}">${media}</div></div></section>`;
}

export function renderCompositionTransitionOverlays(transitions: CompositionTransitionRuntimeItem[]) {
  return transitions
    .filter((transition) => transition.type === "DIP_TO_COLOR" && transition.overlayId && transition.overlayColor)
    .map((transition) => (
      `<div id="${escapeAttribute(transition.overlayId!)}" class="composition-transition-overlay" style="background:${escapeAttribute(transition.overlayColor!)}"></div>`
    ))
    .join("\n");
}

/**
 * Deck markup is authored in the canvas coordinate space. Preset layouts can
 * make a deck clip smaller or change its aspect ratio, so scale that source
 * frame with `contain` semantics instead of shrinking its viewport and
 * clipping the authored slide.
 */
function renderDeckContainStyle(
  clip: CompositionClip,
  canvas: Pick<CompositionEditorDocument["canvas"], "height" | "width">,
) {
  const scale = Math.min(
    clip.layout.width / canvas.width,
    clip.layout.height / canvas.height,
  );
  const width = canvas.width * scale;
  const height = canvas.height * scale;
  const left = (clip.layout.width - width) / 2;
  const top = (clip.layout.height - height) / 2;
  return `position:absolute;width:${canvas.width}px;height:${canvas.height}px;left:${left}px;top:${top}px;transform:scale(${scale});transform-origin:top left;overflow:hidden;`;
}

function renderMediaSourceAttribute(sourceUrl: string | undefined, variableName: string | undefined, assetId: string) {
  if (variableName) return `data-var-src="${escapeAttribute(variableName)}"`;
  if (sourceUrl) return `src="${escapeAttribute(sourceUrl)}" data-preview-asset-id="${escapeAttribute(assetId)}"`;
  throw new CompositionPreviewCompilerError("No se pudo resolver la fuente de un medio.");
}

function renderColorGradingAttribute(
  clip: CompositionClip,
  serializeColorGrading: HfColorGradingSerializer | null,
) {
  const colorGrading = normalizeCompositionColorGrading(clip.colorGrading);
  if (!colorGrading) return "";
  if (!serializeColorGrading) {
    throw new CompositionPreviewCompilerError("No se pudo cargar el serializador de correcciÃ³n de color de HyperFrames.");
  }
  return ` data-color-grading='${escapeAttribute(serializeColorGrading(colorGrading))}'`;
}

function renderVisualCropStyle(crop: { bottom: number; left: number; right: number; top: number }) {
  return `clip-path:inset(${crop.top}px ${crop.right}px ${crop.bottom}px ${crop.left}px);`;
}

export function replaceCompositionAssetUrls(value: string, replacements?: Map<string, string>) {
  if (!replacements || replacements.size === 0) return value;
  let result = value;
  for (const [sourceUrl, replacementUrl] of replacements) {
    result = result.split(sourceUrl).join(replacementUrl);
  }
  return result;
}

function requireRuntimeAudioTrackIndex(index: number | undefined, clipId: string) {
  if (index === undefined) throw new CompositionPreviewCompilerError(`No se pudo asignar un track de audio a ${clipId}.`);
  return index;
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/'/g, "&#39;").replace(/</g, "&lt;");
}

