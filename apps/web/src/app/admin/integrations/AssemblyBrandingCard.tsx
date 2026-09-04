"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { inspectLocalVideoFile } from "@/domains/materials/media/video-file-metadata.client";

type Kind = "OUTRO";
type Asset = { created_at: string; duration_milliseconds: number; file_size_bytes: number; id: string; kind: Kind; mime_type: string; name: string; status: string };

export function AssemblyBrandingCard() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [busy, setBusy] = useState<Kind | "LOAD" | null>("LOAD");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/production/assembly-branding", { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setAssets((body.data.assets as Asset[]).filter((asset) => asset.kind === "OUTRO"));
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo cargar la identidad de ensamble."); }
    finally { setBusy(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function upload(kind: Kind, file: File) {
    setBusy(kind);
    try {
      const metadata = await inspectLocalVideoFile(file);
      if (metadata.duration <= 0) throw new Error("No se pudo medir la duración del video.");
      const form = new FormData(); form.set("kind", kind); form.set("file", file);
      const response = await fetch("/api/production/assembly-branding", { body: form, method: "POST" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      await load();
      toast.success("Outro subido a la biblioteca corporativa.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo subir el video."); }
    finally { setBusy(null); }
  }

  return <section className="engine-integration-row">
    <div className="engine-integration-row__main"><div className="flex items-start gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600"><Film size={24} /></div><div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Outros corporativos</h2><p className="mt-1 max-w-xl text-sm text-gray-600 dark:text-slate-400">Biblioteca reutilizable. Cada video elige su outro desde el editor; las intros pertenecen a los assets de Producción de cada video.</p></div></div></div>
    <div className="engine-integration-row__details"><div className="rounded-xl border border-gray-200 p-4 dark:border-white/10"><div className="mb-3 flex items-center justify-between"><strong>Biblioteca de outros</strong>{busy === "OUTRO" ? <Loader2 className="animate-spin" size={16} /> : null}</div><div className="max-h-32 space-y-1 overflow-auto text-sm text-gray-600 dark:text-slate-300">{assets.filter((asset) => asset.status === "APPROVED").length === 0 ? <p>Sin outros disponibles.</p> : assets.filter((asset) => asset.status === "APPROVED").map((asset) => <p key={asset.id}>{asset.name} · {(asset.duration_milliseconds / 1000).toFixed(1)} s</p>)}</div><p className="mt-2 text-xs text-gray-500 dark:text-slate-400">La elección operativa se realiza por video en el editor.</p><label className="engine-button engine-button--secondary mt-3 inline-flex cursor-pointer"><Upload size={16} /> Subir outro<input className="sr-only" type="file" accept="video/mp4,video/webm" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload("OUTRO", file); event.currentTarget.value = ""; }} /></label></div></div>
  </section>;
}
