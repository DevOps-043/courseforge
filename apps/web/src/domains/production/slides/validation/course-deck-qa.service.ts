import type {
  CourseDeckSpec,
  CourseSlideSpec,
} from "../specs/course-deck.schema";

export type CourseDeckQaSeverity = "error" | "warning";
export type CourseDeckQaStatus = "PASS" | "WARN" | "FAIL";

export interface CourseDeckQaFinding {
  code: string;
  message: string;
  severity: CourseDeckQaSeverity;
  slideId?: string;
}

export interface CourseDeckQaReport {
  checks: {
    chartContracts: boolean;
    htmlSafety: boolean;
    renderContract: boolean;
    slideOrder: boolean;
    textDensity: boolean;
  };
  findings: CourseDeckQaFinding[];
  generatedAt: string;
  status: CourseDeckQaStatus;
  summary: {
    chartCount: number;
    htmlBytes: number;
    maxTextCharactersOnSlide: number;
    slideCount: number;
    source: CourseDeckSpec["sourceSnapshot"]["source"];
    template: CourseDeckSpec["template"];
  };
}

const MAX_RECOMMENDED_SLIDE_TEXT_CHARS = 900;
const MAX_BLOCKING_SLIDE_TEXT_CHARS = 1500;
const MAX_RECOMMENDED_TITLE_CHARS = 96;

function textLengthForBlock(block: CourseSlideSpec["bodyBlocks"][number]) {
  if (block.kind === "bullets") {
    return (block.items || []).join(" ").length;
  }

  return (block.text || "").length;
}

function textLengthForSlide(slide: CourseSlideSpec) {
  const bodyLength = slide.bodyBlocks.reduce(
    (total, block) => total + textLengthForBlock(block),
    0,
  );

  return bodyLength + slide.title.length + (slide.subtitle?.length || 0);
}

function pushFinding(
  findings: CourseDeckQaFinding[],
  finding: CourseDeckQaFinding,
) {
  findings.push(finding);
}

function validateSlideOrder(
  deckSpec: CourseDeckSpec,
  findings: CourseDeckQaFinding[],
) {
  const orders = deckSpec.slides.map((slide) => slide.order);
  const uniqueOrders = new Set(orders);
  const expectedOrders = Array.from(
    { length: deckSpec.slides.length },
    (_, index) => index + 1,
  );

  if (uniqueOrders.size !== orders.length) {
    pushFinding(findings, {
      code: "duplicate_slide_order",
      message: "El deck contiene ordenes de slide duplicados.",
      severity: "error",
    });
  }

  const isContiguous = expectedOrders.every((order) => uniqueOrders.has(order));
  if (!isContiguous) {
    pushFinding(findings, {
      code: "non_contiguous_slide_order",
      message: "El deck debe tener ordenes de slide consecutivos desde 1.",
      severity: "error",
    });
  }
}

function validateTextDensity(
  deckSpec: CourseDeckSpec,
  findings: CourseDeckQaFinding[],
) {
  for (const slide of deckSpec.slides) {
    const slideTextLength = textLengthForSlide(slide);

    if (slide.title.length > MAX_RECOMMENDED_TITLE_CHARS) {
      pushFinding(findings, {
        code: "long_slide_title",
        message: "El titulo de la slide podria desbordarse en layouts compactos.",
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (slideTextLength > MAX_BLOCKING_SLIDE_TEXT_CHARS) {
      pushFinding(findings, {
        code: "excessive_slide_text",
        message: "La slide concentra demasiado texto para una presentacion visual.",
        severity: "error",
        slideId: slide.id,
      });
      continue;
    }

    if (slideTextLength > MAX_RECOMMENDED_SLIDE_TEXT_CHARS) {
      pushFinding(findings, {
        code: "dense_slide_text",
        message: "La slide es legible, pero conviene reducir texto antes de produccion final.",
        severity: "warning",
        slideId: slide.id,
      });
    }
  }
}

function validateChartContracts(
  deckSpec: CourseDeckSpec,
  html: string,
  findings: CourseDeckQaFinding[],
) {
  const chartSlides = deckSpec.slides.filter((slide) => slide.chart);
  const renderedChartCount = (html.match(/class="cf-chart"/g) || []).length;

  if (renderedChartCount !== chartSlides.length) {
    pushFinding(findings, {
      code: "chart_render_mismatch",
      message: "La cantidad de graficas declaradas no coincide con las graficas SVG renderizadas.",
      severity: "error",
    });
  }

  for (const slide of deckSpec.slides) {
    if (slide.type === "data_explainer" && !slide.chart) {
      pushFinding(findings, {
        code: "data_slide_without_chart",
        message: "Una slide de datos debe incluir una grafica renderizable.",
        severity: "error",
        slideId: slide.id,
      });
    }

    if (!slide.chart) {
      continue;
    }

    if (slide.chart.sourceRefs.length === 0) {
      pushFinding(findings, {
        code: "chart_without_source_refs",
        message: "La grafica no declara referencias de origen para auditoria.",
        severity: "warning",
        slideId: slide.id,
      });
    }

    if (
      slide.chart.type === "proportion" &&
      slide.chart.value > slide.chart.total
    ) {
      pushFinding(findings, {
        code: "invalid_proportion_chart",
        message: "La grafica proporcional tiene un valor mayor que el total.",
        severity: "error",
        slideId: slide.id,
      });
    }
  }
}

function stripTrustedTemplateRuntime(html: string) {
  return html.replace(
    /<script\b(?=[^>]*\bdata-soflia-template-runtime=(["'])soflia-deck\1)[^>]*>[\s\S]*?<\/script>/gi,
    "",
  );
}

function validateHtmlSafety(html: string, findings: CourseDeckQaFinding[]) {
  const htmlForSafetyScan = stripTrustedTemplateRuntime(html);
  const disallowedPatterns = [
    { code: "script_tag", pattern: /<script\b/i },
    { code: "iframe_tag", pattern: /<iframe\b/i },
    { code: "object_tag", pattern: /<object\b/i },
    { code: "embed_tag", pattern: /<embed\b/i },
    { code: "javascript_url", pattern: /javascript:/i },
    { code: "inline_event_handler", pattern: /\son[a-z]+\s*=/i },
  ];

  for (const pattern of disallowedPatterns) {
    if (pattern.pattern.test(htmlForSafetyScan)) {
      pushFinding(findings, {
        code: pattern.code,
        message: "El HTML renderizado contiene una construccion no permitida.",
        severity: "error",
      });
    }
  }
}

function validateRenderContract(
  deckSpec: CourseDeckSpec,
  html: string,
  findings: CourseDeckQaFinding[],
) {
  const renderedSlideCount = (html.match(/<section class="slide/g) || []).length;

  if (renderedSlideCount !== deckSpec.slides.length) {
    pushFinding(findings, {
      code: "slide_render_mismatch",
      message: "La cantidad de slides declaradas no coincide con las slides HTML renderizadas.",
      severity: "error",
    });
  }

  if (!html.includes(`width=${deckSpec.width}`)) {
    pushFinding(findings, {
      code: "missing_viewport_contract",
      message: "El HTML no declara el viewport fijo esperado para exportacion.",
      severity: "error",
    });
  }
}

function buildChecks(findings: CourseDeckQaFinding[]) {
  return {
    chartContracts: !findings.some((finding) =>
      finding.severity === "error" &&
      [
        "chart_render_mismatch",
        "data_slide_without_chart",
        "invalid_proportion_chart",
      ].includes(finding.code),
    ),
    htmlSafety: !findings.some((finding) =>
      finding.severity === "error" &&
      [
        "embed_tag",
        "iframe_tag",
        "inline_event_handler",
        "javascript_url",
        "object_tag",
        "script_tag",
      ].includes(finding.code),
    ),
    renderContract: !findings.some((finding) =>
      finding.severity === "error" &&
      ["missing_viewport_contract", "slide_render_mismatch"].includes(finding.code),
    ),
    slideOrder: !findings.some((finding) =>
      finding.severity === "error" &&
      ["duplicate_slide_order", "non_contiguous_slide_order"].includes(finding.code),
    ),
    textDensity: !findings.some((finding) =>
      finding.severity === "error" && finding.code === "excessive_slide_text",
    ),
  };
}

function resolveStatus(findings: CourseDeckQaFinding[]): CourseDeckQaStatus {
  if (findings.some((finding) => finding.severity === "error")) {
    return "FAIL";
  }

  if (findings.some((finding) => finding.severity === "warning")) {
    return "WARN";
  }

  return "PASS";
}

export function validateCourseDeckQuality(params: {
  deckSpec: CourseDeckSpec;
  html: string;
}): CourseDeckQaReport {
  const findings: CourseDeckQaFinding[] = [];

  validateSlideOrder(params.deckSpec, findings);
  validateTextDensity(params.deckSpec, findings);
  validateChartContracts(params.deckSpec, params.html, findings);
  validateHtmlSafety(params.html, findings);
  validateRenderContract(params.deckSpec, params.html, findings);

  const maxTextCharactersOnSlide = params.deckSpec.slides.reduce(
    (max, slide) => Math.max(max, textLengthForSlide(slide)),
    0,
  );
  const chartCount = params.deckSpec.slides.filter((slide) => slide.chart).length;

  return {
    checks: buildChecks(findings),
    findings,
    generatedAt: new Date().toISOString(),
    status: resolveStatus(findings),
    summary: {
      chartCount,
      htmlBytes: Buffer.byteLength(params.html, "utf8"),
      maxTextCharactersOnSlide,
      slideCount: params.deckSpec.slides.length,
      source: params.deckSpec.sourceSnapshot.source,
      template: params.deckSpec.template,
    },
  };
}
