export function getErrorMessage(
  error: unknown,
  fallbackMessage = "Unknown error",
) {
  return error instanceof Error ? error.message : fallbackMessage;
}
