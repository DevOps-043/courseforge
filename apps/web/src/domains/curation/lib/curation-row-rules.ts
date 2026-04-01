import type { CurationRow } from "../types/curation.types";

export const SYSTEM_GENERATED_CURATION_ROW_FILTER =
  "auto_evaluated.eq.true,source_rationale.eq.GPT_GENERATED";

export function isSystemGeneratedCurationRow(row: CurationRow) {
  return row.auto_evaluated === true || row.source_rationale === "GPT_GENERATED";
}
