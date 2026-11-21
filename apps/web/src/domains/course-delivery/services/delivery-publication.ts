import type { SupabaseClient } from "@supabase/supabase-js";
import { readDeliveryContext, readDeliveryWorkspace } from "./delivery-repository";
import { deliveryReadiness } from "./delivery-readiness";
import { deliveryEnabled } from "../config/delivery-enabled";

export async function assertDeliveryPublicationReady(admin: SupabaseClient, artifactId: string, organizationId: string) {
  const workspace = await readDeliveryWorkspace(admin, artifactId, organizationId);
  if (workspace.document.config.mode === "NEXUS") return;
  if (workspace.document.config.mode === "SYNCHRONOUS") throw new Error("Utiliza la entrega del paquete sincrónico desde Engine.");
  if (!deliveryEnabled()) throw new Error("La autoría híbrida está temporalmente deshabilitada.");
  const context = await readDeliveryContext(admin, artifactId, organizationId);
  if (!deliveryReadiness(workspace.document, context).materialsReady) throw new Error("El paquete híbrido debe estar aprobado y vigente antes de publicar Nexus.");
  // La aplicación desde staging ignora el recorrido y usa identidades posicionales.
  // Impedir una entrega que aparentaría éxito perdiendo orden o progreso.
  throw new Error("La publicación híbrida requiere el contrato de recorrido compatible en Academy. La preparación de sesiones puede entregarse a Hub por separado.");
}
