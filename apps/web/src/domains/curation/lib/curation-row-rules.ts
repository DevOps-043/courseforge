import type { CurationRow } from "../types/curation.types";

export const SYSTEM_GENERATED_CURATION_ROW_FILTER =
  "origin.eq.automatic";

export function isSystemGeneratedCurationRow(row: CurationRow) {
  return row.origin ? row.origin === "automatic" : row.auto_evaluated === true;
}
