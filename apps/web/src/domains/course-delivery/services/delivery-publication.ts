import type { SupabaseClient } from "@supabase/supabase-js";
import { readDeliveryContext, readDeliveryWorkspace } from "./delivery-repository";
import { deliveryReadiness } from "./delivery-readiness";
import { deliveryEnabled } from "../config/delivery-enabled";
import { deliveryPublicationBlock } from "../lib/delivery-publication-block";

export async function assertDeliveryPublicationReady(admin: SupabaseClient, artifactId: string, organizationId: string) {
  const workspace = await readDeliveryWorkspace(admin, artifactId, organizationId);
  const mode = workspace.document.config.mode;
  const block = deliveryPublicationBlock(mode);
  if (!block) return;
  if (mode === "SYNCHRONOUS") throw new Error(block);
  if (!deliveryEnabled()) throw new Error("La autoría híbrida está temporalmente deshabilitada.");
  const context = await readDeliveryContext(admin, artifactId, organizationId);
  if (!deliveryReadiness(workspace.document, context).materialsReady) throw new Error("El paquete híbrido debe estar aprobado y vigente antes de publicar Nexus.");
  // La aplicación desde staging ignora el recorrido y usa identidades posicionales.
  // Impedir una entrega que aparentaría éxito perdiendo orden o progreso.
  throw new Error(block);
}
