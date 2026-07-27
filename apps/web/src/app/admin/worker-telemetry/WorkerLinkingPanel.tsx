"use client";

import { Copy, KeyRound, Link2, Loader2, ShieldCheck } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import {
  createWorkerLinkCodeForOrganizationAction,
  setPrimaryBundleWorkerForOrganizationAction,
} from "./actions";
import type { LinkedWorkerView, WorkerLinkCodeView } from "./worker-telemetry-page-data";

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function workerStatusClasses(value: string) {
  if (value === "ONLINE") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (value === "BUSY") return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
  if (value === "REVOKED") return "bg-red-500/10 text-red-700 dark:text-red-300";
  return "bg-slate-500/10 text-slate-600 dark:text-slate-300";
}

function resolveSlugFromPathname(pathname: string | null) {
  const [organizationSlug, appSegment] = (pathname || "").split("/").filter(Boolean);
  return organizationSlug && appSegment === "admin" ? organizationSlug : null;
}

export function WorkerLinkingPanel({
  linkCodes,
  newLinkCode,
  organizationId,
  organizationSlug,
  workers,
}: {
  linkCodes: WorkerLinkCodeView[];
  newLinkCode: string | null;
  organizationId: string | null;
  organizationSlug: string | null;
  workers: LinkedWorkerView[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [deviceName, setDeviceName] = useState("");
  const [linkCode, setLinkCode] = useState(newLinkCode);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [primaryWorkerId, setPrimaryWorkerId] = useState<string | null>(null);
  const effectiveOrganizationSlug = useMemo(
    () => organizationSlug || resolveSlugFromPathname(pathname),
    [organizationSlug, pathname],
  );
  const primaryWorker = workers.find((worker) => worker.isPrimaryBundleWorker);

  const handleCreateLinkCode = () => {
    setError(null);
    startTransition(async () => {
      const result = await createWorkerLinkCodeForOrganizationAction({
        deviceName,
        organizationId,
        organizationSlug: effectiveOrganizationSlug,
      });

      if (!result.success) {
        setError(result.error || "No se pudo crear el codigo de vinculacion.");
        return;
      }

      setLinkCode(result.code || null);
      router.refresh();
    });
  };

  const handleSetPrimary = (workerId: string) => {
    setError(null);
    setPrimaryWorkerId(workerId);
    startTransition(async () => {
      const result = await setPrimaryBundleWorkerForOrganizationAction({
        organizationId,
        organizationSlug: effectiveOrganizationSlug,
        workerId,
      });

      if (!result.success) {
        setError(result.error || "No se pudo marcar el worker principal.");
      } else {
        router.refresh();
      }
      setPrimaryWorkerId(null);
    });
  };

  const handleCopyCode = async () => {
    if (!linkCode) return;
    try {
      await navigator.clipboard.writeText(linkCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setError("No se pudo copiar el codigo. Seleccionalo manualmente.");
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[0.9fr_1.4fr]">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#6C757D]/10 dark:bg-[#151A21]">
        <div className="mb-4 flex items-center gap-2">
          <Link2 className="h-5 w-5 text-[#00A98F] dark:text-[#00D4B3]" />
          <h2 className="font-bold text-gray-900 dark:text-white">Vinculacion general</h2>
        </div>

        <div className="space-y-3">
          <label className="block text-sm font-medium text-gray-700 dark:text-slate-200" htmlFor="worker-device-name">
            Nombre sugerido
          </label>
          <input
            className="w-full rounded-md border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none transition focus:border-[#00A98F] focus:ring-2 focus:ring-[#00A98F]/15 dark:border-white/10 dark:bg-[#0F1419] dark:text-white"
            id="worker-device-name"
            onChange={(event) => setDeviceName(event.target.value)}
            placeholder="Worker principal de bundles"
            type="text"
            value={deviceName}
          />
          <button
            className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-[#0B2B4C] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#123C68] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-[#00A98F] dark:text-[#061018]"
            disabled={isPending || (!organizationId && !effectiveOrganizationSlug)}
            onClick={handleCreateLinkCode}
            type="button"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Generar codigo de vinculacion
          </button>
        </div>

        {error && (
          <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200">
            {error}
          </div>
        )}

        {linkCode && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-400/20 dark:bg-emerald-400/10">
            <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">Codigo activo</p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <p className="font-mono text-2xl font-bold text-emerald-950 dark:text-emerald-100">{linkCode}</p>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-emerald-300 px-2 py-1 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-400/20 dark:text-emerald-100 dark:hover:bg-emerald-400/10"
                onClick={handleCopyCode}
                type="button"
              >
                <Copy className="h-3 w-3" />
                {copied ? "Copiado" : "Copiar"}
              </button>
            </div>
            <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
              Usalo en el worker local antes de que expire. Genera uno nuevo si este ya no aparece como pendiente.
            </p>
          </div>
        )}

        <div className="mt-5 space-y-2">
          <p className="text-sm font-semibold text-gray-900 dark:text-white">Codigos pendientes</p>
          {linkCodes.length > 0 ? (
            linkCodes.map((code) => (
              <div key={code.id} className="flex items-center justify-between rounded-md border border-gray-100 px-3 py-2 text-sm dark:border-white/10">
                <div>
                  <p className="font-medium text-gray-900 dark:text-white">Termina en {code.codeLast4}</p>
                  <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{code.deviceName || code.platformLabel}</p>
                </div>
                <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{formatDateTime(code.expiresAt)}</p>
              </div>
            ))
          ) : (
            <p className="text-sm text-gray-500 dark:text-[#94A3B8]">No hay codigos activos.</p>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#6C757D]/10 dark:bg-[#151A21]">
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#1F5AF6]" />
            <div>
              <h2 className="font-bold text-gray-900 dark:text-white">Worker principal</h2>
              <p className="text-sm text-gray-500 dark:text-[#94A3B8]">
                {primaryWorker ? `${primaryWorker.name} prioriza builds de bundles.` : "Selecciona el equipo encargado de bundles."}
              </p>
            </div>
          </div>
        </div>

        {workers.length > 0 ? (
          <div className="space-y-3">
            {workers.map((worker) => (
              <div key={worker.id} className="flex flex-col gap-3 rounded-lg border border-gray-100 p-4 dark:border-white/10 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="font-semibold text-gray-900 dark:text-white">{worker.name}</p>
                    <span className={`rounded-full px-2 py-1 text-xs font-semibold ${workerStatusClasses(worker.status)}`}>
                      {worker.status}
                    </span>
                    {worker.isPrimaryBundleWorker && (
                      <span className="rounded-full bg-[#00A98F]/10 px-2 py-1 text-xs font-semibold text-[#007D6A] dark:text-[#00D4B3]">
                        Principal bundles
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500 dark:text-[#94A3B8]">
                    {worker.platformLabel} · {worker.appVersion} · token *{worker.tokenLast4}
                  </p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-[#94A3B8]">
                    Slots {worker.runningJobs}/{worker.maxConcurrentJobs} en uso · disponibles {worker.availableSlots}
                  </p>
                </div>
                <button
                  className="inline-flex w-full items-center justify-center rounded-md border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:text-slate-200 dark:hover:bg-white/5 md:w-auto"
                  disabled={isPending || worker.isPrimaryBundleWorker || worker.status === "REVOKED"}
                  onClick={() => handleSetPrimary(worker.id)}
                  type="button"
                >
                  {primaryWorkerId === worker.id ? "Guardando..." : "Marcar principal"}
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center dark:border-white/10">
            <p className="font-medium text-gray-900 dark:text-white">Todavia no hay workers vinculados.</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-[#94A3B8]">
              Genera un codigo y usalo desde el worker local para que aparezca en esta lista.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
