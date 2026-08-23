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
import { HeygenIntegrationCard } from "./HeygenIntegrationCard";

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
      <div className="engine-page-hero">
        <p className="engine-eyebrow">Ecosistema conectado</p>
        <h1 className="text-3xl">Integraciones</h1>
        <p className="mt-2 max-w-3xl text-sm">
          Administra servicios externos para {organizationLabel}. Estas conexiones solo aplican para esta empresa.
        </p>
      </div>

      <div className="engine-integration-registry">
        <div className="engine-integration-registry__header">
          <div>
            <p className="engine-eyebrow !mb-1 !text-[var(--engine-text-muted)]">Directorio de servicios</p>
            <h2>Conectores de la organización</h2>
          </div>
          <span>{connections.length + 1} proveedores</span>
        </div>
        {connections.map((connection) => (
          <section
            key={connection.provider}
            className="engine-integration-row"
          >
            <div className="engine-integration-row__main">
              <div className="flex items-start gap-4">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)] dark:text-[var(--engine-accent)]">
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

            <div className="engine-integration-row__details">
            {connection.connected && connection.email ? (
              <p className="engine-integration-note engine-integration-note--success">
                Conectado como {connection.email}
              </p>
            ) : null}

            {connection.needsReconnect ? (
              <p className="engine-integration-note engine-integration-note--warning">
                <TriangleAlert className="mt-0.5 shrink-0" size={16} />
                Hay una conexion legacy para tu usuario. Reconecta esta cuenta para usarla por empresa.
              </p>
            ) : null}

            </div>

            <div className="engine-integration-row__actions">
              <CloudStorageConnectButton
                provider={connection.provider}
                className="engine-button engine-button--primary"
              >
                <RefreshCw size={16} />
                {connection.connected ? "Cambiar cuenta" : "Vincular cuenta"}
              </CloudStorageConnectButton>

              {connection.connected ? (
                <button
                  type="button"
                  disabled={disconnectingProvider === connection.provider}
                  onClick={() => handleDisconnect(connection.provider)}
                  className="engine-button engine-button--danger"
                >
                  <Unplug size={16} />
                  {disconnectingProvider === connection.provider ? "Desvinculando..." : "Desvincular"}
                </button>
              ) : null}
            </div>
          </section>
        ))}
        <HeygenIntegrationCard />
      </div>
    </div>
  );
}
