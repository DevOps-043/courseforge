import { renderCourseChartSvg } from "../charts/svg-chart-renderer.service";
import type { CourseDeckSpec, CourseSlideSpec } from "../specs/course-deck.schema";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderBlock(block: CourseSlideSpec["bodyBlocks"][number]) {
  if (block.kind === "bullets") {
    const items = (block.items || [])
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join("");
    return `<ul class="lesson-list">${items}</ul>`;
  }
  if (block.kind === "callout") {
    return `<div class="callout">${escapeHtml(block.text || "")}</div>`;
  }
  if (block.kind === "code") {
    return `<pre class="code"><code>${escapeHtml(block.text || "")}</code></pre>`;
  }
  return `<p class="lede">${escapeHtml(block.text || "")}</p>`;
}

function renderSlide(slide: CourseSlideSpec, deck: CourseDeckSpec) {
  const body = slide.bodyBlocks.map(renderBlock).join("\n");
  const chart = slide.chart
    ? `<div class="chart-wrap">${renderCourseChartSvg(slide.chart, {
        accent: deck.designSystem.accent,
        accent2: deck.designSystem.accent2,
      })}</div>`
    : "";
  const notes = slide.speakerNotes
    ? `<aside class="notes">${escapeHtml(slide.speakerNotes)}</aside>`
    : "";
  const slideClass = slide.type === "cover" || slide.type === "summary"
    ? "slide full"
    : "slide";

  return `<section class="${slideClass}" data-screen-label="${String(slide.order).padStart(2, "0")} ${escapeHtml(slide.title)}" data-title="${escapeHtml(slide.title)}">
    <aside class="sidebar">
      <div class="brand">${escapeHtml(deck.designSystem.brandLabel)}</div>
      <h5>Leccion</h5>
      <p class="dim">${escapeHtml(deck.sourceSnapshot.title || "Modulo del curso")}</p>
      <h5>Progreso</h5>
      <p class="dim">${slide.order} / ${deck.slides.length}</p>
    </aside>
    <main class="main">
      <p class="kicker">${escapeHtml(slide.type.replace(/_/g, " ").toUpperCase())}</p>
      <h2 class="h2">${escapeHtml(slide.title)}</h2>
      ${slide.subtitle ? `<p class="subtitle">${escapeHtml(slide.subtitle)}</p>` : ""}
      ${body}
      ${chart}
    </main>
    <div class="deck-footer"><span>${escapeHtml(deck.designSystem.brandLabel)}</span><span>${slide.order} / ${deck.slides.length}</span></div>
    ${notes}
  </section>`;
}

function renderCss(deck: CourseDeckSpec) {
  return `:root {
  --bg: #fbfaf6;
  --bg-soft: #f4f1e8;
  --surface: #ffffff;
  --surface-2: #f6f3ea;
  --border: rgba(60,45,20,.12);
  --text-1: #2a2418;
  --text-2: #5a5140;
  --text-3: #8a7f68;
  --accent: ${deck.designSystem.accent};
  --accent-2: ${deck.designSystem.accent2};
}
* { box-sizing: border-box; }
html, body { margin: 0; padding: 0; background: var(--bg); color: var(--text-1); font-family: Inter, Arial, sans-serif; }
.deck { width: ${deck.width}px; min-height: ${deck.height}px; background: var(--bg); }
.slide { position: relative; width: ${deck.width}px; height: ${deck.height}px; padding: 64px 80px; display: grid; grid-template-columns: 280px 1fr; gap: 56px; overflow: hidden; background: var(--bg); }
.slide.full { grid-template-columns: 1fr; display: flex; flex-direction: column; justify-content: center; padding-right: 240px; }
.slide.full .sidebar { display: none; }
.sidebar { border-right: 1px solid var(--border); padding-right: 32px; }
.brand { font-family: Georgia, serif; font-size: 28px; font-weight: 700; color: var(--accent); }
.sidebar h5, .kicker { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: .14em; color: var(--accent-2); }
.dim { color: var(--text-2); font-size: 18px; line-height: 1.55; }
.main { min-width: 0; align-self: center; }
.h2 { margin: 0; font-family: Georgia, serif; font-size: 64px; line-height: 1.04; letter-spacing: -0.02em; color: var(--text-1); max-width: 980px; }
.subtitle { margin: 18px 0 0; font-size: 30px; line-height: 1.35; color: var(--text-2); max-width: 1000px; }
.lede { margin: 30px 0 0; font-size: 30px; line-height: 1.45; color: var(--text-2); max-width: 980px; }
.lesson-list { margin: 34px 0 0; padding: 0; list-style: none; display: grid; gap: 18px; max-width: 1000px; }
.lesson-list li { padding: 22px 26px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface); box-shadow: 0 12px 30px rgba(60,45,20,.07); font-size: 28px; line-height: 1.32; color: var(--text-1); }
.callout { margin-top: 30px; max-width: 980px; border-left: 6px solid var(--accent-2); background: var(--surface-2); padding: 24px 30px; border-radius: 0 16px 16px 0; font-size: 26px; line-height: 1.38; color: var(--text-2); }
.code { margin-top: 28px; max-width: 1040px; background: #2a2418; color: #f4f1e8; border-radius: 16px; padding: 26px 30px; font-size: 22px; line-height: 1.55; overflow: hidden; }
.chart-wrap { margin-top: 30px; max-width: 920px; border: 1px solid var(--border); border-radius: 18px; background: var(--surface); padding: 18px; box-shadow: 0 12px 30px rgba(60,45,20,.07); }
.cf-chart { width: 100%; height: auto; }
.chart-title { font-size: 26px; font-weight: 800; fill: var(--text-1); }
.chart-subtitle, .chart-label { font-size: 18px; fill: var(--text-2); }
.chart-value { font-size: 19px; font-weight: 800; fill: var(--text-1); }
.chart-big { font-size: 58px; font-weight: 900; fill: var(--text-1); }
.chart-track { fill: rgba(42,36,24,.08); }
.chart-axis { stroke: rgba(42,36,24,.32); stroke-width: 2; }
.chart-grid { stroke: rgba(42,36,24,.10); stroke-width: 1.5; }
.deck-footer { position: absolute; left: 80px; right: 80px; bottom: 36px; display: flex; justify-content: space-between; color: var(--text-3); font-size: 16px; }
.notes { display: none !important; }`;
}

export function renderCourseDeckHtml(deck: CourseDeckSpec) {
  const slides = deck.slides
    .sort((left, right) => left.order - right.order)
    .map((slide) => renderSlide(slide, deck))
    .join("\n");

  return `<!doctype html>
<html lang="${deck.locale}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=${deck.width}, initial-scale=1">
  <title>${escapeHtml(deck.sourceSnapshot.title || "SofLIA - Engine Deck")}</title>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800;900&display=swap">
  <style>${renderCss(deck)}</style>
</head>
<body>
  <div class="deck">
    ${slides}
  </div>
</body>
</html>`;
}
