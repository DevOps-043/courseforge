"use client";

import { useState } from "react";
import { CheckCircle2, Cloud, RefreshCw, TriangleAlert, Unplug } from "lucide-react";
import { toast } from "sonner";
import { CloudStorageConnectButton } from "@/app/admin/artifacts/new/components/CloudStorageConnectButton";
import { disconnectCloudStorageAction } from "@/domains/production/actions/cloud-storage.actions";
import type {
  CloudStorageConnection,
  CloudStorageProvider,
} from "@/domains/production/cloud-storage/types";

const PROVIDER_LABELS: Record<CloudStorageProvider, string> = {
  google_drive: "Google Drive",
  onedrive: "OneDrive",
};

const PROVIDER_COPY: Record<CloudStorageProvider, string> = {
  google_drive:
    "Permite crear carpetas de trabajo y leer recursos autorizados desde Google Drive para esta empresa.",
  onedrive:
    "Permite crear carpetas de trabajo e importar recursos autorizados desde OneDrive para esta empresa.",
};

interface IntegrationsClientProps {
  connections: CloudStorageConnection[];
  organizationLabel: string;
}

export default function IntegrationsClient({
  connections: initialConnections,
  organizationLabel,
}: IntegrationsClientProps) {
  const [connections, setConnections] = useState(initialConnections);
  const [disconnectingProvider, setDisconnectingProvider] =
    useState<CloudStorageProvider | null>(null);

  const handleDisconnect = async (provider: CloudStorageProvider) => {
    setDisconnectingProvider(provider);
    try {
      const result = await disconnectCloudStorageAction(provider);
      if (!result.success) {
        toast.error(result.error || `No se pudo desvincular ${PROVIDER_LABELS[provider]}`);
        return;
      }

      setConnections((current) =>
        current.map((connection) =>
          connection.provider === provider
            ? { ...connection, connected: false, email: null }
            : connection,
        ),
      );
      toast.success(`${PROVIDER_LABELS[provider]} desvinculado para esta empresa`);
    } finally {
      setDisconnectingProvider(null);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white">Integraciones</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-[#94A3B8]">
          Administra cuentas de Drive y OneDrive para {organizationLabel}. Esta conexion solo aplica para esta empresa.
        </p>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {connections.map((connection) => (
          <section
            key={connection.provider}
            className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm transition hover:border-[#00D4B3]/40 dark:border-white/5 dark:bg-[#151A21]"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#00D4B3]/10 text-[#00A98F] dark:text-[#00D4B3]">
                  <Cloud size={24} />
                </div>
                <div>
                  <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                    {PROVIDER_LABELS[connection.provider]}
                  </h2>
                  <p className="mt-1 max-w-md text-sm text-gray-600 dark:text-slate-400">
                    {PROVIDER_COPY[connection.provider]}
                  </p>
                </div>
              </div>

              {connection.connected ? (
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

            {connection.connected && connection.email ? (
              <p className="mt-5 rounded-xl border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
                Conectado como {connection.email}
              </p>
            ) : null}

            {connection.needsReconnect ? (
              <p className="mt-5 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 shrink-0" size={16} />
                Hay una conexion legacy para tu usuario. Reconecta esta cuenta para usarla por empresa.
              </p>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-3">
              <CloudStorageConnectButton
                provider={connection.provider}
                className="inline-flex items-center gap-2 rounded-xl bg-[#1F5AF6] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[#1F5AF6]/15 transition hover:bg-[#1a4bd6]"
              >
                <RefreshCw size={16} />
                {connection.connected ? "Cambiar cuenta" : "Vincular cuenta"}
              </CloudStorageConnectButton>

              {connection.connected ? (
                <button
                  type="button"
                  disabled={disconnectingProvider === connection.provider}
                  onClick={() => handleDisconnect(connection.provider)}
                  className="inline-flex items-center gap-2 rounded-xl border border-red-500/30 px-4 py-2.5 text-sm font-semibold text-red-500 transition hover:bg-red-500/5 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-red-500/10"
                >
                  <Unplug size={16} />
                  {disconnectingProvider === connection.provider ? "Desvinculando..." : "Desvincular"}
                </button>
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
