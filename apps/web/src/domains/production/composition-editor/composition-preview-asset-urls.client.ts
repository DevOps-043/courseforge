import { getCompositionClipMediaAssetId, type CompositionEditorDocument } from "./composition-document.types";

const ASSET_URL_CACHE_TTL_MS = 45 * 60 * 1_000;
const ASSET_URL_REQUEST_TIMEOUT_MS = 10_000;
const ASSET_URL_REQUEST_CONCURRENCY = 6;
const MAX_CACHED_ASSET_URLS = 500;

/** Resolves only newly introduced media outside the opaque-origin preview sandbox. */
export class CompositionPreviewAssetUrlCache {
  private readonly entries = new Map<string, { expiresAt: number; url: string }>();

  async resolveNewAssets(params: {
    assets: Array<{ id: string; previewUrl: string | null }>;
    beforeDocument: CompositionEditorDocument;
    document: CompositionEditorDocument;
    fetcher?: typeof fetch;
  }): Promise<Map<string, string>> {
    const knownIds = new Set(params.beforeDocument.clips.map(getCompositionClipMediaAssetId).filter(Boolean));
    const requiredIds = [...new Set(params.document.clips.map(getCompositionClipMediaAssetId)
      .filter((id): id is string => Boolean(id) && !knownIds.has(id)))];
    const urls = new Map<string, string>();
    for (const [id, entry] of this.entries) if (entry.expiresAt <= Date.now()) this.entries.delete(id);
    for (let offset = 0; offset < requiredIds.length; offset += ASSET_URL_REQUEST_CONCURRENCY) {
      await Promise.all(requiredIds.slice(offset, offset + ASSET_URL_REQUEST_CONCURRENCY).map(async (id) => {
        const cached = this.entries.get(id);
        if (cached && cached.expiresAt > Date.now()) { urls.set(id, cached.url); return; }
        const source = params.assets.find((asset) => asset.id === id)?.previewUrl;
        if (!source) throw new Error("El nuevo asset no tiene una URL de preview disponible.");
        // HEAD follows the authorized redirect without downloading the video.
        const response = await (params.fetcher || fetch)(source, {
          method: "HEAD",
          signal: AbortSignal.timeout(ASSET_URL_REQUEST_TIMEOUT_MS),
        });
        if (!response.ok || !/^https?:\/\//i.test(response.url)) throw new Error("No se pudo preparar el nuevo asset para el preview.");
        if (this.entries.size >= MAX_CACHED_ASSET_URLS) this.entries.delete(this.entries.keys().next().value!);
        this.entries.set(id, { expiresAt: Date.now() + ASSET_URL_CACHE_TTL_MS, url: response.url });
        urls.set(id, response.url);
      }));
    }
    return urls;
  }
}
