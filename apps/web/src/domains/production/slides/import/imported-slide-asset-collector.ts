import { IMPORTED_SLIDE_ASSET_LIMITS, importedSlideAssetSchema, type ImportedSlideAsset } from "./imported-slide-assets.contract";

/** Deduplicación local; el servidor valida los binarios antes de admitirlos. */
export function createImportedSlideAssetCollector() {
  const bySource = new Map<string, ImportedSlideAsset>();
  let characters = 0;
  return {
    register(source: string): string | null {
      if (!source.startsWith("data:")) return null;
      const existing = bySource.get(source);
      if (existing) return `cf-asset:${existing.id}`;
      const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=]+)$/.exec(source);
      if (!match) throw new Error("Un recurso embebido no usa un formato base64 compatible.");
      characters += match[2].length;
      if (characters > IMPORTED_SLIDE_ASSET_LIMITS.encodedCharacters || bySource.size >= IMPORTED_SLIDE_ASSET_LIMITS.count) {
        throw new Error("Los recursos únicos superan 3 MB. Optimiza imágenes o fuentes antes de importar; no se han descartado recursos.");
      }
      const parsed = importedSlideAssetSchema.safeParse({ id: `asset-${bySource.size + 1}`, mimeType: match[1], base64: match[2] });
      if (!parsed.success) throw new Error("La imagen o fuente embebida no tiene un formato admitido.");
      bySource.set(source, parsed.data);
      return `cf-asset:${parsed.data.id}`;
    },
    assets: () => [...bySource.values()],
  };
}
