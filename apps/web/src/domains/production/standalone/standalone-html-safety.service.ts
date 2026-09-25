import sanitizeHtml from "sanitize-html";
import { load } from "cheerio";
import postcss from "postcss";

const LOCAL_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i;
const LOCAL_FRAGMENT = /^#[a-zA-Z_][\w-]*$/;

/** Uploaded decks are visual documents, without navigation or executable SVG. */
export function sanitizeStandaloneSlide(html: string) {
  const cleaned = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img", "svg", "g", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon",
      "text", "tspan", "defs", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "use",
    ]),
    allowedAttributes: {
      "*": ["id", "class", "style", "aria-label", "role"],
      img: ["src", "alt", "width", "height"],
      svg: ["viewBox", "width", "height", "xmlns"],
      g: ["transform", "fill", "stroke", "clip-path", "mask"],
      path: ["d", "fill", "stroke", "stroke-width", "transform"],
      rect: ["x", "y", "width", "height", "rx", "ry", "fill", "stroke"],
      circle: ["cx", "cy", "r", "fill", "stroke"],
      ellipse: ["cx", "cy", "rx", "ry", "fill", "stroke"],
      line: ["x1", "x2", "y1", "y2", "stroke", "stroke-width"],
      polyline: ["points", "fill", "stroke"], polygon: ["points", "fill", "stroke"],
      text: ["x", "y", "fill", "font-size", "text-anchor"], tspan: ["x", "y", "dx", "dy"],
      linearGradient: ["x1", "x2", "y1", "y2", "gradientUnits"],
      radialGradient: ["cx", "cy", "r", "gradientUnits"], stop: ["offset", "stop-color", "stop-opacity"],
      clipPath: ["clipPathUnits"], mask: ["x", "y", "width", "height"], use: ["href", "x", "y"],
    },
    allowedSchemes: ["data"], allowProtocolRelative: false,
    parser: { lowerCaseTags: false, lowerCaseAttributeNames: false },
  });
  const fragment = load(cleaned, { xml: true }, false);
  fragment("*").each((_index, element) => {
    for (const [name, value] of Object.entries(fragment(element).attr() || {})) {
      if (name === "src" && !LOCAL_IMAGE.test(value)) throw new Error("Solo se admiten imágenes incrustadas en HTML.");
      if (name === "href" && !LOCAL_FRAGMENT.test(value)) throw new Error("Referencia SVG no local.");
      if (name === "style") validateStandaloneCss(`.slide {${value}}`);
      if (["fill", "stroke", "clip-path", "mask"].includes(name)) validateCssValue(value);
    }
  });
  return fragment.html();
}

function validateCssValue(value: string) {
  // Reject escapes before URL inspection so encoded function names cannot bypass it.
  if (/[\\<>]|expression\s*\(|(?:https?:|\/\/)/i.test(value)) throw new Error("Valor CSS no compatible.");
  for (const match of value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) {
    if (!LOCAL_FRAGMENT.test(match[2]) && !LOCAL_IMAGE.test(match[2])) throw new Error("Recurso CSS no local.");
  }
}

export function validateStandaloneCss(css: string) {
  const root = postcss.parse(css);
  root.walkDecls((declaration) => {
    if (/behavior|binding/i.test(declaration.prop)) throw new Error("Propiedad CSS no compatible.");
    validateCssValue(declaration.value);
  });
  root.walkAtRules("import", (rule) => {
    const url = rule.params.match(/^url\(["'](https:\/\/fonts\.googleapis\.com\/[^"']+)["']\)$/)?.[1];
    if (!url || new URL(url).hostname !== "fonts.googleapis.com") throw new Error("Fuente externa no admitida.");
  });
}
