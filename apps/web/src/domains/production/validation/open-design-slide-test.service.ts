export interface OpenDesignSlideDocument {
  index: number;
  label: string;
  html: string;
  width: number;
  height: number;
}

export interface OpenDesignCleanupReport {
  slideCount: number;
  removedScripts: number;
  removedOpenDesignScripts: number;
  removedControllerNodes: number;
  removedDynamicVisibilityRules: number;
  hasSceneControllerResidue: boolean;
}

export interface PreparedOpenDesignDeck {
  slides: OpenDesignSlideDocument[];
  cleanup: OpenDesignCleanupReport;
}

export interface HtmlSlideRasterizeInput {
  html: string;
  slideIndex: number;
  label: string;
  width: number;
  height: number;
}

export interface HtmlSlideRasterizeResult {
  buffer: Uint8Array;
  width?: number;
  height?: number;
  contentType?: string;
}

export type HtmlSlideRasterizer = (
  input: HtmlSlideRasterizeInput,
) => Promise<HtmlSlideRasterizeResult>;

export interface OpenDesignRasterizedSlide {
  index: number;
  label: string;
  width: number;
  height: number;
  contentType: "image/png";
  byteLength: number;
  buffer: Uint8Array;
}

export interface OpenDesignHtmlToPngTestResult {
  cleanup: OpenDesignCleanupReport;
  slides: OpenDesignRasterizedSlide[];
}

interface ExtractedSlide {
  index: number;
  label: string;
  markup: string;
  start: number;
  end: number;
}

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;
const SLIDE_RE =
  /<section\b(?=[^>]*\bclass=(["'])[^"']*\bslide\b[^"']*\1)[\s\S]*?<\/section>/gi;
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script>/gi;
const OD_SCRIPT_RE = /<script\b(?=[^>]*\bdata-od-[^=>\s]+)[^>]*>[\s\S]*?<\/script>/gi;
const DECK_COUNTER_RE = /<nav\b(?=[^>]*\bclass=(["'])[^"']*\bdeck-counter\b[^"']*\1)[\s\S]*?<\/nav>/gi;
const DECK_HINT_RE = /<div\b(?=[^>]*\bclass=(["'])[^"']*\bdeck-hint\b[^"']*\1)[\s\S]*?<\/div>/gi;
const DYNAMIC_VISIBILITY_RULE_RE =
  /[^{}]*(?:\.deck-counter|\.deck-hint)[^{]*\{[^{}]*\}/gi;
const CONTROLLER_RESIDUE_RE =
  /data-od-|deck-prev|deck-next|deck-counter|deck-hint|localStorage|sessionStorage|addEventListener\(['"]keydown|postMessage\(/i;
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;

function countMatches(source: string, pattern: RegExp): number {
  return Array.from(source.matchAll(pattern)).length;
}

function readAttribute(markup: string, attr: string): string | null {
  const match = markup.match(new RegExp(`\\b${attr}=(["'])(.*?)\\1`, "i"));
  return match?.[2] ?? null;
}

function extractSlides(html: string): ExtractedSlide[] {
  return Array.from(html.matchAll(SLIDE_RE), (match, index) => {
    const markup = match[0];
    const start = match.index ?? 0;
    return {
      index: index + 1,
      label: readAttribute(markup, "data-screen-label") || `Slide ${index + 1}`,
      markup,
      start,
      end: start + markup.length,
    };
  });
}

function normalizeSlideClass(markup: string): string {
  return markup.replace(/\bclass=(["'])(.*?)\1/i, (_full, quote: string, value: string) => {
    const classes = value
      .split(/\s+/)
      .filter((className) => className && className !== "active");
    return `class=${quote}${[...classes, "active"].join(" ")}${quote}`;
  });
}

function stripControllerChrome(html: string): string {
  return html
    .replace(SCRIPT_RE, "")
    .replace(DECK_COUNTER_RE, "")
    .replace(DECK_HINT_RE, "")
    .replace(DYNAMIC_VISIBILITY_RULE_RE, "");
}

function injectRasterizationStyle(html: string): string {
  const style = `
  <style data-courseforge-open-design-test-cleanup>
    html, body {
      width: ${CANVAS_WIDTH}px !important;
      height: ${CANVAS_HEIGHT}px !important;
      min-width: ${CANVAS_WIDTH}px !important;
      min-height: ${CANVAS_HEIGHT}px !important;
      overflow: hidden !important;
      margin: 0 !important;
      padding: 0 !important;
    }
    .deck-shell {
      position: fixed !important;
      inset: 0 !important;
      display: block !important;
      overflow: hidden !important;
    }
    .deck-stage {
      width: ${CANVAS_WIDTH}px !important;
      height: ${CANVAS_HEIGHT}px !important;
      transform: none !important;
      transform-origin: top left !important;
      box-shadow: none !important;
    }
    .slide {
      display: flex !important;
      flex-direction: column !important;
      position: absolute !important;
      inset: 0 !important;
      width: ${CANVAS_WIDTH}px !important;
      height: ${CANVAS_HEIGHT}px !important;
    }
  </style>`;

  if (html.includes("</head>")) {
    return html.replace("</head>", `${style}\n</head>`);
  }

  return `${style}\n${html}`;
}

function buildSlideDocument(html: string, slide: ExtractedSlide, allSlides: ExtractedSlide[]): string {
  const prefix = html.slice(0, allSlides[0].start);
  const suffix = html.slice(allSlides[allSlides.length - 1].end);
  return injectRasterizationStyle(
    stripControllerChrome(`${prefix}${normalizeSlideClass(slide.markup)}${suffix}`),
  );
}

function hasPngSignature(buffer: Uint8Array): boolean {
  return PNG_SIGNATURE.every((byte, index) => buffer[index] === byte);
}

function assertRenderablePng(
  slide: OpenDesignSlideDocument,
  result: HtmlSlideRasterizeResult,
): OpenDesignRasterizedSlide {
  if (!hasPngSignature(result.buffer)) {
    throw new Error(`OPEN_DESIGN_HTML_TO_PNG_INVALID: slide ${slide.index} no genero un PNG valido.`);
  }

  if (result.width !== undefined && result.width !== slide.width) {
    throw new Error(
      `OPEN_DESIGN_HTML_TO_PNG_SIZE_MISMATCH: slide ${slide.index} genero ancho ${result.width}, esperado ${slide.width}.`,
    );
  }

  if (result.height !== undefined && result.height !== slide.height) {
    throw new Error(
      `OPEN_DESIGN_HTML_TO_PNG_SIZE_MISMATCH: slide ${slide.index} genero alto ${result.height}, esperado ${slide.height}.`,
    );
  }

  if (result.contentType && result.contentType !== "image/png") {
    throw new Error(
      `OPEN_DESIGN_HTML_TO_PNG_CONTENT_TYPE: slide ${slide.index} genero ${result.contentType}, esperado image/png.`,
    );
  }

  return {
    index: slide.index,
    label: slide.label,
    width: result.width ?? slide.width,
    height: result.height ?? slide.height,
    contentType: "image/png",
    byteLength: result.buffer.byteLength,
    buffer: result.buffer,
  };
}

export function prepareOpenDesignDeckForHtmlToPng(html: string): PreparedOpenDesignDeck {
  const slides = extractSlides(html);
  if (slides.length === 0) {
    throw new Error("OPEN_DESIGN_DECK_EMPTY: no se encontraron secciones .slide.");
  }

  const removedControllerNodes =
    countMatches(html, DECK_COUNTER_RE) + countMatches(html, DECK_HINT_RE);
  const removedDynamicVisibilityRules = countMatches(html, DYNAMIC_VISIBILITY_RULE_RE);
  const removedScripts = countMatches(html, SCRIPT_RE);
  const removedOpenDesignScripts = countMatches(html, OD_SCRIPT_RE);
  const preparedSlides = slides.map((slide) => ({
    index: slide.index,
    label: slide.label,
    html: buildSlideDocument(html, slide, slides),
    width: CANVAS_WIDTH,
    height: CANVAS_HEIGHT,
  }));
  const hasSceneControllerResidue = preparedSlides.some((slide) =>
    CONTROLLER_RESIDUE_RE.test(slide.html),
  );

  return {
    slides: preparedSlides,
    cleanup: {
      slideCount: preparedSlides.length,
      removedScripts,
      removedOpenDesignScripts,
      removedControllerNodes,
      removedDynamicVisibilityRules,
      hasSceneControllerResidue,
    },
  };
}

export async function runOpenDesignHtmlToPngTestModule(
  html: string,
  rasterize: HtmlSlideRasterizer,
): Promise<OpenDesignHtmlToPngTestResult> {
  const prepared = prepareOpenDesignDeckForHtmlToPng(html);

  if (prepared.cleanup.hasSceneControllerResidue) {
    throw new Error("OPEN_DESIGN_CLEANUP_FAILED: quedaron residuos del controlador de escenas.");
  }

  const slides: OpenDesignRasterizedSlide[] = [];
  for (const slide of prepared.slides) {
    const result = await rasterize({
      html: slide.html,
      slideIndex: slide.index,
      label: slide.label,
      width: slide.width,
      height: slide.height,
    });
    slides.push(assertRenderablePng(slide, result));
  }

  return {
    cleanup: prepared.cleanup,
    slides,
  };
}
