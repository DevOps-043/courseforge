import { getAppUrl, getDeploymentSiteUrl } from "@/lib/server/env";

function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().replace(/\/+$/, "");
}

export function getProductionApiBaseUrl(): string {
  if (process.env.RENDER_PROVIDER === "desktop_worker") {
    const desktopWorkerBaseUrl =
      normalizeBaseUrl(process.env.PRODUCTION_API_URL) ||
      normalizeBaseUrl(process.env.SOFLIA_ENGINE_WEB_URL) ||
      (process.env.NODE_ENV !== "production"
        ? normalizeBaseUrl(process.env.URL) || "http://localhost:3000"
        : normalizeBaseUrl(getAppUrl() || getDeploymentSiteUrl()));

    if (desktopWorkerBaseUrl) {
      return desktopWorkerBaseUrl;
    }
  }

  const configured =
    normalizeBaseUrl(process.env.PRODUCTION_API_URL) ||
    normalizeBaseUrl(process.env.EXPRESS_INTERNAL_API_URL) ||
    normalizeBaseUrl(process.env.API_PUBLIC_URL) ||
    normalizeBaseUrl(process.env.EXPRESS_API_URL);

  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV !== "production") {
    return "http://localhost:4000";
  }

  const netlifyWebUrl = normalizeBaseUrl(getAppUrl() || getDeploymentSiteUrl());
  if (netlifyWebUrl) {
    return netlifyWebUrl;
  }

  throw new Error("Missing production API URL or deployment site URL.");
}

