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

type ConnectionStatus = {
  connected: boolean;
  last4: string | null;
  lastValidationError: string | null;
};

type BusyAction = "save" | "validate" | "disconnect" | null;

export type ProviderIntegrationCardProps = {
  connectionPath: string;
  description: string;
  keyLabel: string;
  name: string;
  validatePath: string;
};

/** Reusable UI contract for organization-scoped provider API keys. */
export function ProviderIntegrationCard({
  connectionPath,
  description,
  keyLabel,
  name,
  validatePath,
}: ProviderIntegrationCardProps) {
  const [connection, setConnection] = useState<ConnectionStatus | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<BusyAction>(null);

  const loadConnection = async () => {
    try {
      const response = await fetch(connectionPath, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error || `No se pudo cargar la conexión de ${name}.`,
        );
      setConnection(body.data);
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `No se pudo cargar la conexión de ${name}.`,
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnection();
    // The endpoint is a stable card configuration, not mutable UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionPath]);

  const request = async (
    action: Exclude<BusyAction, null>,
    path: string,
    init: RequestInit,
  ) => {
    setBusy(action);
    try {
      const response = await fetch(path, init);
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error || `No se pudo actualizar ${name}.`);
      setConnection(body.data);
      setApiKey("");
      toast.success(
        action === "disconnect"
          ? `${name} desconectado para esta empresa.`
          : action === "validate"
            ? `Conexión de ${name} validada.`
            : `API de ${name} guardada y validada.`,
      );
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : `No se pudo actualizar ${name}.`,
      );
    } finally {
      setBusy(null);
    }
  };

  const connected = connection?.connected === true;
  const disabled = loading || busy !== null;

  return (
    <section className="engine-integration-row engine-integration-row--credential">
      <div className="engine-integration-row__main">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]">
            <KeyRound size={24} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white">
              {name}
            </h2>
            <p className="mt-1 max-w-md text-sm text-gray-600 dark:text-slate-400">
              {description}
            </p>
          </div>
        </div>
        <ConnectionBadge connected={connected} loading={loading} />
      </div>

      <div className="engine-integration-row__details">
        {connected ? (
          <p className="engine-integration-note engine-integration-note--success">
            API configurada ••••{connection?.last4 || ""}
          </p>
        ) : null}
        {connection?.lastValidationError ? (
          <p className="engine-integration-note engine-integration-note--danger">
            {connection.lastValidationError}
          </p>
        ) : null}
        <label className="engine-field">
          <span>{keyLabel}</span>
          <input
            type="password"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            autoComplete="off"
            disabled={disabled}
            placeholder={
              connected
                ? "Pega una nueva API key para reemplazarla"
                : `Pega la API key de ${name}`
            }
          />
        </label>
        <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">
          La clave se valida y almacena cifrada por empresa. No volverá a
          mostrarse.
        </p>
      </div>

      <div className="engine-integration-row__actions">
        <button
          type="button"
          disabled={disabled || !apiKey.trim()}
          onClick={() =>
            void request("save", connectionPath, {
              body: JSON.stringify({ apiKey }),
              headers: { "Content-Type": "application/json" },
              method: "POST",
            })
          }
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
              disabled={disabled}
              onClick={() =>
                void request("validate", validatePath, { method: "POST" })
              }
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
              disabled={disabled}
              onClick={() =>
                void request("disconnect", connectionPath, { method: "DELETE" })
              }
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

function ConnectionBadge({
  connected,
  loading,
}: {
  connected: boolean;
  loading: boolean;
}) {
  if (loading)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
        <Loader2 className="animate-spin" size={14} />
        Consultando
      </span>
    );
  if (connected)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 size={14} />
        Conectado
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">
      Desconectado
    </span>
  );
}
