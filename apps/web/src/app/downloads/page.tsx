import type { Metadata } from "next";
import { Suspense } from "react";
import {
  WorkerDownloadPanel,
  type WorkerDownloadOption,
} from "./components/WorkerDownloadPanel";

const DOWNLOADS_REVALIDATE_SECONDS = 600;

export const revalidate = 600;

export const metadata: Metadata = {
  title: "Descargas | SofLIA Engine Render Worker",
  description: "Descarga el worker local para ensamblar videos desde tu computadora.",
};

function readPublicEnv(name: string) {
  return process.env[name]?.trim() || "";
}

const WORKER_RELEASE_API_URL = "https://api.github.com/repos/DevOps-043/SofLIA-desktop_cli/releases/latest";
const WORKER_RELEASE_BASE_URL = "https://github.com/DevOps-043/SofLIA-desktop_cli/releases/latest/download";
const LEGACY_VERSIONED_WORKER_RELEASE_URL = "github.com/DevOps-043/SofLIA-desktop_cli/releases/download/";

const officialAssetNames = {
  windows: "SofLIA-Engine-Render-Worker-Windows-x64.exe",
  macos: "SofLIA-Engine-Render-Worker-macOS-arm64.dmg",
  linux: "SofLIA-Engine-Render-Worker-Linux-x64.AppImage",
};

const officialDownloadUrls = {
  windows: `${WORKER_RELEASE_BASE_URL}/${officialAssetNames.windows}`,
  macos: `${WORKER_RELEASE_BASE_URL}/${officialAssetNames.macos}`,
  linux: `${WORKER_RELEASE_BASE_URL}/${officialAssetNames.linux}`,
};

interface LatestWorkerRelease {
  assetUrls: Partial<Record<WorkerDownloadOption["id"], string>>;
  version: string;
}

interface GitHubReleaseAssetPayload {
  browser_download_url?: unknown;
  name?: unknown;
}

interface GitHubReleasePayload {
  assets?: unknown;
  tag_name?: unknown;
}

function normalizeReleaseVersion(tagName: unknown) {
  if (typeof tagName !== "string") return "";
  return tagName.trim().replace(/^v/i, "");
}

function extractReleaseAssetUrls(assets: unknown): LatestWorkerRelease["assetUrls"] {
  if (!Array.isArray(assets)) return {};

  return assets.reduce<LatestWorkerRelease["assetUrls"]>((urls, asset: GitHubReleaseAssetPayload) => {
    if (typeof asset?.name !== "string" || typeof asset.browser_download_url !== "string") return urls;

    if (asset.name === officialAssetNames.windows) urls.windows = asset.browser_download_url;
    if (asset.name === officialAssetNames.macos) urls.macos = asset.browser_download_url;
    if (asset.name === officialAssetNames.linux) urls.linux = asset.browser_download_url;

    return urls;
  }, {});
}

async function getLatestWorkerRelease(): Promise<LatestWorkerRelease | null> {
  try {
    const response = await fetch(WORKER_RELEASE_API_URL, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "SofLIA-Engine-Downloads",
      },
      next: { revalidate: DOWNLOADS_REVALIDATE_SECONDS },
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as GitHubReleasePayload;
    const version = normalizeReleaseVersion(payload.tag_name);
    if (!version) return null;

    return {
      assetUrls: extractReleaseAssetUrls(payload.assets),
      version,
    };
  } catch {
    return null;
  }
}

function resolveWorkerDownloadUrl(
  envName: string,
  releaseAssetUrl: string | undefined,
  officialUrl: string,
) {
  const configuredUrl = readPublicEnv(envName);
  if (!configuredUrl) return releaseAssetUrl || officialUrl;
  if (configuredUrl.includes(LEGACY_VERSIONED_WORKER_RELEASE_URL)) return officialUrl;
  return configuredUrl;
}

export default async function DownloadsPage() {
  const latestRelease = await getLatestWorkerRelease();
  const fallbackDownloadUrl = resolveWorkerDownloadUrl(
    "NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_URL",
    latestRelease?.assetUrls.windows,
    officialDownloadUrls.windows,
  );
  const version = latestRelease?.version || readPublicEnv("NEXT_PUBLIC_SOFLIA_WORKER_VERSION") || "latest";
  const options: WorkerDownloadOption[] = [
    {
      id: "windows",
      label: "Windows",
      description: "Instalador recomendado para equipos Windows de escritorio o laptop.",
      meta: ".exe",
      href: resolveWorkerDownloadUrl(
        "NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_WINDOWS_URL",
        latestRelease?.assetUrls.windows,
        officialDownloadUrls.windows,
      ),
    },
    {
      id: "macos",
      label: "macOS",
      description: "Paquete para equipos Mac usados como estaciones locales de render.",
      meta: ".dmg o .zip",
      href: resolveWorkerDownloadUrl(
        "NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_MACOS_URL",
        latestRelease?.assetUrls.macos,
        officialDownloadUrls.macos,
      ),
    },
    {
      id: "linux",
      label: "Linux",
      description: "Build para estaciones Linux dedicadas o equipos tecnicos de render.",
      meta: ".AppImage o .deb",
      href: resolveWorkerDownloadUrl(
        "NEXT_PUBLIC_SOFLIA_WORKER_DOWNLOAD_LINUX_URL",
        latestRelease?.assetUrls.linux,
        officialDownloadUrls.linux,
      ),
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
