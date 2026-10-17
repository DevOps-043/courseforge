import type { CompositionClip } from "./composition-document.types";
import type { CompositionTextLayerStyle } from "./composition-text-layer.types";
import { CAPTION_EFFECT_METRICS } from "./composition-caption-effects.types";
import { captionHasEffects, resolveCaptionEffects } from "./composition-caption-effects.service";
import { buildCaptionTextParts, captionColorWithOpacity, captionEffectElementId, captionPartElementId } from "./composition-caption-effects-plan";
import { COMPOSITION_NATIVE_TEXT_BIDI, COMPOSITION_NATIVE_TEXT_DIRECTION, resolveCompositionCaptionWordGaps, resolveCompositionTextLanguage } from "./composition-text-presentation";

export function renderCompositionNativeOverlay(params: {
  clip: CompositionClip;
  commonAttributes: string;
  motionId: string;
  visualTiming: string;
}) {
  const { clip } = params;
  if (clip.kind === "TEXT" && clip.source.type === "NATIVE_TEXT") {
    return renderTextLayer(params, clip.source.text, clip.source.style);
  }
  if (clip.kind === "CAPTION" && clip.source.type === "NATIVE_CAPTIONS") {
    const style = clip.source.style;
    const language = resolveCompositionTextLanguage(clip.source.language);
    const languageAttribute = language ? ` lang="${escapeAttribute(language)}"` : "";
    const cues = clip.source.cues.map((cue) => captionHasEffects(cue, clip.source.type === "NATIVE_CAPTIONS" ? clip.source.effects : undefined) ? (
      `<div id="${escapeAttribute(captionCueElementId(clip.id, cue.id))}" class="composition-caption-cue" dir="${COMPOSITION_NATIVE_TEXT_DIRECTION}"${languageAttribute} style="box-sizing:border-box;overflow:hidden;position:absolute;inset:0;visibility:hidden;opacity:0;"><div id="${escapeAttribute(captionEffectElementId(clip.id, cue.id))}" style="${renderTextStyle(style)};position:absolute;inset:0;transform-origin:50% 50%;"><div>${renderCaptionEffectsText(clip, cue)}</div></div></div>`
    ) : (
      // El flex exterior alinea el párrafo; sus palabras deben permanecer en flujo inline dentro del bloque.
      `<div id="${escapeAttribute(captionCueElementId(clip.id, cue.id))}" class="composition-caption-cue" dir="${COMPOSITION_NATIVE_TEXT_DIRECTION}"${languageAttribute} style="${renderTextStyle(style)};position:absolute;inset:0;visibility:hidden;opacity:0;"><div class="composition-caption-paragraph" style="min-width:0;flex-shrink:0;unicode-bidi:${COMPOSITION_NATIVE_TEXT_BIDI};">${renderCaptionCueText(clip.id, cue)}</div></div>`
    )).join("");
    return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${params.visualTiming}><div ${params.commonAttributes} class="clip-content composition-native-overlay"><div id="${params.motionId}" class="motion-subject composition-native-caption" style="position:absolute;inset:0;">${cues}</div></div></section>`;
  }
  throw new Error(`La capa ${clip.id} no tiene una fuente de texto compatible.`);
}

function renderCaptionEffectsText(clip: CompositionClip, cue: Extract<CompositionClip["source"], { type: "NATIVE_CAPTIONS" }>['cues'][number]) {
  if (clip.source.type !== "NATIVE_CAPTIONS") return "";
  const source = clip.source;
  const effects = resolveCaptionEffects(cue, source.effects);
  return buildCaptionTextParts(cue).map((part, index) => {
    const color = captionColorWithOpacity(part.emphasis?.color || source.style.color, source.style.textOpacity);
    const opacity = part.word && effects.karaoke !== "NONE" ? (effects.karaoke === "LEGACY" ? CAPTION_EFFECT_METRICS.legacyInactiveOpacity : effects.inactiveOpacity) : 1;
    const highlightShape = effects.karaoke === "BACKGROUND" && part.word ? `border-radius:${CAPTION_EFFECT_METRICS.highlightRadiusPixels}px;` : "";
    const css = `color:${color};opacity:${opacity};background-color:${part.emphasis?.backgroundColor || "transparent"};${highlightShape}${part.word ? "display:inline-block;transform-origin:50% 50%;" : ""}`;
    return `<span id="${escapeAttribute(captionPartElementId(clip.id, cue.id, index))}" style="${css}">${escapeHtml(part.text)}</span>`;
  }).join("");
}

export function captionCueElementId(clipId: string, cueId: string) {
  return `${clipId}-caption-${cueId}`;
}

export function captionWordElementId(clipId: string, cueId: string, wordId: string) {
  return `${captionCueElementId(clipId, cueId)}-word-${wordId}`;
}

function renderCaptionCueText(
  clipId: string,
  cue: Extract<CompositionClip["source"], { type: "NATIVE_CAPTIONS" }>['cues'][number],
) {
  if (!cue.words?.length) return escapeHtml(cue.text);
  const gaps = resolveCompositionCaptionWordGaps(cue);
  // The cue is authoritative. Unalignable legacy words retain hidden timing anchors, not substituted visible text.
  if (!gaps) return escapeHtml(cue.text) + cue.words.map((word) =>
    `<span id="${escapeAttribute(captionWordElementId(clipId, cue.id, word.id))}" class="composition-caption-word" hidden aria-hidden="true">${escapeHtml(word.text)}</span>`).join("");
  return cue.words.map((word, index) => `${escapeHtml(gaps.prefixes[index]!)}<span id="${escapeAttribute(captionWordElementId(clipId, cue.id, word.id))}" class="composition-caption-word" style="opacity:0.55;">${escapeHtml(word.text)}</span>`).join("")
    + escapeHtml(gaps.suffix);
}

function renderTextLayer(
  params: Parameters<typeof renderCompositionNativeOverlay>[0],
  text: string,
  style: CompositionTextLayerStyle,
) {
  const clip = params.clip;
  return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${params.visualTiming}><div ${params.commonAttributes} class="clip-content composition-native-overlay"><div id="${params.motionId}" class="motion-subject composition-native-text" dir="${COMPOSITION_NATIVE_TEXT_DIRECTION}" style="${renderTextStyle(style)};position:absolute;inset:0;">${escapeHtml(text)}</div></div></section>`;
}

function renderTextStyle(style: CompositionTextLayerStyle) {
  const justifyContent = style.verticalAlign === "TOP"
    ? "flex-start"
    : style.verticalAlign === "BOTTOM"
      ? "flex-end"
      : "center";
  const stroke = style.strokeWidth > 0
    ? `-webkit-text-stroke:${style.strokeWidth}px ${style.strokeColor}`
    : "";
  return [
    "box-sizing:border-box",
    "display:flex",
    "flex-direction:column",
    `justify-content:${justifyContent}`,
    `padding:${style.paddingY}px ${style.paddingX}px`,
    `border-radius:${style.borderRadius}px`,
    `background:${hexToRgba(style.backgroundColor, style.backgroundOpacity)}`,
    `color:${hexToRgba(style.color, style.textOpacity)}`,
    `font-family:'${escapeCssString(style.fontFamily)}',sans-serif`,
    `font-size:${style.fontSize}px`,
    `font-style:${style.fontStyle.toLowerCase()}`,
    `font-weight:${style.fontWeight}`,
    `letter-spacing:${style.letterSpacing}px`,
    `line-height:${style.lineHeight}`,
    `text-align:${style.horizontalAlign.toLowerCase()}`,
    `text-shadow:0 2px ${style.shadowBlur}px ${hexToRgba(style.shadowColor, style.shadowOpacity)}`,
    stroke,
    "overflow:hidden",
    "white-space:pre-wrap",
    `unicode-bidi:${COMPOSITION_NATIVE_TEXT_BIDI}`,
    "overflow-wrap:anywhere",
  ].filter(Boolean).join(";");
}

function hexToRgba(hex: string, opacity: number) {
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red},${green},${blue},${opacity})`;
}

function escapeCssString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeHtml(value: string) {
  return escapeAttribute(value).replace(/>/g, "&gt;");
}
