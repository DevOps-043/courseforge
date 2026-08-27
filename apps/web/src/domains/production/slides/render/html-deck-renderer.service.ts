import { renderCourseChartSvg } from "../charts/svg-chart-renderer.service";
import { repairCommonUtf8Mojibake } from "../../text/mojibake.service";
import type { CourseDeckSpec, CourseSlideSpec } from "../specs/course-deck.schema";
import { resolveCourseDeckTheme } from "./course-deck-theme.service";

function escapeHtml(value: string) {
  return repairCommonUtf8Mojibake(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function firstTextBlock(slide: CourseSlideSpec) {
  const paragraph = slide.bodyBlocks.find((block) => block.kind === "paragraph" && block.text);
  const callout = slide.bodyBlocks.find((block) => block.kind === "callout" && block.text);
  return paragraph?.text || callout?.text || "";
}

function bulletItems(slide: CourseSlideSpec) {
  return slide.bodyBlocks.flatMap((block) => block.kind === "bullets" ? block.items || [] : []);
}

function renderBlock(block: CourseSlideSpec["bodyBlocks"][number]) {
  if (block.kind === "bullets") {
    const items = (block.items || [])
      .slice(0, 4)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `<ul class="point-list">${items}</ul>`;
  }
  if (block.kind === "callout") {
    return `<div class="callout anim-fade-up">${escapeHtml(block.text || "")}</div>`;
  }
  if (block.kind === "code") {
    return `<pre class="code"><code>${escapeHtml(block.text || "")}</code></pre>`;
  }
  return `<p class="lead copy-block">${escapeHtml(block.text || "")}</p>`;
}

function renderBodyBlocks(slide: CourseSlideSpec) {
  return slide.bodyBlocks.map(renderBlock).join("\n");
}

function slideKicker(slide: CourseSlideSpec, deck: CourseDeckSpec) {
  if (slide.type === "cover") {
    return deck.designSystem.brandLabel;
  }

  return slide.type.replace(/_/g, " ").toUpperCase();
}

function brandMark(slide: CourseSlideSpec) {
  return `${String(slide.order).padStart(2, "0")} // ${slide.type.replace(/_/g, " ").toUpperCase()}`;
}

function renderCrosshairs() {
  return `<div class="ch-tl crosshair"></div><div class="ch-tr crosshair"></div><div class="ch-bl crosshair"></div><div class="ch-br crosshair"></div>`;
}

function renderNotes(slide: CourseSlideSpec) {
  return slide.speakerNotes
    ? `<aside class="notes">${escapeHtml(slide.speakerNotes)}</aside>`
    : "";
}

function readyAssetUrl(slide: CourseSlideSpec, purpose: "background" | "supporting") {
  const asset = slide.visualAssets?.[purpose];
  if (asset?.status !== "READY" || !asset.url) return null;

  try {
    const parsed = new URL(asset.url);
    return parsed.protocol === "https:" ? asset.url : null;
  } catch {
    return null;
  }
}

function renderBackgroundPane(slide: CourseSlideSpec) {
  const asset = slide.visualAssets?.background;
  const url = readyAssetUrl(slide, "background");
  if (!asset || !url) return `<div class="bg-pane"></div>`;

  const opacity = asset.slot.opacity ?? 0.14;
  return `<div class="bg-pane has-generated-background" data-visual-asset="${escapeHtml(asset.id)}" style="--generated-background-opacity:${opacity}">
    <img src="${escapeHtml(url)}" alt="" aria-hidden="true" />
  </div>`;
}

function renderVisualPane(slide: CourseSlideSpec) {
  const asset = slide.visualAssets?.supporting;
  const url = readyAssetUrl(slide, "supporting");
  if (asset && url) {
    return `<div class="image-pane has-generated-supporting" data-visual-asset="${escapeHtml(asset.id)}">
      <img src="${escapeHtml(url)}" alt="${escapeHtml(asset.altText)}" />
    </div>`;
  }

  return `<div class="image-pane">
    <div class="visual-grid"></div>
    <div class="visual-object" aria-hidden="true">
      <div class="visual-orbit"></div>
      <div class="visual-bar visual-bar-a"></div>
      <div class="visual-bar visual-bar-b"></div>
      <div class="visual-dot visual-dot-a"></div>
      <div class="visual-dot visual-dot-b"></div>
    </div>
  </div>`;
}

function renderChart(slide: CourseSlideSpec, deck: CourseDeckSpec) {
  if (!slide.chart) {
    return "";
  }

  return `<div class="chart-card anim-fade-up">
    ${renderCourseChartSvg(slide.chart, {
      accent: deck.designSystem.accent,
      accent2: deck.designSystem.accent2,
    })}
  </div>`;
}

function renderCenterSlide(slide: CourseSlideSpec, deck: CourseDeckSpec, isActive: boolean) {
  const lead = slide.subtitle || firstTextBlock(slide);
  const extraBullets = bulletItems(slide)
    .slice(0, 3)
    .map((item, index) => `<li class="anim-fade-up stagger-${index + 1}">${escapeHtml(item)}</li>`)
    .join("");

  return `<section class="slide ${isActive ? "active " : ""}s-center" data-screen-label="${String(slide.order).padStart(2, "0")} ${escapeHtml(slide.title)}" data-title="${escapeHtml(slide.title)}">
    ${renderBackgroundPane(slide)}
    ${renderCrosshairs()}
    <div class="center-copy">
      <div class="kicker">${escapeHtml(slideKicker(slide, deck))}</div>
      <h1 class="display-huge"><span class="anim-marker">${escapeHtml(slide.title)}</span></h1>
      ${lead ? `<p class="lead max-center">${escapeHtml(lead)}</p>` : ""}
      ${extraBullets ? `<ul class="center-points">${extraBullets}</ul>` : ""}
    </div>
    ${renderNotes(slide)}
  </section>`;
}

function renderSplitSlide(
  slide: CourseSlideSpec,
  deck: CourseDeckSpec,
  isActive: boolean,
  reverse: boolean,
) {
  return `<section class="slide ${isActive ? "active " : ""}s-split${reverse ? " s-split-rev" : ""}" data-screen-label="${String(slide.order).padStart(2, "0")} ${escapeHtml(slide.title)}" data-title="${escapeHtml(slide.title)}">
    <div class="content-pane">
      <div class="kicker">${escapeHtml(slideKicker(slide, deck))}</div>
      <h2 class="display-large"><span class="anim-reveal">${escapeHtml(slide.title)}</span></h2>
      ${slide.subtitle ? `<p class="lead">${escapeHtml(slide.subtitle)}</p>` : ""}
      ${renderBodyBlocks(slide)}
    </div>
    ${renderVisualPane(slide)}
    <div class="brand-mark">${escapeHtml(brandMark(slide))}</div>
    ${renderNotes(slide)}
  </section>`;
}

function renderDataSlide(slide: CourseSlideSpec, deck: CourseDeckSpec, isActive: boolean) {
  return `<section class="slide ${isActive ? "active " : ""}s-split s-split-rev data-slide" data-screen-label="${String(slide.order).padStart(2, "0")} ${escapeHtml(slide.title)}" data-title="${escapeHtml(slide.title)}">
    <div class="chart-pane">
      ${renderChart(slide, deck)}
    </div>
    <div class="content-pane">
      <div class="kicker">${escapeHtml(slideKicker(slide, deck))}</div>
      <h2 class="display-large"><span class="anim-color">${escapeHtml(slide.title)}</span></h2>
      ${slide.subtitle ? `<p class="lead">${escapeHtml(slide.subtitle)}</p>` : ""}
      ${renderBodyBlocks(slide)}
    </div>
    <div class="brand-mark">${escapeHtml(brandMark(slide))}</div>
    ${renderNotes(slide)}
  </section>`;
}

function renderFrameworkSlide(slide: CourseSlideSpec, deck: CourseDeckSpec, isActive: boolean) {
  const items = bulletItems(slide).slice(0, 3);
  const cards = (items.length ? items : slide.bodyBlocks.map((block) => block.text || "").filter(Boolean))
    .slice(0, 3)
    .map((item, index) => {
      const separator = item.indexOf(":");
      const label = separator > 0 ? item.slice(0, separator).trim() : item;
      const description = separator > 0 ? item.slice(separator + 1).trim() : "";

      return `<div class="card anim-fade-up stagger-${index + 1}">
      <div class="card-index">${String(index + 1).padStart(2, "0")}</div>
      <h3>${escapeHtml(label || `Idea ${index + 1}`)}</h3>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
    </div>`;
    })
    .join("");

  return `<section class="slide ${isActive ? "active " : ""}framework-slide" data-screen-label="${String(slide.order).padStart(2, "0")} ${escapeHtml(slide.title)}" data-title="${escapeHtml(slide.title)}">
    ${renderCrosshairs()}
    <div class="brand-mark">${escapeHtml(brandMark(slide))}</div>
    <div class="footer-safe-top">
      <div class="kicker">${escapeHtml(deck.designSystem.brandLabel)}</div>
      <h2 class="display-large">${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="lead framework-lead">${escapeHtml(slide.subtitle)}</p>` : ""}
      <div class="grid-3">${cards}</div>
    </div>
    ${renderNotes(slide)}
  </section>`;
}

function renderClosingSlide(slide: CourseSlideSpec, deck: CourseDeckSpec, isActive: boolean) {
  const lead = slide.subtitle || firstTextBlock(slide);
  return `<section class="slide ${isActive ? "active " : ""}s-center closing-slide" data-screen-label="${String(slide.order).padStart(2, "0")} ${escapeHtml(slide.title)}" data-title="${escapeHtml(slide.title)}">
    ${renderBackgroundPane(slide)}
    <div class="ch-tl crosshair"></div><div class="ch-br crosshair"></div>
    <div class="center-copy">
      <div class="kicker">${escapeHtml(deck.designSystem.brandLabel)}</div>
      <h2 class="display-huge"><span class="anim-typewriter">${escapeHtml(slide.title)}</span></h2>
      ${lead ? `<p class="lead max-center">${escapeHtml(lead)}</p>` : ""}
    </div>
    ${renderNotes(slide)}
  </section>`;
}

function renderSlide(slide: CourseSlideSpec, deck: CourseDeckSpec, isActive: boolean) {
  if (slide.chart || slide.type === "data_explainer") {
    return renderDataSlide(slide, deck, isActive);
  }

  const preferredLayout = slide.renderHints?.layout;
  if (preferredLayout === "center") {
    return renderCenterSlide(slide, deck, isActive);
  }
  if (preferredLayout === "closing") {
    return renderClosingSlide(slide, deck, isActive);
  }
  if (preferredLayout === "framework" && bulletItems(slide).length >= 2) {
    return renderFrameworkSlide(slide, deck, isActive);
  }
  if (preferredLayout === "split") {
    return renderSplitSlide(slide, deck, isActive, false);
  }
  if (preferredLayout === "split_reverse") {
    return renderSplitSlide(slide, deck, isActive, true);
  }

  if (slide.type === "cover" || slide.type === "quote" || slide.type === "transition") {
    return renderCenterSlide(slide, deck, isActive);
  }

  if (slide.type === "summary") {
    return renderClosingSlide(slide, deck, isActive);
  }

  if (["objectives", "exercise", "knowledge_check", "diagram", "bibliography"].includes(slide.type) && bulletItems(slide).length >= 2) {
    return renderFrameworkSlide(slide, deck, isActive);
  }

  return renderSplitSlide(slide, deck, isActive, slide.order % 2 === 1);
}

function renderCss(deck: CourseDeckSpec) {
  const theme = resolveCourseDeckTheme(deck);
  const displayFont = deck.designSystem.fontPairing === "system_sans"
    ? "Arial, Helvetica, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    : deck.designSystem.fontPairing === "technical_mono"
      ? "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
      : "Georgia, 'Times New Roman', Cambria, serif";
  const bodyFont = deck.designSystem.fontPairing === "technical_mono"
    ? "'SFMono-Regular', Consolas, 'Liberation Mono', monospace"
    : "Arial, Helvetica, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  return `:root {
  --font-display: ${displayFont};
  --font-ui: ${bodyFont};
  color-scheme: ${deck.appearance};
  --bg: ${theme.background};
  --bg-positive: ${theme.backgroundPositive};
  --shell: ${theme.surface};
  --shell-rgb: ${theme.surfaceRgb};
  --blue-deep: ${theme.text};
  --chrome-rgb: ${theme.chromeRgb};
  --image-pane: ${theme.imagePane};
  --accent: ${theme.accent};
  --accent-accessible: ${theme.accent2};
  --muted: ${theme.muted};
  --grid-line: rgba(var(--chrome-rgb), 0.10);
  --type-display-hero: 126px;
  --type-display-large: 86px;
  --type-lead: 30px;
  --type-body: 24px;
  --type-label: 14px;
}
* { box-sizing: border-box; }
html, body {
  margin: 0;
  min-height: 100%;
  background: var(--shell);
  color: var(--blue-deep);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
.deck-shell { position: fixed; inset: 0; overflow: hidden; background: var(--shell); }
.deck-stage {
  width: ${deck.width}px;
  height: ${deck.height}px;
  position: relative;
  overflow: hidden;
  background: var(--bg);
  transform-origin: top left;
  box-shadow: 0 30px 80px rgba(var(--chrome-rgb), 0.15);
}
.deck-stage::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(var(--chrome-rgb),.045) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--chrome-rgb),.045) 1px, transparent 1px);
  background-size: 80px 80px;
  pointer-events: none;
  z-index: 0;
}
.slide {
  position: absolute;
  inset: 0;
  width: ${deck.width}px;
  height: ${deck.height}px;
  overflow: hidden;
  padding: 80px 120px;
  background: var(--bg);
  color: var(--blue-deep);
  display: none;
}
.slide.active { display: flex; flex-direction: column; }
.s-center { justify-content: center; align-items: center; text-align: center; }
.s-split {
  display: none;
  grid-template-columns: 1fr 1fr;
  align-items: stretch;
  padding: 0;
}
.s-split.active { display: grid; }
.s-split-rev .content-pane { order: 2; }
.s-split-rev .image-pane, .s-split-rev .chart-pane { order: 1; }
.content-pane {
  padding: 100px 120px;
  display: flex;
  min-width: 0;
  flex-direction: column;
  justify-content: center;
  position: relative;
  z-index: 2;
}
.image-pane, .chart-pane {
  width: 100%;
  height: ${deck.height}px;
  position: relative;
  overflow: hidden;
  background: var(--image-pane);
  display: flex;
  align-items: center;
  justify-content: center;
}
.image-pane::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, var(--bg) 0%, transparent 38%);
}
.image-pane.has-generated-supporting > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  position: absolute;
  inset: 0;
}
.s-split-rev .image-pane::after { background: linear-gradient(-90deg, var(--bg) 0%, transparent 38%); }
.visual-grid {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(circle at 30% 30%, rgba(35,174,168,.22), transparent 0 22%, transparent 23%),
    linear-gradient(rgba(var(--chrome-rgb),.08) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--chrome-rgb),.08) 1px, transparent 1px);
  background-size: auto, 64px 64px, 64px 64px;
}
.visual-object {
  width: 620px;
  min-height: 380px;
  padding: 54px;
  position: relative;
  z-index: 2;
  border: 1px solid rgba(var(--chrome-rgb),.16);
  background: rgba(var(--shell-rgb),.82);
  backdrop-filter: blur(8px);
  box-shadow: 0 24px 70px rgba(var(--chrome-rgb),.12);
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
}
.visual-object::before {
  content: '';
  position: absolute;
  inset: 34px;
  border: 1px solid rgba(var(--chrome-rgb),.12);
}
.visual-orbit {
  position: absolute;
  width: 230px;
  height: 230px;
  left: 74px;
  top: 58px;
  border: 2px solid var(--accent);
  border-radius: 999px;
  opacity: .72;
}
.visual-orbit::after {
  content: '';
  position: absolute;
  width: 112px;
  height: 112px;
  right: -58px;
  bottom: -36px;
  border: 2px solid var(--accent-accessible);
  border-radius: 999px;
  opacity: .72;
}
.visual-bar {
  position: absolute;
  right: 72px;
  height: 12px;
  background: var(--blue-deep);
  border-radius: 999px;
}
.visual-bar-a {
  top: 128px;
  width: 188px;
}
.visual-bar-b {
  top: 164px;
  width: 132px;
  background: var(--accent);
}
.visual-dot {
  position: absolute;
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: var(--accent);
}
.visual-dot-a {
  left: 116px;
  bottom: 88px;
}
.visual-dot-b {
  right: 122px;
  bottom: 92px;
  background: var(--accent-accessible);
}
.kicker {
  font-family: var(--font-ui);
  font-size: var(--type-label);
  line-height: 1.25;
  font-weight: 600;
  color: var(--accent-accessible);
  letter-spacing: .10em;
  text-transform: uppercase;
  margin-bottom: 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.kicker::before {
  content: '';
  display: block;
  width: 48px;
  height: 2px;
  background: var(--accent);
}
.s-center .kicker {
  display: block;
  color: var(--blue-deep);
}
.s-center .kicker::before { display: none; }
.display-huge, .display-large {
  font-family: var(--font-display);
  font-weight: 300;
  color: var(--blue-deep);
  margin: 0;
  text-wrap: balance;
}
.display-huge {
  max-width: 1320px;
  font-size: var(--type-display-hero);
  line-height: .96;
  letter-spacing: 0;
}
.display-large {
  max-width: 820px;
  font-size: var(--type-display-large);
  line-height: 1.04;
  letter-spacing: 0;
}
.lead {
  margin: 30px 0 0;
  max-width: 760px;
  font-size: var(--type-lead);
  line-height: 1.5;
  font-weight: 300;
  color: var(--muted);
}
.max-center {
  margin-left: auto;
  margin-right: auto;
  max-width: 980px;
}
.copy-block + .copy-block { margin-top: 18px; }
.point-list, .center-points {
  margin: 34px 0 0;
  padding: 0;
  list-style: none;
  display: grid;
  gap: 18px;
  max-width: 780px;
}
.point-list li, .center-points li {
  position: relative;
  padding-left: 28px;
  font-size: var(--type-body);
  line-height: 1.48;
  color: var(--blue-deep);
}
.point-list li::before, .center-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: .72em;
  width: 9px;
  height: 9px;
  background: var(--accent);
}
.center-points {
  display: flex;
  justify-content: center;
  gap: 34px;
  max-width: 1180px;
}
.center-points li {
  max-width: 320px;
  text-align: left;
}
.callout {
  margin-top: 30px;
  max-width: 760px;
  border-left: 4px solid var(--accent);
  background: rgba(var(--shell-rgb),.82);
  padding: 24px 30px;
  font-size: 24px;
  line-height: 1.45;
  color: var(--blue-deep);
}
.code {
  margin-top: 28px;
  max-width: 820px;
  background: var(--blue-deep);
  color: #F3F7F8;
  padding: 28px 32px;
  font-size: 22px;
  line-height: 1.55;
  overflow: hidden;
}
.framework-slide.active { display: flex; }
.footer-safe-top {
  max-height: 820px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  position: relative;
  z-index: 2;
}
.framework-lead { max-width: 980px; }
.grid-3 {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 40px;
  margin-top: 58px;
  width: 100%;
}
.card {
  min-height: 315px;
  border: 1px solid var(--grid-line);
  padding: 46px 40px;
  background: var(--shell);
  box-shadow: 0 10px 30px rgba(var(--chrome-rgb),.04);
  position: relative;
}
.card-index {
  width: 58px;
  height: 58px;
  border: 1px solid var(--accent);
  background: rgba(35,174,168,.06);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 34px;
  color: var(--accent-accessible);
  font-size: 16px;
  letter-spacing: .10em;
  font-weight: 600;
}
.card h3 {
  margin: 0 0 18px;
  font-size: 34px;
  line-height: 1.12;
  font-weight: 600;
  color: var(--blue-deep);
}
.card p {
  margin: 0;
  font-size: 23px;
  line-height: 1.5;
  color: var(--muted);
}
.chart-pane {
  padding: 82px;
  background: var(--bg-positive);
}
.chart-card {
  width: 760px;
  background: rgba(var(--shell-rgb),.94);
  border: 1px solid rgba(var(--chrome-rgb),.12);
  padding: 34px;
  box-shadow: 0 24px 70px rgba(var(--chrome-rgb),.10);
}
.cf-chart { width: 100%; height: auto; display: block; }
.chart-title { font-size: 26px; font-weight: 800; fill: var(--blue-deep); }
.chart-subtitle, .chart-label { font-size: 18px; fill: var(--muted); }
.chart-value { font-size: 19px; font-weight: 800; fill: var(--blue-deep); }
.chart-big { font-size: 58px; font-weight: 900; fill: var(--blue-deep); }
.chart-track { fill: rgba(var(--chrome-rgb),.08); }
.chart-axis { stroke: rgba(var(--chrome-rgb),.32); stroke-width: 2; }
.chart-grid { stroke: rgba(var(--chrome-rgb),.10); stroke-width: 1.5; }
.brand-mark {
  position: absolute;
  top: 60px;
  right: 120px;
  z-index: 10;
  font-size: var(--type-label);
  line-height: 1.25;
  font-weight: 500;
  color: var(--muted);
  letter-spacing: .10em;
  text-transform: uppercase;
}
.crosshair {
  position: absolute;
  width: 28px;
  height: 28px;
  z-index: 5;
}
.crosshair::before, .crosshair::after {
  content: '';
  position: absolute;
  background: var(--blue-deep);
  opacity: .35;
}
.crosshair::before { top: 50%; left: 0; right: 0; height: 1px; transform: translateY(-50%); }
.crosshair::after { left: 50%; top: 0; bottom: 0; width: 1px; transform: translateX(-50%); }
.ch-tl { top: 60px; left: 60px; }
.ch-tr { top: 60px; right: 60px; }
.ch-bl { bottom: 60px; left: 60px; }
.ch-br { bottom: 60px; right: 60px; }
.closing-slide {
  background: var(--blue-deep);
  color: var(--shell);
}
.closing-slide .bg-pane {
  background:
    linear-gradient(rgba(35,174,168,.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(35,174,168,.18) 1px, transparent 1px),
    var(--blue-deep);
  background-size: 120px 120px;
}
.closing-slide .display-huge, .closing-slide .lead, .closing-slide .kicker { color: var(--shell); }
.closing-slide .crosshair::before, .closing-slide .crosshair::after { background: var(--accent); opacity: .9; }
.bg-pane { position: absolute; inset: 0; background: var(--bg); z-index: 0; overflow: hidden; }
.bg-pane.has-generated-background > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  opacity: var(--generated-background-opacity, .14);
  filter: saturate(.78) contrast(1.06);
}
.center-copy { position: relative; z-index: 2; }
.deck-counter {
  position: fixed;
  bottom: 22px;
  left: 50%;
  transform: translateX(-50%);
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: rgba(var(--shell-rgb),.95);
  border: 1px solid rgba(var(--chrome-rgb),.10);
  box-shadow: 0 8px 30px rgba(var(--chrome-rgb),.10);
  padding: 5px;
  z-index: 999;
  font-family: var(--font-ui);
}
.deck-counter button {
  width: 36px;
  height: 36px;
  background: transparent;
  color: var(--blue-deep);
  border: 0;
  cursor: pointer;
  font-size: 22px;
}
.deck-counter button:hover { background: rgba(35,174,168,.15); }
.deck-counter button[disabled] { opacity: .3; cursor: default; }
.deck-count {
  padding: 0 14px;
  font-size: 13px;
  letter-spacing: .10em;
  color: var(--blue-deep);
}
.deck-count .total { color: rgba(var(--chrome-rgb),.45); }
.deck-hint {
  position: fixed;
  bottom: 28px;
  right: 28px;
  color: rgba(var(--chrome-rgb),.45);
  font-size: 11px;
  letter-spacing: .10em;
  text-transform: uppercase;
  z-index: 999;
}
.anim-marker, .anim-color, .anim-reveal, .anim-typewriter { position: relative; display: inline; }
.anim-marker::after {
  content: '';
  position: absolute;
  left: -2%;
  bottom: .08em;
  height: .18em;
  background: var(--accent);
  z-index: -1;
  opacity: .42;
  transform: skewX(-10deg);
  width: 0;
}
.slide.active .anim-marker::after { animation: draw-marker .6s cubic-bezier(.16,1,.3,1) .35s forwards; }
@keyframes draw-marker { to { width: 104%; } }
@keyframes shift-color { to { color: var(--accent-accessible); } }
.slide.active .anim-color { animation: shift-color .6s ease .45s forwards; }
.anim-reveal, .anim-typewriter { opacity: 1; }
.slide.active .anim-reveal, .slide.active .anim-typewriter { animation: none; }
.anim-fade-up { opacity: 1; transform: none; }
.slide.active .anim-fade-up { animation: none; }
.slide.active .stagger-1, .slide.active .stagger-2, .slide.active .stagger-3 { animation-delay: 0s; }
@keyframes fade-up { to { opacity: 1; transform: translateY(0); } }
.notes { display: none !important; }
@media print {
  .deck-shell { position: static !important; display: block !important; overflow: visible !important; }
  .deck-stage { transform: none !important; height: auto !important; position: static !important; box-shadow: none !important; }
  .slide { display: flex !important; position: relative !important; page-break-after: always; break-after: page; }
  .s-split, .s-split.active, .data-slide { display: grid !important; }
  .slide:last-child { page-break-after: auto; break-after: auto; }
  .deck-counter, .deck-hint { display: none !important; }
}`;
}

function renderRuntime(deck: CourseDeckSpec) {
  const storeKey = JSON.stringify(`soflia-engine-deck:${deck.materialComponentId}`);

  return `<script data-soflia-template-runtime="soflia-deck">
(() => {
  const stage = document.getElementById("deck-stage");
  const slides = Array.from(document.querySelectorAll(".slide"));
  const prev = document.getElementById("deck-prev");
  const next = document.getElementById("deck-next");
  const cur = document.getElementById("deck-cur");
  const total = document.getElementById("deck-total");
  const storeKey = ${storeKey};
  let index = 0;

  function pad(value) {
    return value < 10 ? "0" + value : String(value);
  }

  function scaleStage() {
    if (!stage) return;
    const scale = Math.min(window.innerWidth / ${deck.width}, window.innerHeight / ${deck.height});
    const tx = (window.innerWidth - (${deck.width} * scale)) / 2;
    const ty = (window.innerHeight - (${deck.height} * scale)) / 2;
    stage.style.transform = "translate(" + tx + "px," + ty + "px) scale(" + scale + ")";
  }

  function paint() {
    slides.forEach((slide, slideIndex) => {
      slide.classList.toggle("active", slideIndex === index);
    });
    if (cur) cur.textContent = pad(index + 1);
    if (total) total.textContent = pad(slides.length);
    if (prev) prev.toggleAttribute("disabled", index <= 0);
    if (next) next.toggleAttribute("disabled", index >= slides.length - 1);
  }

  function go(nextIndex) {
    index = Math.max(0, Math.min(slides.length - 1, nextIndex));
    paint();
    try { window.localStorage.setItem(storeKey, String(index)); } catch (_) {}
  }

  prev?.addEventListener("click", () => go(index - 1));
  next?.addEventListener("click", () => go(index + 1));
  window.addEventListener("resize", scaleStage);
  window.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "PageDown" || event.key === " ") {
      event.preventDefault();
      go(index + 1);
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      go(index - 1);
    }
    if (event.key === "Home") {
      event.preventDefault();
      go(0);
    }
    if (event.key === "End") {
      event.preventDefault();
      go(slides.length - 1);
    }
  }, true);

  try {
    const saved = Number(window.localStorage.getItem(storeKey));
    if (!Number.isNaN(saved) && saved >= 0 && saved < slides.length) {
      index = saved;
    }
  } catch (_) {}

  scaleStage();
  paint();
})();
</script>`;
}

export function renderCourseDeckHtml(deck: CourseDeckSpec) {
  const sortedSlides = [...deck.slides].sort((left, right) => left.order - right.order);
  const slides = sortedSlides
    .map((slide, index) => renderSlide(slide, deck, index === 0))
    .join("\n");

  return `<!doctype html>
<html lang="${deck.locale}" data-appearance="${deck.appearance}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${deck.width}, initial-scale=1">
  <title>${escapeHtml(deck.sourceSnapshot.title || "SofLIA - Engine Deck")}</title>
  <style>${renderCss(deck)}</style>
</head>
<body>
  <div class="deck-shell">
    <div class="deck-stage" id="deck-stage">
      ${slides}
    </div>
  </div>
  <nav class="deck-counter" role="navigation" aria-label="Navegacion de presentacion">
    <button type="button" id="deck-prev" aria-label="Diapositiva anterior">&lsaquo;</button>
    <span class="deck-count"><span id="deck-cur">01</span> <span class="total">/ <span id="deck-total">${String(sortedSlides.length).padStart(2, "0")}</span></span></span>
    <button type="button" id="deck-next" aria-label="Diapositiva siguiente">&rsaquo;</button>
  </nav>
  <div class="deck-hint">Flechas para navegar</div>
  ${renderRuntime(deck)}
</body>
</html>`;
}
