"use client";

import { useEffect, useMemo, useState } from "react";
import { HardDrive } from "lucide-react";
import {
  disconnectCloudStorageAction,
  getCloudStorageConnectionsAction,
} from "@/domains/production/actions/cloud-storage.actions";
import { CloudStorageConnectButton } from "./CloudStorageConnectButton";
import { toast } from "sonner";
import type {
  CloudStorageConnection,
  CloudStorageProvider,
} from "@/domains/production/cloud-storage/types";

interface CloudStorageProviderSelectorProps {
  onProviderChange: (provider: CloudStorageProvider | null) => void;
}

const PROVIDER_LABELS: Record<CloudStorageProvider, string> = {
  google_drive: "Google Drive",
  onedrive: "OneDrive",
};

export function CloudStorageProviderSelector({
  onProviderChange,
}: CloudStorageProviderSelectorProps) {
  const [connections, setConnections] = useState<CloudStorageConnection[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<CloudStorageProvider | null>(null);
  const [disconnectingProvider, setDisconnectingProvider] = useState<CloudStorageProvider | null>(null);

  const loadConnections = async () => {
    const response = await getCloudStorageConnectionsAction();
    const nextConnections = response.connections;
    setConnections(nextConnections);

    const firstConnected = nextConnections.find((connection) => connection.connected)?.provider || null;
    setSelectedProvider((currentProvider) => {
      if (
        currentProvider &&
        nextConnections.some((connection) => connection.provider === currentProvider && connection.connected)
      ) {
        return currentProvider;
      }

      return firstConnected;
    });
  };

  useEffect(() => {
    loadConnections();
  }, []);

  useEffect(() => {
    onProviderChange(selectedProvider);
  }, [onProviderChange, selectedProvider]);

  const connectedProviders = useMemo(
    () => connections.filter((connection) => connection.connected),
    [connections],
  );

  const handleProviderChange = (provider: CloudStorageProvider | null) => {
    setSelectedProvider(provider);
  };

  const handleDisconnect = async (provider: CloudStorageProvider) => {
    setDisconnectingProvider(provider);
    try {
      const result = await disconnectCloudStorageAction(provider);
      if (!result.success) {
        toast.error(result.error || `No se pudo desvincular ${PROVIDER_LABELS[provider]}`);
        return;
      }

      toast.success(`${PROVIDER_LABELS[provider]} desvinculado`);
      if (selectedProvider === provider) {
        handleProviderChange(null);
      }
      await loadConnections();
    } finally {
      setDisconnectingProvider(null);
    }
  };

  if (connectedProviders.length === 0) {
    return (
      <div className="flex flex-col gap-2 pt-3 border-t border-gray-100 dark:border-white/5">
        <span className="text-xs text-gray-500 dark:text-slate-400 flex items-center gap-1.5 select-none">
          <HardDrive size={14} className="text-gray-400" />
          No hay almacenamiento cloud conectado
        </span>
        <div className="flex flex-wrap gap-3">
          <CloudStorageConnectButton provider="google_drive" className="text-xs text-[#00D4B3] hover:underline font-semibold">
            Conectar Google Drive
          </CloudStorageConnectButton>
          <CloudStorageConnectButton provider="onedrive" className="text-xs text-[#00D4B3] hover:underline font-semibold">
            Conectar OneDrive
          </CloudStorageConnectButton>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-3 border-t border-gray-100 dark:border-white/5">
      <label className="text-xs uppercase tracking-wider text-gray-500 dark:text-[#6C757D] font-bold">
        Sincronizar carpetas de assets
      </label>
      <div className="space-y-2">
        <label className="flex items-center gap-3 text-sm text-gray-700 dark:text-slate-300 font-medium cursor-pointer">
          <input
            type="radio"
            name="cloudStorageProvider"
            checked={selectedProvider === null}
            onChange={() => handleProviderChange(null)}
            className="h-4 w-4 border-gray-300 text-[#00D4B3] focus:ring-[#00D4B3]"
          />
          <span>No sincronizar</span>
        </label>

        {connectedProviders.map((connection) => (
          <div
            key={connection.provider}
            className="flex items-center justify-between gap-3 rounded-lg border border-gray-100 px-3 py-2 dark:border-white/5"
          >
            <label className="flex min-w-0 flex-1 items-center gap-3 text-sm text-gray-700 dark:text-slate-300 font-medium cursor-pointer">
              <input
                type="radio"
                name="cloudStorageProvider"
                checked={selectedProvider === connection.provider}
                onChange={() => handleProviderChange(connection.provider)}
                className="h-4 w-4 border-gray-300 text-[#00D4B3] focus:ring-[#00D4B3]"
              />
              <span className="flex min-w-0 items-center gap-1.5">
                <HardDrive size={14} className="shrink-0 text-[#00D4B3]" />
                <span className="shrink-0">{PROVIDER_LABELS[connection.provider]}</span>
                {connection.email && (
                  <span className="truncate text-xs text-gray-500 dark:text-slate-400">
                    ({connection.email})
                  </span>
                )}
              </span>
            </label>
            <button
              type="button"
              onClick={() => handleDisconnect(connection.provider)}
              disabled={disconnectingProvider === connection.provider}
              className="shrink-0 text-xs font-semibold text-red-500 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
            >
              {disconnectingProvider === connection.provider ? "Desvinculando..." : "Desvincular"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
