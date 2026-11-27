import type { DeliveryConfig } from "../types/delivery.schemas";

export function deliveryPublicationBlock(mode: DeliveryConfig["mode"] | undefined): string | null {
  switch (mode) {
    case "NEXUS":
      return null;
    case "SYNCHRONOUS":
      return "Usa el panel de preparación para entregar una sesión programada en Academy.";
    case "HYBRID":
      return "El envío del taller híbrido requiere la aprobación v2 en Academy y un emisor compatible en Architect.";
    default:
      return "Confirma la modalidad del curso antes de enviar.";
  }
}
