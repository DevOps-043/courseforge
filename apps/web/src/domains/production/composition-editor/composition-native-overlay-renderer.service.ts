import type { CompositionClip } from "./composition-document.types";
import type { CompositionTextLayerStyle } from "./composition-text-layer.types";

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
    const cues = clip.source.cues.map((cue) => (
      `<div id="${escapeAttribute(captionCueElementId(clip.id, cue.id))}" class="composition-caption-cue" style="${renderTextStyle(style)};position:absolute;inset:0;visibility:hidden;opacity:0;">${renderCaptionCueText(clip.id, cue)}</div>`
    )).join("");
    return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${params.visualTiming}><div ${params.commonAttributes} class="clip-content composition-native-overlay"><div id="${params.motionId}" class="motion-subject composition-native-caption" style="position:absolute;inset:0;">${cues}</div></div></section>`;
  }
  throw new Error(`La capa ${clip.id} no tiene una fuente de texto compatible.`);
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
  return cue.words.map((word, index) => `${index > 0 ? " " : ""}<span id="${escapeAttribute(captionWordElementId(clipId, cue.id, word.id))}" class="composition-caption-word" style="opacity:0.55;">${escapeHtml(word.text)}</span>`).join("");
}

function renderTextLayer(
  params: Parameters<typeof renderCompositionNativeOverlay>[0],
  text: string,
  style: CompositionTextLayerStyle,
) {
  const clip = params.clip;
  return `<section id="${escapeAttribute(clip.id)}-timeline" class="clip" ${params.visualTiming}><div ${params.commonAttributes} class="clip-content composition-native-overlay"><div id="${params.motionId}" class="motion-subject composition-native-text" style="${renderTextStyle(style)};position:absolute;inset:0;">${escapeHtml(text)}</div></div></section>`;
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
