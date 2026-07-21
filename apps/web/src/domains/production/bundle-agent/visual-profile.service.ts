import type { BundleAgentSpec } from "./types";

export type BundleAgentVisualProfile = {
  backgroundPreset: "deep-gradient" | "editorial-light" | "cinematic-dark" | "minimal-contrast";
  layoutVariant: "split-avatar" | "media-first" | "cinematic-overlay" | "text-led";
  motionPreset: "slide" | "zoom" | "fade";
  supportVisualMode: "alternating" | "overlay" | "hero";
};

export function inferVisualProfile(spec: BundleAgentSpec): BundleAgentVisualProfile {
  const text = [
    spec.title,
    spec.description,
    spec.visualStyle,
    JSON.stringify(spec.defaultProps || {}),
  ].join(" ").toLowerCase();
  const requiredAssets = new Set(spec.requiredAssets);
  const hasAvatar = requiredAssets.has("avatar");
  const hasSlides = requiredAssets.has("slides");
  const hasBroll = requiredAssets.has("broll");

  const backgroundPreset = text.includes("claro") || text.includes("white") || text.includes("minimal")
    ? "editorial-light"
    : text.includes("cinematic") || text.includes("inmersivo") || text.includes("pantalla completa")
      ? "cinematic-dark"
      : text.includes("sobrio") || text.includes("corporativo")
        ? "minimal-contrast"
        : "deep-gradient";

  const layoutVariant = text.includes("pantalla completa") || text.includes("inmersivo") || text.includes("cinematic")
    ? "cinematic-overlay"
    : (hasSlides || hasBroll) && !hasAvatar
      ? "media-first"
      : text.includes("editorial") || text.includes("lectura") || text.includes("explicativo")
        ? "text-led"
        : "split-avatar";

  const motionPreset = text.includes("zoom") || text.includes("profundidad")
    ? "zoom"
    : text.includes("fade") || text.includes("suave") || text.includes("sobrio")
      ? "fade"
      : "slide";

  const supportVisualMode = hasSlides && hasBroll
    ? text.includes("superpuest") || text.includes("overlay")
      ? "overlay"
      : "alternating"
    : hasSlides || hasBroll
      ? "hero"
      : "alternating";

  return {
    backgroundPreset,
    layoutVariant,
    motionPreset,
    supportVisualMode,
  };
}
