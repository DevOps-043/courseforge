import type { CurationRow } from "../types/curation.types";

export const DEFAULT_PROMPT_PREVIEW =
  "Prompt optimizado con reglas de curaduria, enfoque en accesibilidad, validacion de URLs, salida JSON estructurada y busquedas web en tiempo real.";

export function rowNeedsValidation(row: CurationRow) {
  const reportStatus = row.validation_report?.status;
  if (reportStatus) {
    return reportStatus === "pending" || reportStatus === "review_required";
  }
  const hasSearchRedirect =
    row.source_ref &&
    (row.source_ref.includes("vertexaisearch.cloud.google.com") ||
      row.source_ref.includes("grounding-api-redirect"));

  return !row.auto_evaluated || hasSearchRedirect;
}

export function getPendingValidationCount(rows: CurationRow[]) {
  return rows.filter(rowNeedsValidation).length;
}
