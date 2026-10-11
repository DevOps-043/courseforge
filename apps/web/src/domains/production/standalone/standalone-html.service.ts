import postcss from "postcss";
import { load } from "cheerio";
import { sanitizeStandaloneSlide, validateStandaloneCss } from "./standalone-html-safety.service";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareAnimatedDeckForRemotion } from "../validation/animated-deck-preprocessor.service";
import { hyperframesAnimatedDeckSourceSchema, type HyperframesAnimatedDeckSource } from "../hyperframes/hyperframes.types";

/** Freeze validated, deterministic HTML; uploaded scripts never enter the document. */
export function prepareStandaloneHtml(html: string): HyperframesAnimatedDeckSource {
  const prepared = prepareAnimatedDeckForRemotion(html);
  validateStandaloneCss(prepared.css);
  return hyperframesAnimatedDeckSourceSchema.parse({
    appearance: prepared.deck.appearance, width: prepared.deck.width, height: prepared.deck.height,
    slides: prepared.deck.slides.map((slide) => ({ ...slide, html: sanitizeStandaloneSlide(slide.html) })),
    css: prepared.css, fonts: prepared.fonts,
  });
}

export function combineStandaloneHtmlDecks(
  legacy: HyperframesAnimatedDeckSource | null,
  assets: Array<{ id: string; deck: HyperframesAnimatedDeckSource }>,
): HyperframesAnimatedDeckSource | null {
  if (!assets.length) return legacy;
  const slides = [...(legacy?.slides || [])];
  const legacyCss = postcss.parse(legacy?.css || "");
  legacyCss.walkRules((rule) => {
    // Already scoped assets may be passed back when validating aggregate limits.
    rule.selector = rule.selector.replace(/\.deck-scope\b(?!\[data-html-asset)/g, '.deck-scope:not([data-html-asset])');
  });
  const styles = [legacyCss.toString()];
  const fonts = new Map((legacy?.fonts || []).map((font) => [font.href, font]));
  for (const asset of assets) {
    const scope = `[data-html-asset="${asset.id}"]`;
    const prefix = `html-${asset.id}-`;
    const css = postcss.parse(asset.deck.css);
    const identifiers = new Map<string, string>();
    const fragments = asset.deck.slides.map((slide) => load(slide.html, { xml: true }, false));
    for (const fragment of fragments) fragment("[id]").each((_index, element) => {
      const id = fragment(element).attr("id")!;
      if (!/^[a-zA-Z_][\w-]*$/.test(id)) throw new Error("Identificador HTML no compatible.");
      identifiers.set(id, `${prefix}${id}`);
      fragment(element).attr("id", `${prefix}${id}`);
    });
    const renameReferences = (value: string) => value.replace(/url\(\s*(['"]?)#([\w-]+)\1\s*\)/g,
      (match, quote: string, id: string) => identifiers.has(id) ? `url(${quote}#${identifiers.get(id)}${quote})` : match);
    for (const fragment of fragments) fragment("*").each((_index, element) => {
      for (const [name, value] of Object.entries(fragment(element).attr() || {})) {
        if (name === "href" && identifiers.has(value.slice(1))) fragment(element).attr(name, `#${identifiers.get(value.slice(1))}`);
        else fragment(element).attr(name, renameReferences(value));
      }
    });
    const animations = new Map<string, string>();
    css.walkAtRules((rule) => {
      if (/keyframes$/i.test(rule.name)) {
        if (!/^[a-zA-Z_][\w-]*$/.test(rule.params)) throw new Error("Nombre de animación HTML no compatible.");
        animations.set(rule.params, `${prefix}${rule.params}`);
        rule.params = `${prefix}${rule.params}`;
      } else if (!["media", "supports", "import"].includes(rule.name.toLowerCase())) {
        throw new Error(`La regla CSS @${rule.name} no está admitida en archivos HTML independientes.`);
      }
    });
    const renameAnimations = (value: string) => value.replace(/[a-zA-Z_][\w-]*/g, (name) => animations.get(name) || name);
    css.walkRules((rule) => {
      if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
      rule.selector = rule.selector.replace(/\.deck-scope\b/g, `.deck-scope${scope}`);
      rule.selector = rule.selector.replace(/#([a-zA-Z_][\w-]*)/g, (match, id: string) => identifiers.has(id) ? `#${identifiers.get(id)}` : match);
    });
    css.walkDecls((declaration) => {
      if (/^(?:-webkit-)?animation(?:-name)?$/i.test(declaration.prop)) declaration.value = renameAnimations(declaration.value);
      declaration.value = renameReferences(declaration.value);
    });
    styles.push(css.toString());
    asset.deck.fonts.forEach((font) => fonts.set(font.href, font));
    for (const [position, slide] of asset.deck.slides.entries()) slides.push({
      ...slide,
      index: slides.length,
      htmlAssetId: asset.id,
      sourceSlideIndex: slide.index,
      sourceWidth: asset.deck.width,
      sourceHeight: asset.deck.height,
      appearance: asset.deck.appearance,
      // Distinct identity even when two uploaded files have identical markup.
      classes: `${slide.classes} ${prefix}slide`,
      html: fragments[position].html().replace(/\bstyle=("[^"]*"|'[^']*')/gi, (attribute) =>
        attribute.replace(/((?:-webkit-)?animation(?:-name)?\s*:\s*)([^;"']+)/gi,
          (_match, property: string, value: string) => property + renameAnimations(value))),
    });
  }
  return hyperframesAnimatedDeckSourceSchema.parse({
    appearance: legacy?.appearance || "light", width: legacy?.width || assets[0].deck.width,
    height: legacy?.height || assets[0].deck.height, css: styles.join("\n"), fonts: [...fonts.values()], slides,
  });
}

export async function loadStandaloneHtmlDecks(params: {
  componentId: string; organizationId: string; supabase: SupabaseClient;
  legacy: HyperframesAnimatedDeckSource | null;
}) {
  const { data: assets, error } = await params.supabase.from("production_assets")
    .select("id, content").eq("organization_id", params.organizationId)
    .eq("material_component_id", params.componentId).eq("mime_type", "text/html")
    .contains("metadata", { standalone_media: true }).neq("qa_status", "ARCHIVED")
    .order("created_at", { ascending: true }).order("id", { ascending: true });
  if (error) throw error;
  return combineStandaloneHtmlDecks(params.legacy, (assets || []).map((asset) => ({
    id: asset.id, deck: hyperframesAnimatedDeckSourceSchema.parse(asset.content?.deck),
  })));
}
