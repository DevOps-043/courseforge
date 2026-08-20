"use client";

import { useEffect, useState } from "react";
import {
  CheckCircle2,
  KeyRound,
  Loader2,
  RefreshCw,
  Unplug,
} from "lucide-react";
import { toast } from "sonner";

type HeygenConnection = {
  connected: boolean;
  last4: string | null;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  validationStatus: string | null;
};

type BusyAction = "save" | "validate" | "disconnect" | null;

export function HeygenIntegrationCard() {
  const [connection, setConnection] = useState<HeygenConnection | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);

  useEffect(() => {
    const loadConnection = async () => {
      try {
        const response = await fetch("/api/production/heygen/connection", {
          cache: "no-store",
        });
        const body = await response.json();
        if (!response.ok) {
          throw new Error(body.error || "No se pudo cargar la conexión de HeyGen.");
        }
        setConnection(body.data);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "No se pudo cargar la conexión de HeyGen.",
        );
      } finally {
        setLoading(false);
      }
    };

    void loadConnection();
  }, []);

  const saveConnection = async () => {
    if (!apiKey.trim()) return;
    setBusy("save");
    try {
      const response = await fetch("/api/production/heygen/connection", {
        body: JSON.stringify({ apiKey }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "No se pudo guardar la API key de HeyGen.");
      }
      setConnection(body.data);
      setApiKey("");
      toast.success("API de HeyGen guardada y validada.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo guardar la API key de HeyGen.",
      );
    } finally {
      setBusy(null);
    }
  };

  const validateConnection = async () => {
    setBusy("validate");
    try {
      const response = await fetch(
        "/api/production/heygen/connection/validate",
        { method: "POST" },
      );
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "No se pudo validar la API de HeyGen.");
      }
      setConnection(body.data);
      toast.success("API de HeyGen validada.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo validar la API de HeyGen.",
      );
    } finally {
      setBusy(null);
    }
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      const response = await fetch("/api/production/heygen/connection", {
        method: "DELETE",
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "No se pudo desconectar HeyGen.");
      }
      setConnection(body.data);
      setApiKey("");
      toast.success("HeyGen desconectado para esta empresa.");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "No se pudo desconectar HeyGen.",
      );
    } finally {
      setBusy(null);
    }
  };

  const connected = connection?.connected === true;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-[#00D4B3]/40 dark:border-white/5 dark:bg-[#151A21]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#00D4B3]/10 text-[#00A98F] dark:text-[#00D4B3]">
            <KeyRound size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              HeyGen
            </h2>
            <p className="mt-1 max-w-md text-sm text-gray-600 dark:text-slate-400">
              Conecta la API de HeyGen para sincronizar avatares y voces, y generar videos para esta empresa.
            </p>
          </div>
        </div>

        {loading ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
            <Loader2 className="animate-spin" size={14} />
            Consultando
          </span>
        ) : connected ? (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 size={14} />
            Conectado
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
            Desconectado
          </span>
        )}
      </div>

      {connected ? (
        <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
          API configurada ••••{connection.last4 || ""}
        </p>
      ) : null}

      {connection?.lastValidationError ? (
        <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">
          {connection.lastValidationError}
        </p>
      ) : null}

      <label className="mt-5 block text-sm font-semibold text-gray-700 dark:text-gray-200">
        API key de HeyGen
        <input
          type="password"
          value={apiKey}
          onChange={(event) => setApiKey(event.target.value)}
          autoComplete="off"
          disabled={loading || busy !== null}
          placeholder={
            connected
              ? "Pega una nueva API key para reemplazarla"
              : "Pega la API key de HeyGen"
          }
          className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#1F5AF6] focus:ring-2 focus:ring-[#1F5AF6]/10 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-white"
        />
      </label>
      <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
        La clave se valida y almacena cifrada por empresa. No volverá a mostrarse.
      </p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button
          type="button"
          disabled={loading || busy !== null || !apiKey.trim()}
          onClick={() => void saveConnection()}
          className="inline-flex items-center gap-2 rounded-xl bg-[#1F5AF6] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#1F5AF6]/15 transition hover:bg-[#1a4bd6] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy === "save" ? (
            <Loader2 className="animate-spin" size={16} />
          ) : (
            <RefreshCw size={16} />
          )}
          {connected ? "Cambiar API key" : "Guardar y conectar"}
        </button>

        {connected ? (
          <>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void validateConnection()}
              className="inline-flex items-center gap-2 rounded-xl border border-[#1F5AF6]/30 px-4 py-2.5 text-sm font-semibold text-[#1F5AF6] transition hover:bg-[#1F5AF6]/5 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy === "validate" ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <CheckCircle2 size={16} />
              )}
              Validar conexión
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void disconnect()}
              className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-500/10"
            >
              {busy === "disconnect" ? (
                <Loader2 className="animate-spin" size={16} />
              ) : (
                <Unplug size={16} />
              )}
              Desconectar
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}
