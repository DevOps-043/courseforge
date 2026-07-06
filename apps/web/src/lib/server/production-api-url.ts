function normalizeBaseUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  return value.trim().replace(/\/+$/, "");
}

export function getProductionApiBaseUrl(): string {
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

  throw new Error(
    "Missing production API URL. Configure API_PUBLIC_URL or PRODUCTION_API_URL with the public HTTPS URL of the render API.",
  );
}

