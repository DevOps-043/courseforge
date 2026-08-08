import {
  bundleAgentTimelinePlanSchema,
  type BundleAgentSpec,
  type BundleAgentTimelinePlan,
  type BundleAgentTransition,
} from "./types";

function normalizeIntent(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function includesAny(value: string, terms: readonly string[]) {
  return terms.some((term) => value.includes(term));
}

function inferTransition(intent: string, fallback: BundleAgentTransition): BundleAgentTransition {
  if (includesAny(intent, ["empuje hacia la derecha", "push right", "push-right"])) return "push-right";
  if (includesAny(intent, ["empuje", "push", "desplazamiento lateral"])) return "push-left";
  if (includesAny(intent, ["intercambian lados", "scene swap", "scene-swap"])) return "scene-swap";
  if (includesAny(intent, ["barrido", "wipe"])) return "soft-wipe";
  if (includesAny(intent, ["corte", "hard cut", "hard-cut"])) return "hard-cut";
  if (includesAny(intent, ["fundido", "crossfade", "fade"])) return "crossfade";
  return fallback;
}

function inferMarginFrames(intent: string, fps: number) {
  const marginContext = includesAny(intent, [
    "margen al principio",
    "margen inicial",
    "al principio y al final",
    "inicio y al final",
    "principio y final",
  ]);
  if (!marginContext) return 0;

  const secondsMatch = intent.match(/(\d+(?:[.,]\d+)?)\s*segundos?/);
  if (!secondsMatch) return 0;
  const seconds = Number.parseFloat(secondsMatch[1]!.replace(",", "."));
  return Number.isFinite(seconds) ? Math.min(900, Math.max(1, Math.round(seconds * fps))) : 0;
}

export function inferBundleTimelinePlan(input: {
  userText: string;
  requiredAssets: BundleAgentSpec["requiredAssets"];
  fps: number;
  fallbackTransition?: BundleAgentTransition;
}): BundleAgentTimelinePlan {
  const intent = normalizeIntent(input.userText);
  const hasAvatar = input.requiredAssets.includes("avatar");
  const hasSlides = input.requiredAssets.includes("slides");
  const hasBroll = input.requiredAssets.includes("broll");
  const marginFrames = hasAvatar ? inferMarginFrames(intent, input.fps) : 0;
  const asksSequence = includesAny(intent, [
    "despues",
    "posteriormente",
    "primero",
    "al principio",
    "al final",
  ]);
  const mode = marginFrames > 0 || (asksSequence && hasAvatar && (hasSlides || hasBroll))
    ? "staged" as const
    : "continuous" as const;
  const mainAsset = hasSlides ? "slides" as const : hasBroll ? "broll" as const : "avatar" as const;
  const asksFullscreen = includesAny(intent, ["pantalla completa", "full screen", "fullscreen"]);
  const transition = inferTransition(intent, input.fallbackTransition || "crossfade");
  const overlays = hasSlides && hasBroll && includesAny(intent, ["sobre algunas", "sobre las diapositivas", "encima de", "overlay", "superpuesto"])
    ? [{
        asset: "broll" as const,
        layout: includesAny(intent, ["mitad derecha", "pantalla derecha", "lado derecho"])
          ? "right-half" as const
          : "picture-in-picture" as const,
        during: "main" as const,
        slideSelection: includesAny(intent, ["algunas", "alternadas", "alternating"])
          ? "alternating" as const
          : "all" as const,
        slideIndexes: [],
      }]
    : [];

  return bundleAgentTimelinePlanSchema.parse({
    version: 1,
    mode,
    opening: mode === "staged" && hasAvatar
      ? { asset: "avatar", durationFrames: marginFrames || Math.max(1, input.fps * 2), layout: "fullscreen" }
      : null,
    main: {
      asset: mainAsset,
      layout: asksFullscreen || mode === "staged" ? "fullscreen" : "primary",
    },
    ending: mode === "staged" && marginFrames > 0 && hasAvatar
      ? { asset: "avatar", durationFrames: marginFrames, layout: "fullscreen" }
      : null,
    transition,
    overlays,
  });
}

/** Resolves legacy specs without a plan while preserving explicit, validated plans. */
export function buildBundleTimelinePlan(
  spec: BundleAgentSpec,
  fallbackTransition: BundleAgentTransition = "crossfade",
) {
  const parsed = bundleAgentTimelinePlanSchema.safeParse(spec.timelinePlan);
  if (parsed.success) return parsed.data;

  const intent = spec.authoringIntent?.latestUserInstruction || spec.authoringIntent?.conversationInstructions || [
    spec.description,
    spec.visualStyle,
    spec.creativeBrief.motionLanguage,
  ].join(" ");

  return inferBundleTimelinePlan({
    userText: intent,
    requiredAssets: spec.requiredAssets,
    fps: spec.fps,
    fallbackTransition,
  });
}
