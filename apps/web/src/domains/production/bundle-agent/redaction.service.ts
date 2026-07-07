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

export function sanitizeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  return redactSensitiveText(message).slice(0, 2000);
}
