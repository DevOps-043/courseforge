import postcss from "postcss";

/** Explicit static export of OUR renderer's CSS, never admission/sanitization of
 * uploaded HTML. Presentation navigation and autonomous motion are not part of
 * an editable fragment; the native timeline owns motion. The compiler still
 * independently rejects unsupported CSS after this production step. */
export function produceCourseDeckEditorialCss(rendererCss: string): string {
  const stylesheet = postcss.parse(rendererCss);
  const typeTokens = new Map<string, string>();
  stylesheet.walkDecls(/^--type-/, declaration => { typeTokens.set(declaration.prop, declaration.value); });
  stylesheet.walkAtRules(rule => {
    if (/keyframes$/i.test(rule.name) || rule.name.toLowerCase() === "media" && rule.params === "print") rule.remove();
  });
  stylesheet.walkRules(rule => {
    if (rule.selector.split(",").some(selector => /:(?:hover|active|focus(?:-visible|-within)?|visited|target|checked)\b/i.test(selector))
      || /\.deck-(?:counter|hint|count)\b/.test(rule.selector)) rule.remove();
  });
  stylesheet.walkDecls(declaration => {
    if (/^(?:-(?:webkit|moz|o)-)?(?:animation|transition)(?:-|$)/i.test(declaration.prop)) declaration.remove();
    if (declaration.prop === "position" && declaration.value === "fixed") declaration.value = "absolute";
    if (["box-shadow", "text-shadow", "backdrop-filter", "transform", "filter"].includes(declaration.prop)) declaration.value = "none";
    if (declaration.prop === "font-size") {
      const token = /^var\((--type-[a-z-]+)\)$/.exec(declaration.value);
      if (token && typeTokens.has(token[1])) declaration.value = typeTokens.get(token[1])!;
    }
    // Bounded width remains a literal; color functions cannot hide geometry.
    if (/^border(?:-(?:top|right|bottom|left))?$/.test(declaration.prop)) {
      const border = /^(\d+(?:\.\d+)?px)\s+(solid|dashed|dotted)\s+(.+)$/.exec(declaration.value);
      if (border) {
        declaration.cloneBefore({ prop: `${declaration.prop}-width`, value: border[1] });
        declaration.cloneBefore({ prop: `${declaration.prop}-style`, value: border[2] });
        declaration.cloneBefore({ prop: `${declaration.prop}-color`, value: border[3] });
        declaration.remove();
      }
    }
  });
  // This is the authored final state of the presentation's marker, not a clock.
  stylesheet.append(postcss.parse(".anim-marker::after { width:104%; } .code { white-space:pre-wrap; }"));
  return stylesheet.toString();
}
