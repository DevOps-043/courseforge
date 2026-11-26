import type { SupabaseClient } from "@supabase/supabase-js";
import { deliveryEnabled } from "../config/delivery-enabled";
import { initialDeliveryDocument, validateInitialDeliveryConfig } from "../lib/delivery-initialization-policy";
import { readDeliveryWorkspace, saveDeliveryWorkspace } from "./delivery-repository";

export async function initializeArtifactDelivery(admin: SupabaseClient, artifactId: string, organizationId: string, value: unknown) {
  const config = validateInitialDeliveryConfig(value, deliveryEnabled());
  // Nexus mantiene la creación anterior incluso antes de instalar el esquema de sesiones.
  if (config.mode === "NEXUS") return;
  const workspace = await readDeliveryWorkspace(admin, artifactId, organizationId);
  const document = initialDeliveryDocument(workspace, config);
  if (document) await saveDeliveryWorkspace(admin, workspace, document);
}
