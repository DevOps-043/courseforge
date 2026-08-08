import type React from "react";
import type { Box, LayoutOverrideManifest, SceneLayout } from "./types";

export const CANVAS = { width: 1920, height: 1080, fps: 25 };

const layoutBoxes: Record<SceneLayout, Record<string, Box>> = {
  AVATAR_FULL: { avatar: { x: 0, y: 0, width: 1920, height: 1080 }, captions: { x: 330, y: 920, width: 1260, height: 96 } },
  TITLE_CARD: { headline: { x: 210, y: 330, width: 1500, height: 360 } },
  STATEMENT_CARD: { headline: { x: 210, y: 330, width: 1500, height: 360 } },
  WARNING_CARD: { headline: { x: 210, y: 385, width: 1500, height: 300 } },
  AVATAR_SLIDE_SPLIT: { slide: { x: 0, y: 0, width: 1240, height: 1080 }, avatar: { x: 1240, y: 0, width: 680, height: 1080 }, captions: { x: 1300, y: 920, width: 540, height: 96 } },
  EVIDENCE_SPLIT: { broll: { x: 0, y: 0, width: 760, height: 1080 }, slide: { x: 760, y: 0, width: 1160, height: 1080 } },
  CTA_CARD: { headline: { x: 270, y: 330, width: 1380, height: 340 }, captions: { x: 330, y: 920, width: 1260, height: 96 } },
  OUTRO: { outro: { x: 0, y: 0, width: 1920, height: 1080 }, headline: { x: 720, y: 410, width: 480, height: 260 } },
};

function cloneBox(box: Box): Box { return { ...box }; }

export function getBox(layout: SceneLayout, layerId: string, overrides: LayoutOverrideManifest[] | undefined): Box | null {
  const base = layoutBoxes[layout][layerId];
  if (!base) return null;
  const box = cloneBox(base);
  for (const manifest of overrides ?? []) {
    for (const edit of manifest.edits ?? []) {
      if (edit.layerId !== layerId) continue;
      if (edit.kind === "position") { box.x = edit.x; box.y = edit.y; }
      if (edit.kind === "size") { box.width = edit.width; box.height = edit.height; }
    }
  }
  return box;
}

export function getLayerStyle(layerId: string, overrides: LayoutOverrideManifest[] | undefined): React.CSSProperties {
  const style: React.CSSProperties & { rotate?: string } = {};
  for (const manifest of overrides ?? []) {
    for (const edit of manifest.edits ?? []) {
      if (edit.layerId !== layerId) continue;
      if (edit.kind === "crop") style.clipPath = `inset(${edit.top * 100}% ${edit.right * 100}% ${edit.bottom * 100}% ${edit.left * 100}%)`;
      if (edit.kind === "rotation") style.rotate = `${edit.angle}deg`;
      if (edit.kind === "visibility" && edit.hidden) style.display = "none";
      if (edit.kind === "stack") style.zIndex = edit.order;
    }
  }
  return style;
}

export function boxStyle(box: Box, style: React.CSSProperties = {}): React.CSSProperties {
  return { position: "absolute", left: box.x, top: box.y, width: box.width, height: box.height, overflow: "hidden", ...style };
}
