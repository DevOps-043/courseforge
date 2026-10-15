import type { CompositionCompiledFont } from "../fonts/organization-font.types";
import { CompositionFontAssetError } from "./composition-font-assets.service";
import { COMPOSITION_FONT_REFERENCE_LIMIT } from "./composition-font-references";
export const COMPOSITION_PREVIEW_CSP_POLICY = Object.freeze({ maximumHeaderBytes: 12 * 1024 });

/** Legacy/native preview only. Editable documents retain their isolated resource channel and strict CSP. */
export function buildCompositionPreviewCsp(fontAssets: ReadonlyMap<string, CompositionCompiledFont>, storageOrigin?: string) {
  const fontSources = new Set<string>(["https://fonts.gstatic.com", "data:"]);
  try {
    if (fontAssets.size > COMPOSITION_FONT_REFERENCE_LIMIT) throw new Error();
    if (fontAssets.size) {
      const storage = new URL(storageOrigin ?? "");
      if (storage.protocol !== "https:" || storage.username || storage.password || storage.search || storage.hash
        || storage.pathname !== "/" || storage.port && storage.port !== "443") throw new Error();
      for (const font of fontAssets.values()) {
        const url = new URL(font.sourceUrl);
        if (url.origin !== storage.origin || url.username || url.password || url.hash
          || !/^\/storage\/v1\/object\/sign\/organization-fonts\/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+$/.test(url.pathname)
          || url.searchParams.getAll("token").length !== 1 || !url.searchParams.get("token")) throw new Error();
        // CSP matches paths independently of signed query parameters. Never put tokens in headers/logs.
        fontSources.add(`${url.origin}${url.pathname}`);
      }
    }
  } catch { throw new CompositionFontAssetError("No se pudo autorizar la carga de las fuentes del preview."); }
  const policy = ["default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline' https://fonts.googleapis.com",
    `font-src ${[...fontSources].join(" ")}`, "img-src https: data:", "media-src 'self' https: blob:",
    "connect-src 'none'", "base-uri 'none'", "form-action 'none'"].join("; ");
  if (Buffer.byteLength(policy) > COMPOSITION_PREVIEW_CSP_POLICY.maximumHeaderBytes)
    throw new CompositionFontAssetError("La política de fuentes del preview excede el límite permitido.");
  return policy;
}
