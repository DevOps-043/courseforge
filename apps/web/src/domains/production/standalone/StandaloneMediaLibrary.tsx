"use client";

import { useRef, useState } from "react";
import { uploadWithSignedUrl } from "@/lib/storage-upload";
import { HYPERFRAMES_PRIVATE_SOURCE_BUCKET } from "../media-storage.config";
import { STANDALONE_HTML_MAX_BYTES, STANDALONE_MEDIA_MAX_BYTES, STANDALONE_MEDIA_MIME, standaloneMediaInputSchema, standaloneMediaPath, type StandaloneMediaSummary } from "./standalone-media.types";

export function StandaloneMediaLibrary({ componentId, assets, hasHtmlDeck, onChanged }: {
  componentId: string;
  assets: StandaloneMediaSummary[];
  hasHtmlDeck: boolean;
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [errors, setErrors] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  async function uploadFiles(files: File[]) {
    if (busy) return;
    setBusy(true); setErrors([]);
    try {
      // Bounded concurrency avoids competing uploads and overlapping deck writes.
      for (const file of files) {
        try {
          setProgress(`Preparando ${file.name}`);
          const extension = file.name.split(".").pop()?.toLowerCase();
          const parsed = standaloneMediaInputSchema.safeParse({ componentId, assetId: crypto.randomUUID(), fileName: file.name, extension });
          if (!parsed.success) throw new Error("Formato no admitido. Usa PNG, JPG, MP4, WebM, MP3, WAV o HTML.");
          if (!file.size || file.size > STANDALONE_MEDIA_MAX_BYTES) throw new Error("El archivo debe pesar entre 1 byte y 100 MiB.");
          const upload = parsed.data;
          if (STANDALONE_MEDIA_MIME[upload.extension] === "text/html" && file.size > STANDALONE_HTML_MAX_BYTES) {
            throw new Error("El HTML supera el límite de 650 KB.");
          }
          await uploadWithSignedUrl(HYPERFRAMES_PRIVATE_SOURCE_BUCKET, standaloneMediaPath(upload), file, {
            componentId, contentType: STANDALONE_MEDIA_MIME[upload.extension], upsert: false, deliveryMode: "server-only",
            onProgress: (sent, total) => setProgress(`${file.name} · ${Math.round(sent / total * 100)}%`),
          });
          setProgress(`Verificando ${file.name}`);
          await postJson("/api/production/standalone/media", upload);
        } catch (error) {
          setErrors((current) => [...current, `${file.name}: ${error instanceof Error ? error.message : "No se pudo importar."}`]);
        }
      }
      await onChanged();
    } catch {
      setErrors((current) => [...current, "No se pudo actualizar la biblioteca. Recarga el proyecto."]);
    } finally { setBusy(false); setProgress(""); if (inputRef.current) inputRef.current.value = ""; }
  }

  return <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
    <div><h3 className="font-semibold">Archivos del proyecto</h3>
      <p className="text-sm text-slate-500">Sube imágenes, videos, audios o diapositivas HTML. Los archivos quedan en la biblioteca; tú eliges cuáles añadir al timeline.</p></div>
    <label className="block text-sm font-medium">Añadir archivos
      <input ref={inputRef} type="file" multiple disabled={busy} accept=".png,.jpg,.jpeg,.mp4,.webm,.mp3,.wav,.html,.htm"
        className="mt-2 block w-full text-sm" onChange={(event) => void uploadFiles(Array.from(event.target.files || []))} />
    </label>
    <p className="text-xs text-slate-500">Imágenes/audio: hasta 50 MiB. Video: hasta 100 MiB. Lado mayor: 1920 px. HTML: hasta 650 KB por archivo.</p>
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {errors.length > 0 && <ul role="alert" className="space-y-1 text-sm text-red-600">{errors.map((error, index) => <li key={index}>{error}</li>)}</ul>}
    <ul className="divide-y divide-slate-100 dark:divide-white/10">
      {assets.map((asset) => <li key={asset.id} className="flex items-center justify-between gap-3 py-2 text-sm"><span className="truncate">{asset.name}</span><span className="shrink-0 text-xs text-slate-500">{asset.mimeType} {asset.durationSeconds ? `· ${asset.durationSeconds.toFixed(1)} s` : ""}</span></li>)}
      {hasHtmlDeck && <li className="py-2 text-sm">Diapositivas · HTML</li>}
    </ul>
  </section>;
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "No se pudo importar el archivo.");
}
