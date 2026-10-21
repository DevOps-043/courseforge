import type { CheerioAPI } from "cheerio";
import postcss from "postcss";
import { HTML_SLIDE_IMPORT_LIMITS, HtmlSlideImportError } from "./imported-slide-design.contract";

/** Fija posiciones originales antes de insertar elementos para los campos de texto. */
export function materializeImportedPositionalCss(document: CheerioAPI, css: string): string {
  const stylesheet = postcss.parse(css);
  const markers = new Map<string, string>();
  stylesheet.walkRules(rule => {
    let quote = "", brackets = 0;
    const structuralPositions = new Set<number>();
    for (let index = 0; index < rule.selector.length; index++) {
      const character = rule.selector[index];
      if (quote) { if (character === quote) quote = ""; continue; }
      if (character === '"' || character === "'") { quote = character; continue; }
      if (character === "[") brackets++;
      else if (character === "]") brackets--;
      else if (!brackets && character === ":") structuralPositions.add(index);
    }
    rule.selector = rule.selector.replace(/:(?:(?:first|last|only)-(?:child|of-type)|nth-(?:last-)?(?:child|of-type)\([^()]*\))(?![\w-])/gi, (pseudo, offset: number) => {
      if (!structuralPositions.has(offset)) return pseudo;
      let marker = markers.get(pseudo);
      if (!marker) {
        if (markers.size >= HTML_SLIDE_IMPORT_LIMITS.positionalSelectors) throw new HtmlSlideImportError("El CSS contiene demasiadas condiciones de posición.");
        const expression = /\(([^()]*)\)/.exec(pseudo)?.[1];
        if (expression && !/^(?:odd|even|[+-]?\d+|[+-]?\d*n(?:[+-]\d+)?)$/i.test(expression.replace(/\s/g, ""))) {
          throw new HtmlSlideImportError("Una condición de posición CSS no es compatible con campos editables.");
        }
        marker = `cf-source-position-${markers.size + 1}`;
        document(pseudo).addClass(marker);
        markers.set(pseudo, marker);
      }
      return `.${marker}`;
    });
  });
  return stylesheet.toString();
}
