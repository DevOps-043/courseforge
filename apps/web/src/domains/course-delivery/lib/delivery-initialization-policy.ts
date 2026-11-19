import { deliveryConfigSchema, type DeliveryConfig, type DeliveryWorkspace } from "../types/delivery.schemas";
import { deliveryHash } from "./delivery-hash";

export class DeliveryInitializationError extends Error {
  constructor(message: string, readonly status: 403 | 409) { super(message); this.name = "DeliveryInitializationError"; }
}

export function validateInitialDeliveryConfig(value: unknown, sessionsEnabled: boolean): DeliveryConfig {
  const input = value && typeof value === "object" && !Array.isArray(value) && "mode" in value && value.mode === "NEXUS"
    ? { ...value, ...deliveryConfigSchema.parse({}) } : value;
  const config = deliveryConfigSchema.parse(input ?? {});
  if (config.mode !== "NEXUS" && !sessionsEnabled) throw new DeliveryInitializationError("Las modalidades síncrona e híbrida no están habilitadas en este entorno.", 403);
  return config;
}

/** Solo inicializa; las ediciones posteriores siguen el flujo normal de revisión. */
export function initialDeliveryDocument(workspace: DeliveryWorkspace, config: DeliveryConfig) {
  if (workspace.revision > 0) {
    if (deliveryHash(workspace.document.config) !== deliveryHash(config)) throw new DeliveryInitializationError("El curso ya tiene otra configuración de modalidad. Revísala desde su ficha antes de cambiarla.", 409);
    return null;
  }
  return { ...workspace.document, config };
}
