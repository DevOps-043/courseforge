"use client";

import { THUMBNAIL_POLICY } from "./thumbnail-derivative.contract";
import type { ThumbnailPlanInput } from "./thumbnail-plan.service";
import type { ThumbnailLoader, ThumbnailViewport } from "./thumbnail-viewport.client";
import { useThumbnailViewport } from "./useThumbnailViewport";

/** Isolated decorative strip; host retains all timeline interactions and document ownership. */
export function ThumbnailViewportStrip(props: {
  input: ThumbnailPlanInput; load: ThumbnailLoader; accessKey: string;
}) {
  const state = useThumbnailViewport(props.input, props.load, props.accessKey);
  if (state.status !== "ready") return <div data-thumbnail-state={state.status} aria-hidden="true" />;
  return <ThumbnailViewportTiles input={props.input} viewport={state.viewport} />;
}

/** Pure view; no read, decoder, document command or timeline interaction. */
export function ThumbnailViewportTiles(props: { input: ThumbnailPlanInput; viewport: ThumbnailViewport }) {
  const { plan, pages } = props.viewport;
  const scale = props.input.viewport.pixelsPerSecond / 1_000;
  return <div data-thumbnail-state="ready" aria-hidden="true" style={{
    position: "relative", overflow: "hidden", pointerEvents: "none", height: THUMBNAIL_POLICY.tileHeight,
    width: (props.input.viewport.endMs - props.input.viewport.startMs) * scale,
  }}>
    {plan.tiles.map((tile) => {
      const page = pages.get(tile.cacheKey);
      return <span key={tile.index} data-thumbnail-missing={!page || undefined} style={{
        position: "absolute", top: 0, left: (tile.startMs - props.input.viewport.startMs) * scale,
        width: Math.min(THUMBNAIL_POLICY.tileWidth, (tile.endMs - tile.startMs) * scale),
        height: THUMBNAIL_POLICY.tileHeight,
        backgroundImage: page ? `url("${page.url}")` : undefined,
        backgroundPosition: `-${tile.x}px -${tile.y}px`, backgroundRepeat: "no-repeat",
      }} />;
    })}
  </div>;
}
