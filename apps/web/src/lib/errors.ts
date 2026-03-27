export function getErrorMessage(
  error: unknown,
  fallbackMessage = "Unknown error",
) {
  return error instanceof Error ? error.message : fallbackMessage;
}

export function getErrorDetails(error: unknown) {
  if (error instanceof Error) {
    return { error_name: error.name, stack: error.stack };
  }

  return { error_name: "UnknownError" };
}
