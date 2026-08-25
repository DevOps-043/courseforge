import { createClient } from "@supabase/supabase-js";
import { getErrorMessage } from "@/lib/errors";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import { getHeygenClientForOrganization } from "./heygen-credential-resolver.service";
import { HeygenScenesService } from "./heygen-scenes.service";
import {
  heygenGenerateClipsRequestSchema,
} from "./heygen.validators";

const HEYGEN_BACKGROUND_REQUEST_TIMEOUT_MS = 120_000;

export interface HeygenAvatarClipsBackgroundRequest {
  createdBy: string;
  options: unknown;
  organizationId: string;
}

export async function runHeygenAvatarClipsBackground(
  request: HeygenAvatarClipsBackgroundRequest,
) {
  const options = heygenGenerateClipsRequestSchema.parse(request.options);
  const supabase = createClient(getSupabaseUrl(), getSupabaseServiceRoleKey());
  const fallbackService = new HeygenScenesService(supabase);

  try {
    const auth = await getHeygenClientForOrganization({
      allowGlobalFallback: false,
      createVideoMaxAttempts: 2,
      organizationId: request.organizationId,
      requestTimeoutMs: HEYGEN_BACKGROUND_REQUEST_TIMEOUT_MS,
      supabase,
    });
    const service = new HeygenScenesService(supabase, auth.client);
    return await service.generateSceneClips({
      createdBy: request.createdBy,
      options,
      organizationId: request.organizationId,
    });
  } catch (error) {
    const message = getErrorMessage(error, "No se pudo enviar el lote de avatares.");
    await fallbackService.markQueuedSceneClipsFailed({
      clipIds: options.clipIds,
      componentId: options.componentId,
      errorMessage: message,
    }).catch(() => undefined);
    console.error("[HeyGen Avatar Background] Failed:", {
      componentId: options.componentId,
      message,
    });
    throw error;
  }
}
