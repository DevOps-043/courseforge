"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Save, Sparkles } from "lucide-react";

type AssistantSettings = { agentAssistedGenerationEnabled: boolean; agentModel: string; automaticGenerationEnabled: boolean; fallbackModel?: string | null; temperature: number };
type ProviderStatus = { connected: boolean; last4: string | null; lastValidatedAt: string | null; lastValidationError: string | null; validationStatus: string | null };

/** Organization-scoped configuration. API secrets never leave these protected routes after save. */
export function VideoStudioSettings() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"assistant" | "provider" | "validate" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const [assistantResponse, providerResponse] = await Promise.all([fetch("/api/production/hyperframes/settings", { cache: "no-store" }), fetch("/api/production/heygen/connection", { cache: "no-store" })]);
      const assistantBody = await assistantResponse.json(); const providerBody = await providerResponse.json();
      if (!assistantResponse.ok) throw new Error(assistantBody.error || "No se pudo cargar la configuración del asistente.");
      if (!providerResponse.ok) throw new Error(providerBody.error || "No se pudo cargar la conexión de renderizado.");
      setSettings(assistantBody.data); setProvider(providerBody.data);
    } catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo cargar la configuración."); }
  };
  useEffect(() => { void load(); }, []);

  const saveAssistant = async () => {
    if (!settings) return; setBusy("assistant"); setMessage(null);
    try { const response = await fetch("/api/production/hyperframes/settings", { body: JSON.stringify(settings), headers: { "Content-Type": "application/json" }, method: "PUT" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo guardar la configuración."); setSettings(body.data); setMessage("Configuración del asistente guardada."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la configuración."); } finally { setBusy(null); }
  };
  const saveProvider = async () => {
    if (!apiKey.trim()) return; setBusy("provider"); setMessage(null);
    try { const response = await fetch("/api/production/heygen/connection", { body: JSON.stringify({ apiKey }), headers: { "Content-Type": "application/json" }, method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo guardar la API key."); setProvider(body.data); setApiKey(""); setMessage("Conexión de renderizado guardada y validada."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar la API key."); } finally { setBusy(null); }
  };
  const validateProvider = async () => {
    setBusy("validate"); setMessage(null);
    try { const response = await fetch("/api/production/heygen/connection/validate", { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "No se pudo validar la conexión."); setProvider(body.data); setMessage("Conexión validada."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo validar la conexión."); } finally { setBusy(null); }
  };

  if (!settings) return <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-[#151A21] dark:text-gray-300"><Loader2 className="animate-spin" size={16} /> Cargando configuración de video…</div>;
  return <section className="space-y-5"><div className="grid gap-5 lg:grid-cols-2"><section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#151A21]"><div className="flex items-start gap-3"><span className="rounded-lg bg-violet-100 p-2 text-violet-700 dark:bg-violet-400/10 dark:text-violet-300"><Sparkles size={18} /></span><div><h3 className="font-bold text-slate-900 dark:text-white">Asistente de edición</h3><p className="mt-1 text-xs text-slate-500 dark:text-gray-400">Define el modelo que prepara propuestas para SofLIA. Las propuestas siempre requieren aprobación.</p></div></div><label className="mt-4 block text-xs font-semibold text-slate-700 dark:text-gray-200">Modelo<input value={settings.agentModel} onChange={(event) => setSettings({ ...settings, agentModel: event.target.value })} maxLength={128} className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label><label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-gray-200">Temperatura: {settings.temperature.toFixed(2)}<input type="range" min="0" max="2" step="0.05" value={settings.temperature} onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })} className="mt-2 w-full accent-violet-600" /></label><label className="mt-3 flex items-center gap-2 text-xs text-slate-700 dark:text-gray-200"><input type="checkbox" checked={settings.agentAssistedGenerationEnabled} onChange={(event) => setSettings({ ...settings, agentAssistedGenerationEnabled: event.target.checked })} /> Habilitar edición asistida</label><button type="button" disabled={busy !== null} onClick={() => void saveAssistant()} className="mt-4 inline-flex items-center gap-2 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy === "assistant" ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />} Guardar asistente</button></section><section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#151A21]"><div className="flex items-start gap-3"><span className="rounded-lg bg-cyan-100 p-2 text-cyan-700 dark:bg-cyan-400/10 dark:text-cyan-300"><KeyRound size={18} /></span><div><h3 className="font-bold text-slate-900 dark:text-white">Conexión de renderizado</h3><p className="mt-1 text-xs text-slate-500 dark:text-gray-400">La clave se valida y almacena cifrada por empresa; no se muestra nuevamente.</p></div></div><p className={`mt-4 flex items-center gap-2 text-xs font-semibold ${provider?.connected ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}`}><CheckCircle2 size={14} />{provider?.connected ? `Conectada ••••${provider.last4 || ""}` : "Sin conexión configurada"}</p><label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-gray-200">API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" placeholder="Pega una nueva clave para actualizarla" className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white" /></label><div className="mt-4 flex flex-wrap gap-2"><button type="button" disabled={busy !== null || !apiKey.trim()} onClick={() => void saveProvider()} className="inline-flex items-center gap-2 rounded-lg bg-cyan-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">{busy === "provider" && <Loader2 className="animate-spin" size={14} />} Guardar y validar</button>{provider?.connected && <button type="button" disabled={busy !== null} onClick={() => void validateProvider()} className="rounded-lg border border-cyan-700 px-3 py-2 text-xs font-bold text-cyan-800 disabled:opacity-50 dark:border-cyan-300 dark:text-cyan-200">{busy === "validate" ? "Validando…" : "Validar conexión"}</button>}</div>{provider?.lastValidationError && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{provider.lastValidationError}</p>}</section></div>{message && <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-white/5 dark:text-gray-200">{message}</p>}</section>;
}
