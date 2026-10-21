import valueParser from "postcss-value-parser";
import type { ImportedSlideAsset } from "./imported-slide-assets.contract";

/** Sustituye únicamente URLs cf-asset canónicas; nunca resuelve URLs de red. */
export function materializeImportedAssetCss(css: string, assets?: ImportedSlideAsset[], resolve?: (asset: ImportedSlideAsset) => string) {
  const resources = assets ?? [];
  const sourceFor = (asset: ImportedSlideAsset) => resolve ? resolve(asset) : asset.base64 ? `data:${asset.mimeType};base64,${asset.base64}` : "";
  const byId = new Map(resources.map(asset => [asset.id, asset]));
  const replaced = css.replace(/url\(\s*["']?cf-asset:(asset-[1-9][0-9]*)["']?\s*\)/g, (_url, id: string) => {
    const asset = byId.get(id);
    const source = asset ? sourceFor(asset) : "";
    return source ? `url("${source}")` : "none";
  });
  // Una única imagen CSS por recurso evita repetir base64 en cada diapositiva.
  return (assets ? `:where(.cf-import-root a){text-decoration:underline}\n` : "") + replaced + resources.filter(asset => asset.mimeType.startsWith("image/")).map(asset => {
    const source = sourceFor(asset);
    return source ? `\n.cf-import-root img[data-cf-resource="${asset.id}"]{content:url("${source}")}` : "";
  }).join("");
}

export function hydrateImportedPreview(html: string, assets: ImportedSlideAsset[] = []) {
  return html.replace("</style>", `${materializeImportedAssetCss("", assets)}</style>`)
    .replace(/url\(\s*["']?cf-asset:(asset-[1-9][0-9]*)["']?\s*\)/g, (_url, id: string) => {
      const asset = assets.find(candidate => candidate.id === id);
      return asset?.base64 ? `url("data:${asset.mimeType};base64,${asset.base64}")` : "none";
    });
}

export function importedCssResourceFallback(property: string, value: string): string | null {
  if (!["background", "background-image"].includes(property.toLowerCase())) return null;
  const ranges: Array<{ start: number; end: number }> = [];
  valueParser(value).walk(node => {
    if (node.type === "function" && /^(?:url|image|image-set|cross-fade|src|paint|element)$/i.test(node.value)) {
      ranges.push({ start: node.sourceIndex, end: node.sourceEndIndex }); return false;
    }
  });
  let result = value;
  for (const range of ranges.reverse()) result = result.slice(0, range.start) + "none" + result.slice(range.end);
  return ranges.length ? result : null;
}
