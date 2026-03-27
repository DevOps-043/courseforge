import type { MaterialComponent, ValidationCheck } from "../types/materials.types";

export function validateSourcesUsage(
  components: MaterialComponent[],
  aptaSourceIds: string[],
): ValidationCheck {
  const usedSourceIds = components.flatMap((component) => component.source_refs);
  const uniqueUsed = [...new Set(usedSourceIds)];

  if (uniqueUsed.length === 0) {
    return {
      code: "CTRL4_NO_SOURCES_USED",
      message: "Los materiales no referencian ninguna fuente",
      pass: false,
      severity: "warning",
    };
  }

  const invalidSources = uniqueUsed.filter((id) => !aptaSourceIds.includes(id));

  if (invalidSources.length > 0) {
    return {
      code: "CTRL4_INVALID_SOURCES",
      message: `Fuentes no aptas utilizadas: ${invalidSources.join(", ")}`,
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL4_SOURCES_VALID",
    message: `${uniqueUsed.length} fuentes aptas utilizadas correctamente`,
    pass: true,
    severity: "error",
  };
}

export function validateNoNonAptaSources(
  components: MaterialComponent[],
  nonAptaSourceIds: string[],
): ValidationCheck {
  const usedSourceIds = components.flatMap((component) => component.source_refs);
  const usedNonApta = usedSourceIds.filter((id) => nonAptaSourceIds.includes(id));

  if (usedNonApta.length > 0) {
    return {
      code: "CTRL4_NON_APTA_USED",
      message: `Se utilizaron fuentes NO APTA: ${usedNonApta.join(", ")}`,
      pass: false,
      severity: "error",
    };
  }

  return {
    code: "CTRL4_NO_NON_APTA",
    message: "No se utilizaron fuentes NO APTA",
    pass: true,
    severity: "error",
  };
}

export function buildControl4Checks(
  components: MaterialComponent[],
  aptaSourceIds: string[],
  nonAptaSourceIds: string[],
) {
  return [
    validateSourcesUsage(components, aptaSourceIds),
    validateNoNonAptaSources(components, nonAptaSourceIds),
  ];
}
