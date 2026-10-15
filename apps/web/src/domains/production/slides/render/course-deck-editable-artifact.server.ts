import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import { courseDeckSpecSchema, type CourseDeckSpec } from "../specs/course-deck.schema";
import { renderCourseDeckSource } from "./html-deck-renderer.service";
import { produceCourseDeckEditorialCss } from "./course-deck-editorial-css.server";
import { prepareAnimatedDeckForRemotion } from "../../validation/animated-deck-preprocessor.service";
import { htmlEditingTrustedTemplateSchema, prepareInitialHtmlEditingRevision } from "../../composition-editor/html-editing/html-editing-bootstrap.server";
import { HTML_EDITING_LIMITS, type HtmlEditableManifest } from "../../composition-editor/html-editing/html-editing.contract";
import { htmlEditingChartSpecSchema } from "../../composition-editor/html-editing/html-editing-chart.contract";
import { renderCourseChartSvg } from "../charts/svg-chart-renderer.service";

export const COURSE_DECK_EDITORIAL_VERSION = "courseforge-generated-editable-deck-v1";
const digest = (source: string) => createHash("sha256").update(source, "utf8").digest("hex");
const uuid = z.string().uuid();
// Compiler preflight only: these identities never leave this process, grant
// authority, or create a revision. Real anchors are assigned on draft import.
const PREFLIGHT_ANCHOR = Object.freeze({ organizationId: "00000000-0000-4000-8000-000000000001",
  documentId: "00000000-0000-4000-8000-000000000002", revisionId: "00000000-0000-4000-8000-000000000003",
  documentSha256: "0".repeat(64), clipId: "generated-slide-preflight" });

const textGroups = [
  { selector: "h1 span, h2 span, h1, h2", key: "title", label: "Título", maximum: 180 },
  { selector: ".lead", key: "paragraph", label: "Texto", maximum: 900 },
  { selector: "li", key: "point", label: "Punto", maximum: 240 },
  { selector: ".card h3", key: "card-title", label: "Título de tarjeta", maximum: 240 },
  { selector: ".card p", key: "card-body", label: "Texto de tarjeta", maximum: 240 },
  { selector: ".callout", key: "callout", label: "Destacado", maximum: 900 },
  { selector: ".code code", key: "code", label: "Código", maximum: 900 },
] as const;

export class CourseDeckEditorialError extends Error {
  constructor(readonly code: "IMAGE_BINDING_MISSING" | "DUPLICATE_SLIDE_ID" | "INVALID_GENERATED_FIELD") {
    super(`COURSE_DECK_EDITORIAL_${code}`); this.name = "CourseDeckEditorialError";
  }
}

/** A generated artifact is preparation, NOT an installed/authorized template.
 * IDs/declarations originate in this deterministic producer, never the model or
 * client markup. Registry IDs must be supplied by the tenant-scoped server host.
 * Font requirements are explicit: no silent network access or font fallback. */
export function buildCourseDeckEditableArtifact(rawDeck: CourseDeckSpec, imageAssetIds: ReadonlyMap<string, string> = new Map(),
  instance?: { clipId: string; slideIndex: number }) {
  const deck = courseDeckSpecSchema.parse(rawDeck);
  if (new Set(deck.slides.map(slide => slide.id)).size !== deck.slides.length) throw new CourseDeckEditorialError("DUPLICATE_SLIDE_ID");
  const rendered = renderCourseDeckSource(deck);
  // Keep the full deck renderer/counts, but preflight only the requested saved
  // instance. Repeated narrative clips must not compile 24 unused neighbours.
  const selectedSlides = instance ? rendered.slides.filter((_slide, index) => index + 1 === instance.slideIndex) : rendered.slides;
  if (!selectedSlides.length) throw new CourseDeckEditorialError("INVALID_GENERATED_FIELD");
  const declarations: HtmlEditableManifest["elements"][] = [];
  const readOnlyFields: Array<{ slideId: string; field: string; reason: string }> = [];
  const slides = selectedSlides.map(({ slide, html }) => {
    const fragment = load(html, {}, false);
    // A narrative can reuse a slide in multiple clips. Each saved instance needs
    // its own IDs; changing IDs after compilation would break chart/CSS targets.
    const prefix = `cf-${digest(instance === undefined ? slide.id : JSON.stringify([slide.id, instance.clipId])).slice(0, 24)}`;
    const elements: HtmlEditableManifest["elements"] = [];
    for (const group of textGroups) {
      let position = 0;
      fragment(group.selector).each((_index, node) => {
        const target = fragment(node);
        if (target.children().length || target.attr("data-courseforge-editable-id")) return;
        const value = target.text();
        if (!value.trim()) return;
        const elementId = `${prefix}-${group.key}-${++position}`;
        const maximum = Math.max(group.maximum, Array.from(value).length);
        if (maximum > HTML_EDITING_LIMITS.textCharacters || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)) {
          readOnlyFields.push({ slideId: slide.id, field: elementId, reason: "UNSUPPORTED_TEXT_VALUE" });
          return;
        }
        target.attr("id", elementId).attr("data-courseforge-editable-id", elementId);
        elements.push({ kind: "TEXT", elementId, label: `${group.label} ${position}`, maxCharacters: maximum, multiline: group.key !== "title" });
      });
    }
    // The editorial adapter supports static containers, not pre/code tags.
    fragment("pre").each((_index, node) => { node.name = "div"; });
    fragment("code").each((_index, node) => { node.name = "span"; });
    if (slide.chart) {
      const chart = htmlEditingChartSpecSchema.safeParse(slide.chart);
      if (chart.success) {
        const elementId = `${prefix}-chart`;
        fragment(".chart-card").attr("id", elementId).attr("data-courseforge-editable-id", elementId)
          .html(renderCourseChartSvg(chart.data, { accent: deck.designSystem.accent, accent2: deck.designSystem.accent2 }));
        elements.push({ kind: "CHART", elementId, label: "Datos de la gráfica", chart: chart.data,
          accent: deck.designSystem.accent, accent2: deck.designSystem.accent2 });
      } else readOnlyFields.push({ slideId: slide.id, field: `${prefix}-chart`, reason: "UNSUPPORTED_CHART_VALUE" });
    }
    fragment("img").each((index, node) => {
      const target = fragment(node);
      const slotId = target.parent().attr("data-visual-asset");
      const assetId = slotId ? imageAssetIds.get(slotId) : undefined;
      if (!assetId || !uuid.safeParse(assetId).success) throw new CourseDeckEditorialError("IMAGE_BINDING_MISSING");
      const elementId = `${prefix}-image-${index + 1}`;
      target.attr("src", `conformance-media/${assetId}`).attr("id", elementId).attr("data-courseforge-editable-id", elementId);
      elements.push({ kind: "IMAGE", elementId, label: `Imagen ${index + 1}`, allowedAssetIds: [assetId], allowedFits: ["CONTAIN", "COVER"] });
    });
    if (!elements.length) throw new CourseDeckEditorialError("INVALID_GENERATED_FIELD");
    declarations.push(elements);
    return fragment.html();
  });
  const staticHtml = `<html lang="${deck.locale}" data-appearance="${deck.appearance}"><head><style>${produceCourseDeckEditorialCss(rendered.css)}</style></head><body>${slides.join("\n")}</body></html>`;
  const prepared = prepareAnimatedDeckForRemotion(staticHtml);
  const fragments = prepared.deck.slides.map((slide, position) => {
    // Include CSS in the immutable source hash. It cannot drift independently
    // when appearance/layout changes; compilation will isolate it per clip.
    // Legacy import cleanup may remove bracket-only operational notes. It must
    // not delete legitimate generated text such as a code block containing [1].
    const ownedInnerHtml = load(slides[position], {}, false)("section.slide").html();
    if (ownedInnerHtml === null) throw new CourseDeckEditorialError("INVALID_GENERATED_FIELD");
    const sourceHtml = `<style>${prepared.css}</style><div class="deck-scope" data-appearance="${deck.appearance}"><div class="deck-stage"><section class="${slide.classes}">${ownedInnerHtml}</section></div></div>`;
    const sourceSha256 = digest(sourceHtml);
    const template = htmlEditingTrustedTemplateSchema.parse({ format: "courseforge-html-editable-template-v1",
      templateId: `generated-${sourceSha256}`, templateVersion: 1, sourceSha256, elements: declarations[position] });
    const assetIds = [...new Set(template.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []))];
    const verified = prepareInitialHtmlEditingRevision({ authoritativeAnchor: PREFLIGHT_ANCHOR, sourceHtml,
      encodedTrustedTemplate: JSON.stringify(template), grantedAssetIds: assetIds,
      imageSources: new Map(assetIds.map(id => [id, `conformance-media/${id}`])) });
    return { slideId: selectedSlides[position]!.slide.id, index: instance?.slideIndex ?? slide.index, label: slide.label, classes: slide.classes,
      html: sourceHtml, template, usedAssetIds: verified.compiled.usedAssetIds };
  });
  // Expiring signed URLs are not durable font identities. The importing host
  // must resolve the declared registry ID/family under current authorization.
  const selectedFont = deck.designSystem.font;
  const fontRequirements = selectedFont ? [{ family: selectedFont.family, source: selectedFont.source,
    ...(selectedFont.fontAssetId ? { fontAssetId: selectedFont.fontAssetId } : {}),
    ...(selectedFont.googleNativePin ? { googleNativePin: selectedFont.googleNativePin } : {}) }] : [];
  return { format: COURSE_DECK_EDITORIAL_VERSION, sourceSpecSha256: digest(JSON.stringify(deck)), appearance: deck.appearance,
    width: deck.width, height: deck.height, fragments, fontRequirements, readOnlyFields,
    presentationDifferences: ["NATIVE_TIMELINE_OWNS_MOTION", "NO_BACKDROP_FILTERS_SHADOWS_OR_CSS_TRANSFORMS"] as const,
    preparation: "COMPILER_VALIDATED" as const,
    activation: "REQUIRES_AUTHORIZED_DRAFT_REGISTRATION" as const };
}

export type CourseDeckEditableArtifact = ReturnType<typeof buildCourseDeckEditableArtifact>;
