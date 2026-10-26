"use client";

import { useEffect, useState } from "react";
import { getDeliverySettingsAction, saveDeliverySettingsAction } from "../actions/delivery-settings.actions";
import type { DeliverySettings } from "../services/delivery-settings";
import type { DeliveryOperation } from "../types/delivery.schemas";

const TITLES = { AGENDA: "Agenda de sesiones", PLAN: "Plan sincrónico e híbrido", MATERIALS: "Materiales de sesión" };
const SOURCES = { organization: "organización", global: "global", default: "predeterminado" };
function SettingCard({ operation, settings, reload }: { operation: DeliveryOperation; settings: DeliverySettings; reload: () => Promise<void> }) {
  const [model, setModel] = useState(settings.model);
  const [inherit, setInherit] = useState(settings.inherited);
  const [prompt, setPrompt] = useState(settings.prompt.content);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { await saveDeliverySettingsAction({ operation, model: inherit ? null : model, prompt }); await reload(); setMessage("Configuración guardada. Se aplicará a nuevas ejecuciones."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "No se pudo guardar."); }
    finally { setBusy(false); }
  };
  return <details className="rounded-xl border p-4">
    <summary className="cursor-pointer font-semibold">{TITLES[operation]}</summary>
    <p className="my-2 text-sm">Modelo efectivo: {settings.model.model_name || "Sin configurar"} · {settings.modelSource === "organization" ? "organización" : "global"}{settings.inherited ? ` · heredado de ${settings.settingType}` : ""}. Prompt: {SOURCES[settings.prompt.source]} · {settings.prompt.version}.</p>
    <label className="block"><input type="checkbox" checked={inherit} onChange={event => setInherit(event.target.checked)} /> Heredar modelo de la fase correspondiente</label>
    <fieldset disabled={inherit || busy} className="my-3 grid gap-3 sm:grid-cols-2">
      <label>Modelo principal<input className="block w-full rounded border bg-transparent p-2" value={model.model_name} onChange={event => setModel({ ...model, model_name: event.target.value })} /></label>
      <label>Respaldo opcional<input className="block w-full rounded border bg-transparent p-2" value={model.fallback_model || ""} onChange={event => setModel({ ...model, fallback_model: event.target.value || null })} /></label>
      <label>Temperatura<input type="number" min="0" max="2" step="0.1" className="block rounded border bg-transparent p-2" value={model.temperature} onChange={event => setModel({ ...model, temperature: Number(event.target.value) })} /></label>
      <label>Razonamiento<select className="block rounded border bg-transparent p-2" value={model.thinking_level || "medium"} onChange={event => setModel({ ...model, thinking_level: event.target.value as typeof model.thinking_level })}>{["minimal", "low", "medium", "high"].map(level => <option key={level}>{level}</option>)}</select></label>
    </fieldset>
    <label className="block">Prompt editable<textarea rows={7} className="my-2 block w-full rounded border bg-transparent p-2" value={prompt} onChange={event => setPrompt(event.target.value)} /></label>
    <button disabled={busy} onClick={save} className="rounded bg-cyan-700 px-4 py-2 text-white">{busy ? "Guardando…" : "Guardar configuración"}</button>
    {message && <p role="status" className="mt-2 text-sm">{message}</p>}
  </details>;
}
export function DeliverySettingsPanel() {
  const [rows, setRows] = useState<Awaited<ReturnType<typeof getDeliverySettingsAction>>>([]);
  const [error, setError] = useState("");
  const reload = async () => { try { setRows(await getDeliverySettingsAction()); } catch (failure) { setError(failure instanceof Error ? failure.message : "Configuración no disponible."); } };
  useEffect(() => { void reload(); }, []);
  return <section className="space-y-3 rounded-xl border p-5">
    <h3 className="text-lg font-bold">Generación sincrónica e híbrida</h3>
    <p>Configura modelos y prompts de tu organización. Las ejecuciones iniciadas conservan su configuración original.</p>
    {error && <p role="status">{error}</p>}
    {rows.map(row => <SettingCard key={row.operation + row.settings.hash} {...row} reload={reload} />)}
  </section>;
}
