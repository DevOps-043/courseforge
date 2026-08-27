import { createClient } from "@supabase/supabase-js";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { getHeygenClientForOrganization } from "./heygen-credential-resolver.service";
import { HeygenVideoService } from "./heygen-video.service";
import { heygenGenerateVideoRequestSchema } from "./heygen.validators";

const HEYGEN_BACKGROUND_REQUEST_TIMEOUT_MS = 120_000;

export interface HeygenAvatarVideoBackgroundRequest {
  createdBy: string;
  options: unknown;
  organizationId: string;
}

export async function runHeygenAvatarVideoBackground(
  request: HeygenAvatarVideoBackgroundRequest,
) {
  const options = heygenGenerateVideoRequestSchema.parse(request.options);
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const { data: component, error: componentError } = await supabase
    .from("material_components")
    .select("content, type")
    .eq("id", options.componentId)
    .maybeSingle();

  if (componentError) throw componentError;
  if (!component) throw new Error("Componente no encontrado para generar avatar.");

  const auth = await getHeygenClientForOrganization({
    allowGlobalFallback: false,
    createVideoMaxAttempts: 2,
    organizationId: request.organizationId,
    requestTimeoutMs: HEYGEN_BACKGROUND_REQUEST_TIMEOUT_MS,
    supabase,
  });
  const service = new HeygenVideoService(supabase, auth.client);
  return service.createAvatarVideoForComponent({
    componentContent: component.content,
    componentType: component.type || "UNKNOWN",
    createdBy: request.createdBy,
    options,
    organizationId: request.organizationId,
  });
}
