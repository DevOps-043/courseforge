export function getErrorMessage(
  error: unknown,
  fallbackMessage = "Unknown error",
) {
  if (error instanceof Error) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallbackMessage;
}

export function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return { error_name: error.name, stack: error.stack };
  }

  if (error && typeof error === "object") {
    const candidate = error as Record<string, unknown>;
    return {
      code: typeof candidate.code === "string" ? candidate.code : undefined,
      details: candidate.details,
      error_name: typeof candidate.name === "string" ? candidate.name : "StructuredError",
      hint: typeof candidate.hint === "string" ? candidate.hint : undefined,
    };
  }

  return { error_name: "UnknownError" };
}
