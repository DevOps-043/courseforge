"use client";

import { useState } from "react";

interface DownloadableAsset {
  assetId: string;
  assetType: string;
  fileName: string;
  fileSizeBytes: number | null;
  mimeType: string;
  provider: string;
}

interface MaterialDownloadsPanelProps {
  componentId: string;
}

/** On-demand catalogue keeps signed delivery URLs out of React state and logs. */
export function MaterialDownloadsPanel({ componentId }: MaterialDownloadsPanelProps) {
  const [assets, setAssets] = useState<DownloadableAsset[]>([]);
  const [contentExportUrl, setContentExportUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);

  async function openCatalogue() {
    setIsOpen(true);
    if (contentExportUrl || isLoading) return;
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/materials/components/${encodeURIComponent(componentId)}/downloads`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !body.success) throw new Error(body.message || "No se pudieron cargar las descargas.");
      setAssets(body.data.assets || []);
      setContentExportUrl(body.data.contentExportUrl || null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las descargas.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-900/40">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 dark:text-slate-100">Descargas y edición externa</h4>
          <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">Exporta el contenido editable o descarga los archivos de producción disponibles para este componente.</p>
        </div>
        <button className="rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60 dark:bg-slate-100 dark:text-slate-900" disabled={isLoading} onClick={() => void openCatalogue()} type="button">
          {isLoading ? "Cargando…" : isOpen ? "Actualizar descargas" : "Ver descargas"}
        </button>
      </div>
      {isOpen && (
        <div className="mt-4 space-y-2">
          {contentExportUrl && <div className="flex flex-wrap gap-2"><a className="inline-flex rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300" href={contentExportUrl}>Contenido editable (JSON)</a><a className="inline-flex rounded-md border border-indigo-300 px-3 py-2 text-sm font-medium text-indigo-700 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-300" href={`${contentExportUrl}?format=zip`}>Paquete con manifiesto (ZIP)</a></div>}
          {assets.map((asset) => (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 text-sm dark:bg-slate-800" key={asset.assetId}>
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800 dark:text-slate-100">{asset.fileName}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">{asset.assetType} · {asset.provider} · {formatFileSize(asset.fileSizeBytes)}</p>
              </div>
              <a className="rounded-md border border-slate-300 px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-600 dark:text-slate-200" href={`/api/production/assets/${asset.assetId}/download`}>Descargar</a>
            </div>
          ))}
          {!isLoading && assets.length === 0 && contentExportUrl && <p className="text-xs text-slate-500 dark:text-slate-400">No hay archivos binarios registrados todavía; el contenido editorial sí puede exportarse.</p>}
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>
      )}
    </section>
  );
}

function formatFileSize(bytes: number | null) {
  if (!bytes || bytes < 0) return "tamaño no disponible";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
