function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function resolveInstructionalPlanAudience(input: {
  descripcion?: unknown;
  generation_metadata?: unknown;
}) {
  const description = isRecord(input.descripcion) ? input.descripcion : null;
  const generatedAudience = readNonEmptyString(description?.publico_objetivo);
  if (generatedAudience) return generatedAudience;

  const metadata = isRecord(input.generation_metadata)
    ? input.generation_metadata
    : null;
  const originalInput = isRecord(metadata?.original_input)
    ? metadata.original_input
    : null;

  return readNonEmptyString(originalInput?.targetAudience) || "General";
}
