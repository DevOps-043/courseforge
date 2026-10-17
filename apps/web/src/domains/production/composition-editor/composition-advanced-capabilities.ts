/** Disabled by default; persisted path points remain readable and renderable when disabled. */
export function areCompositionSimplePathsEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMPOSITION_SIMPLE_PATHS === "true";
}

export function areCompositionVideoRatesEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_RATES === "true";
}

export function isCompositionVideoFreezeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMPOSITION_VIDEO_FREEZE === "true";
}
