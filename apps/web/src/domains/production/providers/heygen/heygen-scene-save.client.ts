import type { AvatarClip, MaterialAssets, VoiceClip } from "../../../materials/types/materials.types";
import { readApiResponse } from "../../../../lib/client/api-response";
import { heygenEditableAvatarClipSchema } from "./heygen.validators";

const SCENE_SAVE_TIMEOUT_MS = 30_000;

export async function saveHeygenSceneEdits(
  request: {
    avatarGenerationMode: MaterialAssets["avatar_generation_mode"];
    clips: AvatarClip[];
    componentId: string;
  },
  fetchImpl: typeof fetch = fetch,
): Promise<{ clips: AvatarClip[]; voiceClips: VoiceClip[] }> {
  let response: Response;
  try {
    response = await fetchImpl("/api/production/heygen/scenes", {
      body: JSON.stringify(request),
      headers: { "Content-Type": "application/json" },
      method: "PATCH",
      signal: AbortSignal.timeout(SCENE_SAVE_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
      throw new Error("No se pudo confirmar el guardado a tiempo. Recarga las escenas para comprobarlo antes de volver a guardar.");
    }
    throw new Error("No se pudo confirmar el guardado. Revisa la conexión e inténtalo de nuevo.");
  }

  const payload = await readApiResponse<{
    success?: boolean;
    error?: string;
    data?: { clips?: unknown; voiceClips?: VoiceClip[] };
  }>(response);
  if (!response.ok || !payload.success) {
    throw new Error(typeof payload.error === "string" ? payload.error : "No se pudieron guardar las escenas.");
  }

  const parsedClips = heygenEditableAvatarClipSchema.array().safeParse(payload.data?.clips);
  if (!parsedClips.success
    || request.clips.some((clip) => !parsedClips.data.some((saved) => saved.id === clip.id))) {
    throw new Error("El servidor no confirmó todas las escenas. Conserva tus cambios y vuelve a intentarlo.");
  }
  return {
    clips: parsedClips.data,
    voiceClips: Array.isArray(payload.data?.voiceClips) ? payload.data.voiceClips : [],
  };
}
