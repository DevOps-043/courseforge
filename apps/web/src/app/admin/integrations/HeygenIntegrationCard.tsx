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
    <section className="engine-integration-row engine-integration-row--credential">
      <div className="engine-integration-row__main">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]">
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

      <div className="engine-integration-row__details">
      {connected ? (
        <p className="engine-integration-note engine-integration-note--success">
          API configurada ••••{connection.last4 || ""}
        </p>
      ) : null}

      {connection?.lastValidationError ? (
        <p className="engine-integration-note engine-integration-note--danger">
          {connection.lastValidationError}
        </p>
      ) : null}

      <label className="engine-field">
        <span>
        API key de HeyGen
        </span>
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
        />
      </label>
      <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
        La clave se valida y almacena cifrada por empresa. No volverá a mostrarse.
      </p>
      </div>

      <div className="engine-integration-row__actions">
        <button
          type="button"
          disabled={loading || busy !== null || !apiKey.trim()}
          onClick={() => void saveConnection()}
          className="engine-button engine-button--primary"
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
              className="engine-button"
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
              className="engine-button engine-button--danger"
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
