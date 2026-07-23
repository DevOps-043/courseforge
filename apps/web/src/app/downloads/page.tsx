import type { Metadata } from "next";
import { Suspense } from "react";
import {
  WorkerDownloadPanel,
  type WorkerDownloadOption,
} from "./components/WorkerDownloadPanel";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Descargas | SofLIA Engine Render Worker",
  description: "Descarga el worker local para ensamblar videos desde tu computadora.",
};

function readPublicEnv(name: string) {
  return process.env[name]?.trim() || "";
}

const WORKER_RELEASE_BASE_URL = "https://github.com/DevOps-043/SofLIA-desktop_cli/releases/latest/download";
const LEGACY_VERSIONED_WORKER_RELEASE_URL = "github.com/DevOps-043/SofLIA-desktop_cli/releases/download/";

const officialDownloadUrls = {
  windows: `${WORKER_RELEASE_BASE_URL}/SofLIA-Engine-Render-Worker-Windows-x64.exe`,
  macos: `${WORKER_RELEASE_BASE_URL}/SofLIA-Engine-Render-Worker-macOS-arm64.dmg`,
  linux: `${WORKER_RELEASE_BASE_URL}/SofLIA-Engine-Render-Worker-Linux-x64.AppImage`,
};

function resolveWorkerDownloadUrl(envName: string, officialUrl: string) {
  const configuredUrl = readPublicEnv(envName);
  if (!configuredUrl) return officialUrl;
  if (configuredUrl.includes(LEGACY_VERSIONED_WORKER_RELEASE_URL)) return officialUrl;
  return configuredUrl;
}

export default function DownloadsPage() {
  const fallbackDownloadUrl = resolveWorkerDownloadUrl(
    "NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_URL",
    officialDownloadUrls.windows,
  );
  const version = readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_VERSION") || "0.2.0";
  const options: WorkerDownloadOption[] = [
    {
      id: "windows",
      label: "Windows",
      description: "Instalador recomendado para equipos Windows de escritorio o laptop.",
      meta: ".exe",
      href: resolveWorkerDownloadUrl("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_WINDOWS_URL", officialDownloadUrls.windows),
    },
    {
      id: "macos",
      label: "macOS",
      description: "Paquete para equipos Mac usados como estaciones locales de render.",
      meta: ".dmg o .zip",
      href: resolveWorkerDownloadUrl("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_MACOS_URL", officialDownloadUrls.macos),
    },
    {
      id: "linux",
      label: "Linux",
      description: "Build para estaciones Linux dedicadas o equipos tecnicos de render.",
      meta: ".AppImage o .deb",
      href: resolveWorkerDownloadUrl("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_LINUX_URL", officialDownloadUrls.linux),
    },
  ];

  return (
    <Suspense>
      <WorkerDownloadPanel
        fallbackDownloadUrl={fallbackDownloadUrl}
        options={options}
        version={version}
      />
    </Suspense>
  );
}
