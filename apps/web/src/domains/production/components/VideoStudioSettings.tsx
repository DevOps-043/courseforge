"use client";

import { useEffect, useState } from "react";
import { Loader2, Save, Sparkles } from "lucide-react";
import { PremiumSelect } from "@/shared/components/PremiumSelect";
import { VIDEO_STUDIO_MODEL_OPTIONS } from "@/domains/production/hyperframes/video-studio-model-options";

type AssistantSettings = {
  agentAssistedGenerationEnabled: boolean;
  agentModel: string;
  automaticGenerationEnabled: boolean;
  fallbackModel?: string | null;
  temperature: number;
};

/** Organization-scoped configuration for the editing assistant. */
export function VideoStudioSettings() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const assistantResponse = await fetch("/api/production/hyperframes/settings", {
        cache: "no-store",
      });
      const assistantBody = await assistantResponse.json();
      if (!assistantResponse.ok) {
        throw new Error(assistantBody.error || "No se pudo cargar la configuración del asistente.");
      }
      setSettings(assistantBody.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la configuración.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveAssistant = async () => {
    if (!settings) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/production/hyperframes/settings", {
        body: JSON.stringify(settings),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo guardar la configuración.");
      setSettings(body.data);
      setMessage("Configuración del asistente guardada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la configuración.");
    } finally {
      setBusy(false);
    }
  };

  if (!settings) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600 dark:border-white/10 dark:bg-[#151A21] dark:text-gray-300">
        <Loader2 className="animate-spin" size={16} />
        Cargando configuración de video…
      </div>
    );
  }

  return (
    <section className="space-y-5">
      <div>
        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#151A21]">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-[#00D4B3]/15 p-2 text-[#0A2540] dark:bg-[#00D4B3]/15 dark:text-[#00D4B3]">
              <Sparkles size={18} />
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">Asistente de edición</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                Selecciona el modelo que prepara propuestas para SofLIA. Cada propuesta requiere aprobación.
              </p>
            </div>
          </div>

          <div className="mt-4">
            <PremiumSelect
              icon={<Sparkles size={12} className="text-[#00D4B3]" />}
              label="Modelo de edición"
              options={VIDEO_STUDIO_MODEL_OPTIONS}
              value={settings.agentModel}
              onChange={(agentModel) => setSettings({ ...settings, agentModel })}
            />
          </div>

          <div className="mt-3">
            <PremiumSelect
              icon={<Sparkles size={12} className="text-[#00D4B3]" />}
              label="Modelo de respaldo"
              options={[
                { value: "", label: "Sin modelo de respaldo", description: "Detenerse si el modelo principal no se recupera." },
                ...VIDEO_STUDIO_MODEL_OPTIONS.filter((option) => option.value !== settings.agentModel),
              ]}
              value={settings.fallbackModel || ""}
              onChange={(fallbackModel) => setSettings({ ...settings, fallbackModel: fallbackModel || null })}
            />
          </div>

          <label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-gray-200">
            Temperatura: {settings.temperature.toFixed(2)}
            <input
              type="range"
              min="0"
              max="2"
              step="0.05"
              value={settings.temperature}
              onChange={(event) => setSettings({ ...settings, temperature: Number(event.target.value) })}
              className="mt-2 w-full accent-[#00D4B3]"
            />
          </label>
          <label className="mt-3 flex items-center gap-2 text-xs text-slate-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={settings.agentAssistedGenerationEnabled}
              onChange={(event) => setSettings({ ...settings, agentAssistedGenerationEnabled: event.target.checked })}
            />
            Habilitar edición asistida
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveAssistant()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#0A2540] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#0d2f4d] disabled:opacity-50"
          >
            {busy ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            Guardar asistente
          </button>
        </section>
      </div>
      {message && <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-white/5 dark:text-gray-200">{message}</p>}
    </section>
  );
}
