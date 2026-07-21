import type { Metadata } from "next";
import { Suspense } from "react";
import {
  WorkerDownloadPanel,
  type WorkerDownloadOption,
} from "./components/WorkerDownloadPanel";

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Descargas | SofLIA Engine Render Worker",
  description: "Descarga el worker local para ensamblar videos Remotion desde tu computadora.",
};

function readPublicEnv(name: string) {
  return process.env[name]?.trim() || "";
}

export default function DownloadsPage() {
  const fallbackDownloadUrl = readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_URL");
  const version = readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_VERSION") || "0.1.12";
  const options: WorkerDownloadOption[] = [
    {
      id: "windows",
      label: "Windows",
      description: "Instalador recomendado para equipos Windows de escritorio o laptop.",
      meta: ".exe",
      href: readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_WINDOWS_URL"),
    },
    {
      id: "macos",
      label: "macOS",
      description: "Paquete para equipos Mac usados como estaciones locales de render.",
      meta: ".dmg o .zip",
      href: readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_MACOS_URL"),
    },
    {
      id: "linux",
      label: "Linux",
      description: "Build para estaciones Linux dedicadas o equipos tecnicos de render.",
      meta: ".AppImage o .deb",
      href: readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_LINUX_URL"),
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
