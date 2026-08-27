import type { MaterialAssets, StoryboardItem } from "@/domains/materials/types/materials.types";
import type {
  ProductionAssetRequirement,
  ProductionItemReadiness,
} from "./production-automation.types";

const SCREENCAST_PATTERN = /\bscreencast\b|\bcaptura de pantalla\b|\bscreen recording\b/i;
const SLIDES_PATTERN = /\bslides?\b|\bdiapositivas?\b|\blaminas?\b|\bpresentacion\b/i;

export function deriveProductionAssetRequirements(
  storyboard: StoryboardItem[] | undefined,
): ProductionAssetRequirement[] {
  const scenes = storyboard || [];
  const visualText = scenes.map((scene) => [scene.visual_type, scene.visual_content, scene.on_screen_action].filter(Boolean).join(" ")).join("\n");
  const narration = scenes.some((scene) => Boolean(scene.narration_text?.trim()));
  const requirements: ProductionAssetRequirement[] = [];

  if (narration) {
    requirements.push({ kind: "AVATAR_AND_VOICE", reason: "El storyboard contiene narracion." });
  }
  if (SLIDES_PATTERN.test(visualText)) {
    requirements.push({ kind: "SLIDES", reason: "El storyboard solicita diapositivas o una presentacion." });
  }
  // B-roll remains part of the asset model, but is intentionally excluded from
  // this automation run until its generation/import workflow is introduced.
  if (SCREENCAST_PATTERN.test(visualText)) {
    requirements.push({ kind: "SCREENCAST", reason: "El storyboard solicita una captura de pantalla." });
  }

  return requirements;
}

export function evaluateProductionItemReadiness(params: {
  assets: MaterialAssets | null | undefined;
  requirements: ProductionAssetRequirement[];
  evaluatedAt?: string;
}): ProductionItemReadiness {
  const assets = params.assets || {};
  const requirements = params.requirements.map((requirement) => {
    const result = evaluateRequirement(assets, requirement.kind);
    return { ...requirement, ...result };
  });
  return {
    complete: requirements.every((requirement) => requirement.complete),
    evaluatedAt: params.evaluatedAt || new Date().toISOString(),
    requirements,
  };
}

function evaluateRequirement(assets: MaterialAssets, kind: ProductionAssetRequirement["kind"]) {
  if (kind === "AVATAR_AND_VOICE") return evaluateAvatarAndVoice(assets);
  if (kind === "SLIDES") {
    const animated = assets.slides?.animated_deck;
    const complete = Boolean(
      (animated && ["READY_FOR_PREVIEW", "READY_FOR_RENDER"].includes(animated.status) && animated.slides.length > 0)
      || assets.slides?.images?.some((image) => Boolean(image.public_url)),
    );
    return { complete, detail: complete ? undefined : "Faltan slides renderizables." };
  }
  if (kind === "BROLL") {
    const complete = Boolean(assets.b_roll_clips?.some((clip) => Boolean(clip.public_url)));
    return { complete, detail: complete ? undefined : "Falta B-roll renderizable." };
  }
  const complete = Boolean(assets.screencast_url);
  return { complete, detail: complete ? undefined : "Falta la captura de pantalla." };
}

function evaluateAvatarAndVoice(assets: MaterialAssets) {
  if (assets.avatar_generation_mode === "scene_clips") {
    const avatars = (assets.avatar_clips || []).filter((clip) => !clip.deleted);
    const voices = new Map(
      (assets.voice_clips || [])
        .filter((clip) => clip.status === "COMPLETED" && Boolean(clip.public_url))
        .map((clip) => [clip.clip_id, clip]),
    );
    const complete = avatars.length > 0 && avatars.every((avatar) => {
      const voice = voices.get(avatar.id);
      return avatar.status === "COMPLETED"
        && Boolean(avatar.public_url)
        && Boolean(voice)
        && (!avatar.script_hash || voice?.script_hash === avatar.script_hash);
    });
    return { complete, detail: complete ? undefined : "Faltan clips de avatar o voz sincronizada." };
  }

  const complete = Boolean(
    assets.avatar_video?.public_url
    && assets.voice_audio?.public_url
    && (!assets.avatar_video.script_hash
      || !assets.voice_audio.script_hash
      || assets.avatar_video.script_hash === assets.voice_audio.script_hash),
  );
  return { complete, detail: complete ? undefined : "Faltan el avatar y la voz sincronizada." };
}
