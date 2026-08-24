"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, KeyRound, Loader2, RefreshCw, Unplug } from "lucide-react";
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
      if (!response.ok) throw new Error(body.error || `No se pudo cargar la conexión de ${name}.`);
      setConnection(body.data);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `No se pudo cargar la conexión de ${name}.`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadConnection();
    // The endpoint is a stable card configuration, not mutable UI state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connectionPath]);

  const request = async (action: Exclude<BusyAction, null>, path: string, init: RequestInit) => {
    setBusy(action);
    try {
      const response = await fetch(path, init);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `No se pudo actualizar ${name}.`);
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
      toast.error(error instanceof Error ? error.message : `No se pudo actualizar ${name}.`);
    } finally {
      setBusy(null);
    }
  };

  const connected = connection?.connected === true;
  const disabled = loading || busy !== null;

  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-[#00D4B3]/40 dark:border-white/5 dark:bg-[#151A21]">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#00D4B3]/10 text-[#00A98F] dark:text-[#00D4B3]"><KeyRound size={24} /></div>
          <div><h2 className="text-lg font-bold text-gray-900 dark:text-white">{name}</h2><p className="mt-1 max-w-md text-sm text-gray-600 dark:text-slate-400">{description}</p></div>
        </div>
        <ConnectionBadge connected={connected} loading={loading} />
      </div>

      {connected ? <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">API configurada ••••{connection?.last4 || ""}</p> : null}
      {connection?.lastValidationError ? <p className="mt-3 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-red-700 dark:text-red-300">{connection.lastValidationError}</p> : null}

      <label className="mt-5 block text-sm font-semibold text-gray-700 dark:text-gray-200">
        {keyLabel}
        <input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} autoComplete="off" disabled={disabled} placeholder={connected ? "Pega una nueva API key para reemplazarla" : `Pega la API key de ${name}`} className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-[#1F5AF6] focus:ring-2 focus:ring-[#1F5AF6]/10 disabled:opacity-60 dark:border-white/10 dark:bg-slate-950 dark:text-white" />
      </label>
      <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">La clave se valida y almacena cifrada por empresa. No volverá a mostrarse.</p>

      <div className="mt-5 flex flex-wrap gap-3">
        <button type="button" disabled={disabled || !apiKey.trim()} onClick={() => void request("save", connectionPath, { body: JSON.stringify({ apiKey }), headers: { "Content-Type": "application/json" }, method: "POST" })} className="inline-flex items-center gap-2 rounded-xl bg-[#1F5AF6] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#1F5AF6]/15 transition hover:bg-[#1a4bd6] disabled:cursor-not-allowed disabled:opacity-60">
          {busy === "save" ? <Loader2 className="animate-spin" size={16} /> : <RefreshCw size={16} />}{connected ? "Cambiar API key" : "Guardar y conectar"}
        </button>
        {connected ? <>
          <button type="button" disabled={disabled} onClick={() => void request("validate", validatePath, { method: "POST" })} className="inline-flex items-center gap-2 rounded-xl border border-[#1F5AF6]/30 px-4 py-2.5 text-sm font-semibold text-[#1F5AF6] transition hover:bg-[#1F5AF6]/5 disabled:cursor-not-allowed disabled:opacity-60">{busy === "validate" ? <Loader2 className="animate-spin" size={16} /> : <CheckCircle2 size={16} />}Validar conexión</button>
          <button type="button" disabled={disabled} onClick={() => void request("disconnect", connectionPath, { method: "DELETE" })} className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-500/10">{busy === "disconnect" ? <Loader2 className="animate-spin" size={16} /> : <Unplug size={16} />}Desconectar</button>
        </> : null}
      </div>
    </section>
  );
}

function ConnectionBadge({ connected, loading }: { connected: boolean; loading: boolean }) {
  if (loading) return <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400"><Loader2 className="animate-spin" size={14} />Consultando</span>;
  if (connected) return <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><CheckCircle2 size={14} />Conectado</span>;
  return <span className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-500 dark:bg-white/5 dark:text-slate-400">Desconectado</span>;
}
