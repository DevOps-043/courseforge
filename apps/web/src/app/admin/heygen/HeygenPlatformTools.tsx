"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Loader2, Play, RefreshCw, Save, Sparkles } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { readApiResponse } from "@/lib/client/api-response";

type ToolAction =
  | "translate_video" | "create_proofread" | "lipsync" | "ai_clipping"
  | "remove_fillers" | "design_voice" | "clone_voice" | "create_glossary"
  | "create_brand_kit" | "generate_template" | "video_agent" | "video_batch";

interface Dashboard {
  account?: unknown;
  activeOperations?: number;
  assets?: Array<Record<string, unknown>>;
  brandKits?: Array<Record<string, unknown>>;
  glossaries?: Array<Record<string, unknown>>;
  languages?: Array<Record<string, unknown> | string>;
  maxConcurrentJobs?: number;
  operations?: Array<Record<string, unknown>>;
  providerAssets?: Array<Record<string, unknown>>;
  settings?: Record<string, unknown>;
  styles?: Array<Record<string, unknown>>;
  templates?: Array<Record<string, unknown>>;
}

const ACTIONS: Array<{ value: ToolAction; label: string; group: string }> = [
  { value: "translate_video", label: "Traducir video", group: "Localización" },
  { value: "create_proofread", label: "Proofread de traducción", group: "Localización" },
  { value: "lipsync", label: "Sincronizar labios", group: "Postproducción" },
  { value: "ai_clipping", label: "Crear clips con IA", group: "Postproducción" },
  { value: "remove_fillers", label: "Eliminar muletillas", group: "Postproducción" },
  { value: "design_voice", label: "Diseñar voz", group: "Voces y marca" },
  { value: "clone_voice", label: "Clonar voz", group: "Voces y marca" },
  { value: "create_glossary", label: "Crear glosario", group: "Voces y marca" },
  { value: "create_brand_kit", label: "Crear brand kit", group: "Voces y marca" },
  { value: "generate_template", label: "Generar desde plantilla", group: "Automatización" },
  { value: "video_agent", label: "Video Agent", group: "Automatización" },
  { value: "video_batch", label: "Lote de videos", group: "Automatización" },
];

export default function HeygenPlatformTools() {
  const componentId = useSearchParams().get("componentId") || undefined;
  const [connected, setConnected] = useState(false);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [action, setAction] = useState<ToolAction>("translate_video");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [title, setTitle] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [languages, setLanguages] = useState("es, en");
  const [durationSeconds, setDurationSeconds] = useState(60);
  const [mode, setMode] = useState<"speed" | "precision">("speed");
  const [audioOnly, setAudioOnly] = useState(false);
  const [resourceId, setResourceId] = useState("");
  const [jsonInput, setJsonInput] = useState("{}");
  const [monthlyBudget, setMonthlyBudget] = useState("");
  const [perCourseBudget, setPerCourseBudget] = useState("");
  const [defaultLocale, setDefaultLocale] = useState("es-MX");
  const [defaultGlossaryId, setDefaultGlossaryId] = useState("");
  const [defaultBrandKitId, setDefaultBrandKitId] = useState("");
  const [liveStatus, setLiveStatus] = useState<Record<string, unknown> | null>(null);
  const [liveApiKey, setLiveApiKey] = useState("");
  const [liveAvatarId, setLiveAvatarId] = useState("");
  const [liveContextId, setLiveContextId] = useState("");
  const [embedding, setEmbedding] = useState<Record<string, unknown> | null>(null);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const connectionResponse = await fetch("/api/production/heygen/connection", { cache: "no-store" });
      const connectionPayload = await readApiResponse(connectionResponse);
      const isConnected = Boolean(connectionPayload.data?.connected);
      setConnected(isConnected);
      if (!isConnected) { setDashboard(null); return; }
      const response = await fetch("/api/production/heygen/platform", { cache: "no-store" });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo cargar HeyGen.");
      const next = payload.data as Dashboard;
      setDashboard(next);
      setDefaultLocale(String(next.settings?.defaultLocale || "es-MX"));
      setDefaultGlossaryId(String(next.settings?.defaultBrandGlossaryId || ""));
      setDefaultBrandKitId(String(next.settings?.defaultBrandKitId || ""));
      const budget = next.settings?.monthlyBudgetUsd;
      setMonthlyBudget(typeof budget === "number" ? String(budget) : "");
      const courseBudget = next.settings?.perCourseBudgetUsd;
      setPerCourseBudget(typeof courseBudget === "number" ? String(courseBudget) : "");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar HeyGen.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadLiveAvatar = useCallback(async () => {
    try {
      const response = await fetch("/api/production/liveavatar", { cache: "no-store" });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo cargar LiveAvatar.");
      setLiveStatus(payload.data as Record<string, unknown>);
    } catch {
      setLiveStatus(null);
    }
  }, []);

  useEffect(() => { void loadDashboard(); void loadLiveAvatar(); }, [loadDashboard, loadLiveAvatar]);
  useEffect(() => {
    if (!connected || !dashboard?.activeOperations) return;
    const timer = window.setInterval(() => { void loadDashboard(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [connected, dashboard?.activeOperations, loadDashboard]);

  const submit = async () => {
    setBusy(true);
    try {
      const body = buildActionBody({
        action, audioOnly, audioUrl, durationSeconds, jsonInput, languages,
        mode, name, prompt, resourceId, title, videoUrl, componentId,
      });
      const response = await fetch("/api/production/heygen/platform", {
        body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method: "POST",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "HeyGen rechazó la operación.");
      toast.success("Operación enviada a HeyGen.");
      await loadDashboard();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar la operación.");
    } finally { setBusy(false); }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/production/heygen/platform", {
        body: JSON.stringify({
          defaultLocale,
          defaultBrandGlossaryId: defaultGlossaryId || null,
          defaultBrandKitId: defaultBrandKitId || null,
          monthlyBudgetUsd: monthlyBudget.trim() ? Number(monthlyBudget) : null,
          perCourseBudgetUsd: perCourseBudget.trim() ? Number(perCourseBudget) : null,
        }), headers: { "Content-Type": "application/json" }, method: "PATCH",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo guardar.");
      toast.success("Política de consumo guardada.");
      await loadDashboard();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  };

  const connectLiveAvatar = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/production/liveavatar", {
        body: JSON.stringify({ action: "connect", apiKey: liveApiKey }),
        headers: { "Content-Type": "application/json" }, method: "POST",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo conectar LiveAvatar.");
      setLiveApiKey(""); toast.success("LiveAvatar conectado."); await loadLiveAvatar();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo conectar."); }
    finally { setBusy(false); }
  };

  const createEmbedding = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/production/liveavatar", {
        body: JSON.stringify({ action: "create_embedding", avatarId: liveAvatarId, contextId: liveContextId, isSandbox: true }),
        headers: { "Content-Type": "application/json" }, method: "POST",
      });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo crear el embed.");
      setEmbedding(payload.data as Record<string, unknown>); toast.success("Embed interactivo creado.");
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo crear el embed."); }
    finally { setBusy(false); }
  };

  const selected = ACTIONS.find((item) => item.value === action)!;
  const liveConnected = Boolean((liveStatus?.status as Record<string, unknown> | undefined)?.connected);
  const outputLink = findUrl(embedding);
  const liveAvatars = findRecordArray(liveStatus?.avatars);
  const liveContexts = findRecordArray(liveStatus?.contexts);
  const account = (dashboard?.account || {}) as Record<string, unknown>;
  const accountName = String(account.username || "Workspace HeyGen");
  const balance = findNumber(account.wallet) ?? findNumber(account.usageBased);

  return (
    <section className="engine-surface p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="engine-eyebrow">HeyGen API v3</p>
          <h2 className="text-xl font-bold text-gray-900 dark:text-white">Centro avanzado de producción</h2>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-slate-400">
            Localización, identidad de voz, marca, postproducción, automatización y avatar interactivo.
          </p>
        </div>
        <button type="button" onClick={loadDashboard} disabled={!connected || loading}
          className="engine-button engine-button--secondary inline-flex items-center gap-2">
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} Actualizar
        </button>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
        <div className="rounded-2xl border border-gray-200 p-5 dark:border-white/10">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Herramienta">
              <select value={action} onChange={(event) => setAction(event.target.value as ToolAction)} className={controlClass}>
                {ACTIONS.map((item) => <option key={item.value} value={item.value}>{item.group} · {item.label}</option>)}
              </select>
            </Field>
            <Field label="Título"><input value={title} onChange={(event) => setTitle(event.target.value)} className={controlClass} placeholder={selected.label} /></Field>
            {needsVideo(action) ? <Field label={action === "create_brand_kit" ? "URL HTTPS del sitio de marca" : "Video: URL HTTPS o Asset ID"}><input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} className={controlClass} placeholder={action === "create_brand_kit" ? "https://marca.example" : "https://.../video.mp4 o asset_id"} /></Field> : null}
            {needsAudio(action) ? <Field label="Audio: URL HTTPS o Asset ID"><input value={audioUrl} onChange={(event) => setAudioUrl(event.target.value)} className={controlClass} placeholder="https://.../voz.wav o asset_id" /></Field> : null}
            {needsName(action) ? <Field label={action === "clone_voice" ? "Nombre de la voz" : "Nombre"}><input value={name} onChange={(event) => setName(event.target.value)} className={controlClass} /></Field> : null}
            {needsPrompt(action) ? <Field label="Instrucción / prompt" wide><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className={`${controlClass} min-h-24 py-2`} /></Field> : null}
            {needsLanguages(action) ? <Field label="Idiomas de salida (coma)"><input value={languages} onChange={(event) => setLanguages(event.target.value)} className={controlClass} placeholder="es, en, pt" /></Field> : null}
            {needsResource(action) ? <Field label={resourceLabel(action)}><select value={resourceId} onChange={(event) => setResourceId(event.target.value)} className={controlClass}><option value="">{action === "video_agent" ? "Sin estilo predeterminado" : "Selecciona una plantilla"}</option>{resourceOptions(action, dashboard).map((item, index) => { const id = readItemId(item); return id ? <option key={id} value={id}>{readItemName(item, `${action === "video_agent" ? "Estilo" : "Plantilla"} ${index + 1}`)}</option> : null; })}</select></Field> : null}
            {usesDuration(action) ? <Field label="Duración estimada (segundos)"><input type="number" min={1} value={durationSeconds} onChange={(event) => setDurationSeconds(Number(event.target.value) || 1)} className={controlClass} /></Field> : null}
            {usesMode(action) ? <Field label="Modo"><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)} className={controlClass}><option value="speed">Speed</option><option value="precision">Precision</option></select></Field> : null}
            {action === "translate_video" ? <Field label="Salida"><label className={`${controlClass} flex items-center gap-2 normal-case`}><input type="checkbox" checked={audioOnly} onChange={(event) => setAudioOnly(event.target.checked)} /> Solo audio traducido</label></Field> : null}
            {usesJson(action) ? <Field label={jsonLabel(action)} wide><textarea value={jsonInput} onChange={(event) => setJsonInput(event.target.value)} className={`${controlClass} min-h-28 py-2 font-mono text-xs`} /></Field> : null}
          </div>
          <button type="button" onClick={submit} disabled={!connected || busy}
            className="mt-4 inline-flex items-center gap-2 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />} Ejecutar {selected.label.toLowerCase()}
          </button>
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl border border-gray-200 p-4 dark:border-white/10">
            <h3 className="font-bold text-gray-900 dark:text-white">Control de consumo</h3>
            <p className="mt-1 text-xs font-semibold text-gray-600 dark:text-slate-300">{accountName}{balance !== null ? ` · saldo ${balance}` : ""}</p>
            <p className="mt-1 text-xs text-gray-500">{dashboard?.activeOperations || 0}/{dashboard?.maxConcurrentJobs || 10} operaciones concurrentes.</p>
            <div className="mt-3 grid gap-3">
              <Field label="Presupuesto mensual USD"><input type="number" min={0} value={monthlyBudget} onChange={(event) => setMonthlyBudget(event.target.value)} className={controlClass} placeholder="Sin límite" /></Field>
              <Field label="Presupuesto por curso USD"><input type="number" min={0} value={perCourseBudget} onChange={(event) => setPerCourseBudget(event.target.value)} className={controlClass} placeholder="Sin límite" /></Field>
              <Field label="Locale predeterminado"><input value={defaultLocale} onChange={(event) => setDefaultLocale(event.target.value)} className={controlClass} /></Field>
              <Field label="Glosario predeterminado"><select value={defaultGlossaryId} onChange={(event) => setDefaultGlossaryId(event.target.value)} className={controlClass}><option value="">Sin glosario</option>{(dashboard?.glossaries || []).map((item, index) => { const id = readItemId(item); return id ? <option key={id} value={id}>{readItemName(item, `Glosario ${index + 1}`)}</option> : null; })}</select></Field>
              <Field label="Brand kit predeterminado"><select value={defaultBrandKitId} onChange={(event) => setDefaultBrandKitId(event.target.value)} className={controlClass}><option value="">Sin brand kit</option>{(dashboard?.brandKits || []).map((item, index) => { const id = readItemId(item); return id ? <option key={id} value={id}>{readItemName(item, `Brand kit ${index + 1}`)}</option> : null; })}</select></Field>
            </div>
            <button type="button" onClick={saveSettings} disabled={busy || !connected} className="mt-3 engine-button engine-button--secondary inline-flex items-center gap-2"><Save size={14} /> Guardar</button>
          </div>

          <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
            <h3 className="font-bold text-gray-900 dark:text-white">LiveAvatar</h3>
            <p className="mt-1 text-xs text-gray-500">Embed conversacional separado de la API de video.</p>
            {!liveConnected ? <div className="mt-3 flex gap-2"><input type="password" value={liveApiKey} onChange={(event) => setLiveApiKey(event.target.value)} className={controlClass} placeholder="API key LiveAvatar" /><button type="button" onClick={connectLiveAvatar} disabled={busy || liveApiKey.length < 12} className="engine-button engine-button--secondary">Conectar</button></div> : <div className="mt-3 grid gap-2"><select value={liveAvatarId} onChange={(event) => setLiveAvatarId(event.target.value)} className={controlClass}><option value="">Selecciona avatar</option>{liveAvatars.map((item, index) => { const id = readItemId(item); return id ? <option key={id} value={id}>{readItemName(item, `Avatar ${index + 1}`)}</option> : null; })}</select><select value={liveContextId} onChange={(event) => setLiveContextId(event.target.value)} className={controlClass}><option value="">Selecciona contexto</option>{liveContexts.map((item, index) => { const id = readItemId(item); return id ? <option key={id} value={id}>{readItemName(item, `Contexto ${index + 1}`)}</option> : null; })}</select><button type="button" onClick={createEmbedding} disabled={busy || !liveAvatarId || !liveContextId} className="engine-button engine-button--secondary inline-flex items-center gap-2"><Play size={14} /> Crear embed sandbox</button></div>}
            {outputLink ? <a href={outputLink} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-cyan-700 underline"><ExternalLink size={12} /> Abrir experiencia</a> : null}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <OperationList operations={dashboard?.operations || []} onRefresh={async (id) => {
          await fetch(`/api/production/heygen/platform?resource=operation&operationId=${encodeURIComponent(id)}`, { cache: "no-store" });
          await loadDashboard();
        }} />
        <AudioLibrary assets={dashboard?.assets || []} />
      </div>
      <AssetUploader assets={dashboard?.providerAssets || []} onUploaded={loadDashboard} />
      <AudioSearch />
    </section>
  );
}

function buildActionBody(input: { action: ToolAction; audioOnly: boolean; audioUrl: string; componentId?: string; durationSeconds: number; jsonInput: string; languages: string; mode: "speed" | "precision"; name: string; prompt: string; resourceId: string; title: string; videoUrl: string }) {
  const base = { action: input.action, componentId: input.componentId, durationSeconds: input.durationSeconds, title: input.title || undefined };
  const video = toAssetSource(input.videoUrl);
  const audio = toAssetSource(input.audioUrl);
  const outputLanguages = input.languages.split(",").map((item) => item.trim()).filter(Boolean);
  switch (input.action) {
    case "translate_video": return { ...base, video, outputLanguages, mode: input.mode, translateAudioOnly: input.audioOnly };
    case "create_proofread": return { ...base, video, outputLanguages, mode: input.mode };
    case "lipsync": return { ...base, video, audio, mode: input.mode };
    case "ai_clipping": return { ...base, video, prompt: input.prompt || undefined, durationTypes: ["30"], aspectRatio: "portrait" };
    case "remove_fillers": return { ...base, video };
    case "design_voice": return { ...base, prompt: input.prompt, locale: input.languages.split(",")[0]?.trim() || "es-MX", seed: 0 };
    case "clone_voice": return { ...base, audio, voiceName: input.name, language: input.languages.split(",")[0]?.trim() || undefined, removeBackgroundNoise: true };
    case "create_glossary": return { ...base, name: input.name, terms: parseJson(input.jsonInput) };
    case "create_brand_kit": return { ...base, name: input.name || undefined, url: input.videoUrl };
    case "generate_template": return { ...base, templateId: input.resourceId, variables: parseJson(input.jsonInput), caption: false, fps: 25 };
    case "video_agent": return { ...base, prompt: input.prompt, styleId: input.resourceId || undefined, files: [], mode: "generate" };
    case "video_batch": return { ...base, videos: parseJson(input.jsonInput) };
  }
}

function parseJson(value: string): unknown { try { return JSON.parse(value); } catch { throw new Error("El JSON avanzado no es válido."); } }
function toAssetSource(value: string) {
  const normalized = value.trim();
  return /^https:\/\//i.test(normalized)
    ? { type: "url" as const, url: normalized }
    : { type: "asset_id" as const, asset_id: normalized };
}
function needsVideo(a: ToolAction) { return ["translate_video", "create_proofread", "lipsync", "ai_clipping", "remove_fillers", "create_brand_kit"].includes(a); }
function needsAudio(a: ToolAction) { return a === "lipsync" || a === "clone_voice"; }
function needsName(a: ToolAction) { return ["clone_voice", "create_glossary", "create_brand_kit"].includes(a); }
function needsPrompt(a: ToolAction) { return ["design_voice", "ai_clipping", "video_agent"].includes(a); }
function needsLanguages(a: ToolAction) { return ["translate_video", "create_proofread", "design_voice", "clone_voice"].includes(a); }
function needsResource(a: ToolAction) { return a === "generate_template" || a === "video_agent"; }
function resourceLabel(a: ToolAction) { return a === "generate_template" ? "Template ID" : "Style ID (opcional)"; }
function resourceOptions(a: ToolAction, dashboard: Dashboard | null) { return a === "generate_template" ? dashboard?.templates || [] : dashboard?.styles || []; }
function usesDuration(a: ToolAction) { return ["translate_video", "create_proofread", "lipsync", "ai_clipping", "remove_fillers", "video_agent"].includes(a); }
function usesMode(a: ToolAction) { return ["translate_video", "create_proofread", "lipsync"].includes(a); }
function usesJson(a: ToolAction) { return ["create_glossary", "generate_template", "video_batch"].includes(a); }
function jsonLabel(a: ToolAction) { return a === "create_glossary" ? "Términos JSON [{term, pronunciation}]" : a === "video_batch" ? "Videos JSON (máximo 100)" : "Variables JSON"; }

function Field({ children, label, wide }: { children: React.ReactNode; label: string; wide?: boolean }) { return <label className={`flex flex-col gap-1.5 text-xs font-bold uppercase tracking-wide text-gray-400 ${wide ? "sm:col-span-2" : ""}`}>{label}{children}</label>; }
const controlClass = "h-10 min-w-0 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm font-medium normal-case tracking-normal text-gray-800 outline-none focus:border-rose-500 dark:border-white/10 dark:bg-[var(--engine-canvas)] dark:text-white";

function OperationList({ operations, onRefresh }: { operations: Array<Record<string, unknown>>; onRefresh: (id: string) => Promise<void> }) {
  return <div className="rounded-2xl border border-gray-200 p-4 dark:border-white/10"><h3 className="font-bold text-gray-900 dark:text-white">Operaciones recientes</h3><div className="mt-3 max-h-72 space-y-2 overflow-auto">{operations.length ? operations.map((item) => { const outputUrl = findUrl(item.output_snapshot); return <div key={String(item.id)} className="flex items-center justify-between gap-3 rounded-xl bg-gray-50 px-3 py-2 text-xs dark:bg-white/5"><div className="min-w-0"><p className="truncate font-bold text-gray-800 dark:text-white">{String(item.title || item.operation_type)}</p><p className="text-gray-500">{String(item.operation_type)} · {String(item.status)}</p>{outputUrl ? <a href={outputUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 font-bold text-rose-600 underline"><ExternalLink size={11} /> Abrir resultado</a> : null}</div>{item.status === "WAITING_PROVIDER" ? <button type="button" onClick={() => onRefresh(String(item.id))} className="rounded-lg p-2 hover:bg-white dark:hover:bg-white/10" title="Actualizar"><RefreshCw size={14} /></button> : null}</div>; }) : <p className="text-sm text-gray-500">Todavía no hay operaciones avanzadas.</p>}</div></div>;
}

function AudioLibrary({ assets }: { assets: Array<Record<string, unknown>> }) {
  return <div className="rounded-2xl border border-gray-200 p-4 dark:border-white/10"><h3 className="font-bold text-gray-900 dark:text-white">Biblioteca de voz en off</h3><div className="mt-3 max-h-72 space-y-3 overflow-auto">{assets.length ? assets.map((item) => <div key={String(item.id)} className="rounded-xl bg-blue-500/5 p-3"><div className="mb-2 flex justify-between gap-2 text-xs"><strong>{String(item.title || "Voz en off")}</strong><span>{item.duration_seconds ? `${Number(item.duration_seconds).toFixed(1)}s` : "Audio"}</span></div><audio src={String(item.public_url)} controls preload="metadata" className="h-8 w-full" /></div>) : <p className="text-sm text-gray-500">Las voces independientes generadas aparecerán aquí.</p>}</div></div>;
}

function AssetUploader({ assets, onUploaded }: { assets: Array<Record<string, unknown>>; onUploaded: () => Promise<void> }) {
  const [uploading, setUploading] = useState(false);
  const [assetId, setAssetId] = useState("");
  const upload = async (file: File) => {
    setUploading(true);
    try {
      const prepareResponse = await fetch("/api/production/heygen/assets", {
        body: JSON.stringify({ action: "prepare", contentType: file.type || "application/octet-stream", fileName: file.name, sizeBytes: file.size }),
        headers: { "Content-Type": "application/json" }, method: "POST",
      });
      const preparedPayload = await readApiResponse(prepareResponse);
      if (!prepareResponse.ok || !preparedPayload.success) throw new Error(preparedPayload.error || "No se pudo preparar la carga.");
      const prepared = ((preparedPayload.data as Record<string, unknown>)?.data || preparedPayload.data) as Record<string, unknown>;
      const nextAssetId = String(prepared.asset_id || "");
      const uploadUrl = String(prepared.upload_url || "");
      if (!nextAssetId || !uploadUrl) throw new Error("HeyGen no devolvió instrucciones de carga.");
      const headers = new Headers((prepared.upload_headers || {}) as Record<string, string>);
      const uploadResponse = await fetch(uploadUrl, { body: file, headers, method: "PUT" });
      if (!uploadResponse.ok) throw new Error(`La carga directa falló (${uploadResponse.status}).`);
      const completeResponse = await fetch("/api/production/heygen/assets", {
        body: JSON.stringify({ action: "complete", assetId: nextAssetId }),
        headers: { "Content-Type": "application/json" }, method: "POST",
      });
      const completePayload = await readApiResponse(completeResponse);
      if (!completeResponse.ok || !completePayload.success) throw new Error(completePayload.error || "No se pudo finalizar el asset.");
      setAssetId(nextAssetId); toast.success("Asset cargado en HeyGen."); await onUploaded();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo cargar el asset."); }
    finally { setUploading(false); }
  };
  return <div className="mt-5 rounded-2xl border border-dashed border-gray-300 p-4 dark:border-white/15"><div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-gray-900 dark:text-white">Assets reutilizables</h3><p className="mt-1 text-xs text-gray-500">Carga directa a HeyGen; el archivo no atraviesa el servidor de Courseforge.</p></div><label className="engine-button engine-button--secondary cursor-pointer"><input type="file" className="hidden" disabled={uploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />{uploading ? "Subiendo…" : "Subir archivo"}</label></div>{assetId ? <p className="mt-3 rounded-lg bg-emerald-500/10 px-3 py-2 font-mono text-xs text-emerald-700 dark:text-emerald-300">Asset ID: {assetId}</p> : null}{assets.length ? <div className="mt-3 flex flex-wrap gap-2">{assets.slice(0, 10).map((item, index) => { const id = readItemId(item); return <span key={id || index} className="rounded-full bg-gray-100 px-2.5 py-1 font-mono text-[10px] text-gray-600 dark:bg-white/5 dark:text-slate-300" title={id}>{readItemName(item, id || `Asset ${index + 1}`)}</span>; })}</div> : null}</div>;
}

function AudioSearch() {
  const [query, setQuery] = useState("");
  const [type, setType] = useState<"music" | "sound_effects">("music");
  const [results, setResults] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const search = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const response = await fetch(`/api/production/heygen/platform?resource=audio-search&type=${type}&query=${encodeURIComponent(query)}&limit=20`, { cache: "no-store" });
      const payload = await readApiResponse(response);
      if (!response.ok || !payload.success) throw new Error(payload.error || "No se pudo buscar audio.");
      setResults(findRecordArray(payload.data));
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo buscar audio."); }
    finally { setLoading(false); }
  };
  return <div className="mt-5 rounded-2xl border border-gray-200 p-4 dark:border-white/10"><div className="flex flex-wrap items-end gap-2"><Field label="Música y efectos"><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void search(); }} className={controlClass} placeholder="Ambiente corporativo, transición..." /></Field><select value={type} onChange={(event) => setType(event.target.value as typeof type)} className={`${controlClass} max-w-44`}><option value="music">Música</option><option value="sound_effects">Efectos</option></select><button type="button" onClick={search} disabled={loading || !query.trim()} className="engine-button engine-button--secondary">{loading ? "Buscando…" : "Buscar"}</button></div>{results.length ? <div className="mt-3 grid gap-2 md:grid-cols-2">{results.slice(0, 8).map((item, index) => { const url = findUrl(item); return <div key={String(item.id || index)} className="rounded-xl bg-gray-50 p-3 text-xs dark:bg-white/5"><strong>{String(item.name || item.title || `Audio ${index + 1}`)}</strong>{url ? <audio src={url} controls preload="none" className="mt-2 h-8 w-full" /> : null}</div>; })}</div> : null}</div>;
}

function findUrl(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    if (typeof candidate === "string" && /^https:\/\//.test(candidate)) return candidate;
    const nested = findUrl(candidate); if (nested) return nested;
  }
  return null;
}

function findNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object") return null;
  for (const [key, candidate] of Object.entries(value as Record<string, unknown>)) {
    if (/credit|balance|remaining/i.test(key) && typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    const nested = findNumber(candidate); if (nested !== null) return nested;
  }
  return null;
}

function findRecordArray(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item));
  if (!value || typeof value !== "object") return [];
  for (const candidate of Object.values(value as Record<string, unknown>)) {
    const found = findRecordArray(candidate); if (found.length) return found;
  }
  return [];
}

function readItemId(item: Record<string, unknown>) { return String(item.id || item.avatar_id || item.context_id || item.brand_glossary_id || item.brand_kit_id || item.template_id || ""); }
function readItemName(item: Record<string, unknown>, fallback: string) { return String(item.name || item.title || fallback); }
