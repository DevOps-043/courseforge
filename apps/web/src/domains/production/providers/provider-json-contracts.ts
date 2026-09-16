type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown, label: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} devolvio un objeto JSON invalido.`);
  }
  return value as JsonRecord;
}

function requiredString(record: JsonRecord, key: string, label: string) {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} no incluyo ${key}.`);
  }
  return value;
}

function optionalString(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "string" && value.trim() ? value : undefined;
}

function optionalFiniteNumber(record: JsonRecord, key: string) {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

interface AccessTokenPayload {
  accessToken: string;
  expiresIn?: number;
  refreshToken?: string;
}

interface ExpiringAccessTokenPayload extends AccessTokenPayload {
  expiresIn: number;
}

export function parseAccessTokenPayload(
  value: unknown,
  label: string,
  requireExpiry: true,
): ExpiringAccessTokenPayload;
export function parseAccessTokenPayload(
  value: unknown,
  label: string,
  requireExpiry?: false,
): AccessTokenPayload;
export function parseAccessTokenPayload(
  value: unknown,
  label: string,
  requireExpiry = false,
): AccessTokenPayload {
  const record = asRecord(value, label);
  const expiresIn = optionalFiniteNumber(record, "expires_in");
  if (requireExpiry && (!expiresIn || expiresIn <= 0)) {
    throw new Error(`${label} no incluyo expires_in valido.`);
  }
  return {
    accessToken: requiredString(record, "access_token", label),
    expiresIn,
    refreshToken: optionalString(record, "refresh_token"),
  };
}

export function parseArtlistSearchResultsEnvelope(value: unknown) {
  const record = asRecord(value, "Artlist");
  return record.results;
}

export function parseArtlistDownloadPayload(value: unknown) {
  const record = asRecord(value, "Artlist");
  return {
    downloadUrl: optionalString(record, "download_url"),
    duration: optionalFiniteNumber(record, "duration"),
  };
}

export interface GoogleDriveFilePayload {
  id: string;
  mimeType: string;
  name: string;
  size?: number;
}

function parseGoogleDriveFile(value: unknown): GoogleDriveFilePayload | null {
  try {
    const record = asRecord(value, "Google Drive");
    const rawSize = optionalString(record, "size");
    const size = rawSize === undefined ? undefined : Number(rawSize);
    return {
      id: requiredString(record, "id", "Google Drive"),
      mimeType: requiredString(record, "mimeType", "Google Drive"),
      name: requiredString(record, "name", "Google Drive"),
      ...(Number.isFinite(size) && size! >= 0 ? { size } : {}),
    };
  } catch {
    return null;
  }
}

export function parseGoogleDriveFileList(value: unknown) {
  const record = asRecord(value, "Google Drive");
  if (!Array.isArray(record.files)) {
    throw new Error("Google Drive no incluyo un listado de archivos valido.");
  }
  return record.files
    .map(parseGoogleDriveFile)
    .filter((file): file is GoogleDriveFilePayload => file !== null);
}

export function parseGoogleDriveMetadata(value: unknown) {
  const record = asRecord(value, "Google Drive");
  return {
    mimeType: optionalString(record, "mimeType"),
    name: optionalString(record, "name"),
    size: optionalString(record, "size"),
  };
}

export function parseGoogleDriveFolder(value: unknown) {
  return { id: requiredString(asRecord(value, "Google Drive"), "id", "Google Drive") };
}

export function parseGoogleAccountProfile(value: unknown) {
  return {
    email: requiredString(asRecord(value, "Google"), "email", "Google"),
  };
}

export interface MicrosoftGraphItemPayload {
  id: string;
  isFolder: boolean;
  mimeType?: string;
  name: string;
  size?: number;
  webUrl?: string;
}

export function parseMicrosoftGraphItem(value: unknown): MicrosoftGraphItemPayload {
  const record = asRecord(value, "Microsoft Graph");
  const file = typeof record.file === "object" && record.file !== null && !Array.isArray(record.file)
    ? record.file as JsonRecord
    : undefined;
  return {
    id: requiredString(record, "id", "Microsoft Graph"),
    isFolder: record.folder !== undefined && record.folder !== null,
    mimeType: file ? optionalString(file, "mimeType") : undefined,
    name: requiredString(record, "name", "Microsoft Graph"),
    size: optionalFiniteNumber(record, "size"),
    webUrl: optionalString(record, "webUrl"),
  };
}

export function parseMicrosoftGraphItemList(value: unknown) {
  const record = asRecord(value, "Microsoft Graph");
  if (!Array.isArray(record.value)) {
    throw new Error("Microsoft Graph no incluyo un listado de archivos valido.");
  }
  return record.value.flatMap((item) => {
    try {
      return [parseMicrosoftGraphItem(item)];
    } catch {
      return [];
    }
  });
}

export function parseMicrosoftAccountProfile(value: unknown) {
  const record = asRecord(value, "Microsoft Graph");
  const email = optionalString(record, "mail")
    ?? optionalString(record, "userPrincipalName");
  if (!email) {
    throw new Error("Microsoft Graph no incluyo un email de cuenta.");
  }
  return { email };
}
