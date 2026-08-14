"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, Save, Sparkles } from "lucide-react";
import { PremiumSelect } from "@/shared/components/PremiumSelect";
import { VIDEO_STUDIO_MODEL_OPTIONS } from "@/domains/production/hyperframes/video-studio-model-options";

type AssistantSettings = {
  agentAssistedGenerationEnabled: boolean;
  agentModel: string;
  automaticGenerationEnabled: boolean;
  fallbackModel?: string | null;
  temperature: number;
};

type ProviderStatus = {
  connected: boolean;
  last4: string | null;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  validationStatus: string | null;
};

/** Organization-scoped configuration. API secrets never leave protected routes after save. */
export function VideoStudioSettings() {
  const [settings, setSettings] = useState<AssistantSettings | null>(null);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"assistant" | "provider" | "validate" | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    try {
      const [assistantResponse, providerResponse] = await Promise.all([
        fetch("/api/production/hyperframes/settings", { cache: "no-store" }),
        fetch("/api/production/heygen/connection", { cache: "no-store" }),
      ]);
      const assistantBody = await assistantResponse.json();
      const providerBody = await providerResponse.json();
      if (!assistantResponse.ok) {
        throw new Error(assistantBody.error || "No se pudo cargar la configuración del asistente.");
      }
      if (!providerResponse.ok) {
        throw new Error(providerBody.error || "No se pudo cargar la conexión de HeyGen.");
      }
      setSettings(assistantBody.data);
      setProvider(providerBody.data);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo cargar la configuración.");
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const saveAssistant = async () => {
    if (!settings) return;
    setBusy("assistant");
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
      setBusy(null);
    }
  };

  const saveProvider = async () => {
    if (!apiKey.trim()) return;
    setBusy("provider");
    setMessage(null);
    try {
      const response = await fetch("/api/production/heygen/connection", {
        body: JSON.stringify({ apiKey }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo guardar la API key de HeyGen.");
      setProvider(body.data);
      setApiKey("");
      setMessage("API de HeyGen guardada y validada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo guardar la API key de HeyGen.");
    } finally {
      setBusy(null);
    }
  };

  const validateProvider = async () => {
    setBusy("validate");
    setMessage(null);
    try {
      const response = await fetch("/api/production/heygen/connection/validate", { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo validar la API de HeyGen.");
      setProvider(body.data);
      setMessage("API de HeyGen validada.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "No se pudo validar la API de HeyGen.");
    } finally {
      setBusy(null);
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
      <div className="grid gap-5 lg:grid-cols-2">
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
            disabled={busy !== null}
            onClick={() => void saveAssistant()}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#0A2540] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#0d2f4d] disabled:opacity-50"
          >
            {busy === "assistant" ? <Loader2 className="animate-spin" size={14} /> : <Save size={14} />}
            Guardar asistente
          </button>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-white/10 dark:bg-[#151A21]">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-[#00D4B3]/15 p-2 text-[#0A2540] dark:bg-[#00D4B3]/15 dark:text-[#00D4B3]">
              <KeyRound size={18} />
            </span>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white">API de HeyGen</h3>
              <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                Clave para renderizado cloud. Se valida y almacena cifrada por empresa; nunca se muestra nuevamente.
              </p>
            </div>
          </div>
          <p className={`mt-4 flex items-center gap-2 text-xs font-semibold ${provider?.connected ? "text-[#10B981]" : "text-[#F59E0B]"}`}>
            <CheckCircle2 size={14} />
            {provider?.connected ? `API de HeyGen conectada ••••${provider.last4 || ""}` : "API de HeyGen no configurada"}
          </p>
          <label className="mt-3 block text-xs font-semibold text-slate-700 dark:text-gray-200">
            API key de HeyGen
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              autoComplete="off"
              placeholder="Pega una nueva API key de HeyGen"
              className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 dark:border-white/15 dark:bg-slate-950 dark:text-white"
            />
          </label>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy !== null || !apiKey.trim()}
              onClick={() => void saveProvider()}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0A2540] px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-[#0d2f4d] disabled:opacity-50"
            >
              {busy === "provider" && <Loader2 className="animate-spin" size={14} />}
              Guardar y validar API
            </button>
            {provider?.connected && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void validateProvider()}
                className="rounded-lg border border-[#00D4B3] px-3 py-2 text-xs font-bold text-[#0A2540] transition-colors hover:bg-[#00D4B3]/10 disabled:opacity-50 dark:text-[#00D4B3]"
              >
                {busy === "validate" ? "Validando…" : "Validar API de HeyGen"}
              </button>
            )}
          </div>
          {provider?.lastValidationError && <p className="mt-3 text-xs text-red-700 dark:text-red-300">{provider.lastValidationError}</p>}
        </section>
      </div>
      {message && <p role="status" className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-700 dark:bg-white/5 dark:text-gray-200">{message}</p>}
    </section>
  );
}
