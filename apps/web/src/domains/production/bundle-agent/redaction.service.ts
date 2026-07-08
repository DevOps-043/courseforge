const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{16,}\b/g, "sk-[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{20,}\b/g, "AIza[redacted]"],
  [/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, "jwt-[redacted]"],
  [/(OPENAI_API_KEY|GOOGLE_GENERATIVE_AI_API_KEY|SUPABASE_SERVICE_ROLE_KEY|AWS_SECRET_ACCESS_KEY)\s*=\s*[^\s]+/gi, "$1=[redacted]"],
  [/(password|passwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^"'\s]+/gi, "$1=[redacted]"],
];

export function redactSensitiveText(value: string): string {
  return SECRET_PATTERNS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getStringField(value: Record<string, unknown>, key: string): string | null {
  const field = value[key];
  return typeof field === "string" && field.trim().length > 0 ? field.trim() : null;
}

function stringifyErrorObject(error: Record<string, unknown>): string {
  const parts = [
    getStringField(error, "message"),
    getStringField(error, "details"),
    getStringField(error, "hint"),
    getStringField(error, "code") ? `code: ${getStringField(error, "code")}` : null,
    getStringField(error, "status") ? `status: ${getStringField(error, "status")}` : null,
  ].filter(Boolean);

  if (parts.length > 0) {
    return parts.join(" ");
  }

  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown error";
  }
}

function withOperationalHint(message: string): string {
  const normalized = message.toLowerCase();
  const looksLikeMissingAgentMigration =
    normalized.includes("soflia_bundle_") &&
    (normalized.includes("does not exist") || normalized.includes("not found") || normalized.includes("42p01"));

  if (!looksLikeMissingAgentMigration) {
    return message;
  }

  return `${message}. Falta aplicar la migracion 20260707120000_create_soflia_bundle_agent.sql en la base de datos activa.`;
}

export function sanitizeErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : isRecord(error)
        ? stringifyErrorObject(error)
        : typeof error === "string" && error.trim().length > 0
          ? error
          : "Unknown error";

  return redactSensitiveText(withOperationalHint(message)).slice(0, 2000);
}
