"use client";

import { useCallback, useEffect, useState } from "react";
import { Film, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { inspectLocalVideoFile } from "@/domains/materials/media/video-file-metadata.client";

type Kind = "INTRO" | "OUTRO";
type Asset = { created_at: string; duration_milliseconds: number; file_size_bytes: number; id: string; kind: Kind; mime_type: string; name: string; status: string };
type Settings = { default_intro_asset_id: string | null; default_outro_asset_id: string | null } | null;

export function AssemblyBrandingCard() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [settings, setSettings] = useState<Settings>(null);
  const [busy, setBusy] = useState<Kind | "LOAD" | null>("LOAD");
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/production/assembly-branding", { cache: "no-store" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setAssets(body.data.assets); setSettings(body.data.settings);
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
      await select(kind, body.data.id, false); await load();
      toast.success(`${kind === "INTRO" ? "Intro" : "Outro"} subido y seleccionado.`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo subir el video."); }
    finally { setBusy(null); }
  }

  async function select(kind: Kind, assetId: string | null, notify = true) {
    setBusy(kind);
    try {
      const response = await fetch("/api/production/assembly-branding", { body: JSON.stringify({ assetId, kind }), headers: { "Content-Type": "application/json" }, method: "PUT" });
      const body = await response.json(); if (!response.ok) throw new Error(body.error);
      setSettings((current) => ({ default_intro_asset_id: kind === "INTRO" ? assetId : current?.default_intro_asset_id || null, default_outro_asset_id: kind === "OUTRO" ? assetId : current?.default_outro_asset_id || null }));
      if (notify) toast.success("Configuración de ensamble actualizada.");
    } catch (error) {
      if (notify) toast.error(error instanceof Error ? error.message : "No se pudo guardar la selección.");
      throw error;
    } finally { setBusy(null); }
  }

  return <section className="engine-integration-row">
    <div className="engine-integration-row__main"><div className="flex items-start gap-4"><div className="flex h-12 w-12 items-center justify-center rounded-xl bg-cyan-500/10 text-cyan-600"><Film size={24} /></div><div><h2 className="text-lg font-bold text-gray-900 dark:text-white">Identidad de ensamble</h2><p className="mt-1 max-w-xl text-sm text-gray-600 dark:text-slate-400">Videos corporativos que se colocarán al inicio y al cierre del ensamble.</p></div></div></div>
    <div className="engine-integration-row__details grid gap-4 lg:grid-cols-2">{(["INTRO", "OUTRO"] as const).map((kind) => {
      const selected = kind === "INTRO" ? settings?.default_intro_asset_id : settings?.default_outro_asset_id;
      const options = assets.filter((asset) => asset.kind === kind && asset.status === "APPROVED");
      return <div key={kind} className="rounded-xl border border-gray-200 p-4 dark:border-white/10"><div className="mb-3 flex items-center justify-between"><strong>{kind === "INTRO" ? "Intro predeterminado" : "Outro predeterminado"}</strong>{busy === kind ? <Loader2 className="animate-spin" size={16} /> : null}</div><select value={selected || ""} disabled={Boolean(busy)} onChange={(event) => void select(kind, event.target.value || null)} className="h-10 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm dark:border-white/10 dark:bg-[var(--engine-canvas)]"><option value="">Sin {kind.toLowerCase()}</option>{options.map((asset) => <option key={asset.id} value={asset.id}>{asset.name} · {(asset.duration_milliseconds / 1000).toFixed(1)} s</option>)}</select><label className="engine-button engine-button--secondary mt-3 inline-flex cursor-pointer"><Upload size={16} /> Subir {kind.toLowerCase()}<input className="sr-only" type="file" accept="video/mp4,video/webm" disabled={Boolean(busy)} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(kind, file); event.currentTarget.value = ""; }} /></label></div>;
    })}</div>
  </section>;
}
