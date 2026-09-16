import { randomUUID } from "node:crypto";

type LogLevel = "error" | "info" | "warn";
type LogContext = Record<string, unknown>;

const CORRELATION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SENSITIVE_KEY_PATTERN = /authorization|cookie|credential|email|password|secret|token|api[-_]?key/i;
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const MAX_LOG_STRING_LENGTH = 500;

export function resolveCorrelationId(candidate?: string | null) {
  return candidate && CORRELATION_ID_PATTERN.test(candidate) ? candidate : randomUUID();
}

function sanitizeString(value: string) {
  return value
    .replace(EMAIL_PATTERN, "[REDACTED_EMAIL]")
    .replace(BEARER_PATTERN, "Bearer [REDACTED]")
    .slice(0, MAX_LOG_STRING_LENGTH);
}

export function sanitizeLogValue(value: unknown, key = "", depth = 0): unknown {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (depth > 4) return "[TRUNCATED]";
  if (value instanceof Error) {
    return { name: value.name, message: sanitizeString(value.message) };
  }
  if (typeof value === "string") return sanitizeString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 25).map((item) => sanitizeLogValue(item, key, depth + 1));
  if (typeof value === "object" && value) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([childKey, child]) => [childKey, sanitizeLogValue(child, childKey, depth + 1)]),
    );
  }
  return String(value);
}

export function createOperationalLogger(component: string, baseContext: LogContext = {}) {
  const write = (level: LogLevel, event: string, context: LogContext = {}) => {
    const record = sanitizeLogValue({
      timestamp: new Date().toISOString(),
      level,
      component,
      event,
      ...baseContext,
      ...context,
    });
    const serialized = JSON.stringify(record);
    if (level === "error") console.error(serialized);
    else if (level === "warn") console.warn(serialized);
    else console.log(serialized);
  };

  return {
    error: (event: string, error: unknown, context: LogContext = {}) => write("error", event, { ...context, error }),
    info: (event: string, context: LogContext = {}) => write("info", event, context),
    warn: (event: string, context: LogContext = {}) => write("warn", event, context),
  };
}
