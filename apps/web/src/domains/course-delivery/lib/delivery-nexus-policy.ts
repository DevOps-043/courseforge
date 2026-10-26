import type { DeliveryConfig, DeliveryOperation } from "../types/delivery.schemas";

export function nexusGenerationRequired(mode: DeliveryConfig["mode"], operation: DeliveryOperation, state?: string | null) {
  if (mode !== "HYBRID" || operation === "AGENDA") return false;
  const reusable = operation === "PLAN"
    ? ["STEP_READY_FOR_REVIEW", "STEP_APPROVED", "STEP_PROCESSING"]
    : ["PHASE3_READY_FOR_QA", "PHASE3_APPROVED", "PHASE3_GENERATING"];
  return !reusable.includes(state || "");
}
