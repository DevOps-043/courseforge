"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent } from "react";
import { Move, Maximize2, Scissors } from "lucide-react";
import {
  ASSEMBLY_HEIGHT,
  ASSEMBLY_WIDTH,
} from "@/remotion/types";
import {
  REMOTION_EDITABLE_LAYERS,
  type RemotionEditableLayerId,
} from "@/remotion/layout-override-styles";
import type { LayoutOverrideManifest } from "@/remotion/layout-overrides";
import {
  commitLayoutLayerCrop,
  commitLayoutLayerBox,
  createEmptyLayoutOverrideManifest,
  getEffectiveLayoutLayerBox,
  readLayoutLayerEdit,
  type LayoutAssetSummary,
  type LayoutLayerBox,
  type LayoutLayerCrop,
  type LayoutLayerOption,
} from "./layoutOverrideDraftModel";

export type LayoutOverrideEditMode = "move" | "crop";

export interface LayoutOverrideGridSettings {
  visible: boolean;
  snap: boolean;
  size: number;
}

interface LayoutOverridePreviewOverlayProps {
  componentId: string;
  templateId: string;
  templateVersionId?: string | null;
  templateSlug?: string | null;
  templateConfig?: unknown;
  value: LayoutOverrideManifest[];
  onChange: (value: LayoutOverrideManifest[]) => void;
  selectedLayerId: RemotionEditableLayerId;
  onSelectedLayerChange: (layerId: RemotionEditableLayerId) => void;
  editableLayers: LayoutLayerOption[];
  assetSummary: LayoutAssetSummary;
  editMode: LayoutOverrideEditMode;
  gridSettings: LayoutOverrideGridSettings;
  disabled?: boolean;
}

type DragMode = "move" | "resize" | "crop";
type CropEdge = "top" | "right" | "bottom" | "left";

interface DragState {
  mode: DragMode;
  cropEdge?: CropEdge;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startBox: LayoutLayerBox;
  startCrop: LayoutLayerCrop;
}

interface AlignmentGuide {
  orientation: "vertical" | "horizontal";
  position: number;
  source: "grid" | "layer";
}

interface LayerAlignmentBox {
  layerId: RemotionEditableLayerId;
  label: string;
  box: LayoutLayerBox;
}

const LAYER_COLORS: Record<RemotionEditableLayerId, string> = {
  [REMOTION_EDITABLE_LAYERS.AVATAR]: "#22C55E",
  [REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL]: "#38BDF8",
  [REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP]: "#F59E0B",
  [REMOTION_EDITABLE_LAYERS.SLIDES]: "#A855F7",
  [REMOTION_EDITABLE_LAYERS.BROLL]: "#EC4899",
  [REMOTION_EDITABLE_LAYERS.CAPTION]: "#F97316",
  [REMOTION_EDITABLE_LAYERS.BACKGROUND]: "#94A3B8",
};

const MIN_GRID_SIZE = 8;
const MAX_GRID_SIZE = 240;
const SMART_GUIDE_THRESHOLD = 12;

export function LayoutOverridePreviewOverlay({
  componentId,
  templateId,
  templateVersionId,
  templateSlug,
  templateConfig,
  value,
  onChange,
  selectedLayerId,
  onSelectedLayerChange,
  editableLayers,
  assetSummary,
  editMode,
  gridSettings,
  disabled = false,
}: LayoutOverridePreviewOverlayProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const [hostSize, setHostSize] = useState({ width: 0, height: 0 });
  const [alignmentGuides, setAlignmentGuides] = useState<AlignmentGuide[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const manifest = useMemo(
    () =>
      value[0] ??
      createEmptyLayoutOverrideManifest({
        componentId,
        templateId,
        templateVersionId,
      }),
    [componentId, templateId, templateVersionId, value],
  );

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateHostSize = () => {
      const rect = host.getBoundingClientRect();
      setHostSize({ width: rect.width, height: rect.height });
    };

    updateHostSize();
    const resizeObserver = new ResizeObserver(updateHostSize);
    resizeObserver.observe(host);

    return () => resizeObserver.disconnect();
  }, []);

  const canvasScale = {
    x: hostSize.width / ASSEMBLY_WIDTH || 1,
    y: hostSize.height / ASSEMBLY_HEIGHT || 1,
  };
  const gridSize = normalizeGridSize(gridSettings.size);
  const selectedLayer = editableLayers.find(
    (layer) => layer.id === selectedLayerId,
  );
  const selectedBox = getEffectiveLayoutLayerBox({
    manifest,
    layerId: selectedLayerId,
    templateSlug,
    templateConfig,
    assetSummary,
    editableLayers,
  });
  const selectedCrop = readLayoutLayerEdit(manifest, selectedLayerId, "crop") ?? {
    layerId: selectedLayerId,
    kind: "crop" as const,
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  };
  const selectedColor = LAYER_COLORS[selectedLayerId] ?? "#38BDF8";
  const peerLayerBoxes = useMemo(
    () =>
      editableLayers
        .filter((layer) => layer.id !== selectedLayerId)
        .map((layer) => ({
          layerId: layer.id,
          label: layer.label,
          box: getEffectiveLayoutLayerBox({
            manifest,
            layerId: layer.id,
            templateSlug,
            templateConfig,
            assetSummary,
            editableLayers,
          }),
        })),
    [assetSummary, editableLayers, manifest, selectedLayerId, templateConfig, templateSlug],
  );

  const updateManifest = (nextManifest: LayoutOverrideManifest) => {
    onChange(nextManifest.edits.length > 0 ? [nextManifest] : []);
  };

  const commitBox = (box: LayoutLayerBox, mode: "move" | "resize") => {
    const gridResult = gridSettings.snap
      ? snapBoxToGridReference(box, gridSize, mode)
      : { box, guide: null };
    const smartResult = snapBoxToSmartGuides(gridResult.box, peerLayerBoxes, mode);

    updateManifest(
      commitLayoutLayerBox({
        manifest,
        layerId: selectedLayerId,
        box: smartResult.box,
      }),
    );
    setAlignmentGuides([
      ...(gridResult.guide ? [gridResult.guide] : []),
      ...smartResult.guides,
    ]);
  };

  const commitCrop = (crop: LayoutLayerCrop) => {
    const snappedCrop = gridSettings.snap
      ? snapCropToGrid(crop, selectedBox, gridSize)
      : crop;

    updateManifest(
      commitLayoutLayerCrop({
        manifest,
        layerId: selectedLayerId,
        crop: snappedCrop,
      }),
    );
  };

  const beginDrag = (
    event: PointerEvent<HTMLButtonElement>,
    mode: DragMode,
    cropEdge?: CropEdge,
  ) => {
    if (disabled) return;

    event.preventDefault();
    event.stopPropagation();
    onSelectedLayerChange(selectedLayerId);
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
    setAlignmentGuides([]);
    dragStateRef.current = {
      mode,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startBox: selectedBox,
      startCrop: selectedCrop,
      cropEdge,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId || disabled) {
      return;
    }

    event.preventDefault();
    const deltaX = (event.clientX - dragState.startClientX) / canvasScale.x;
    const deltaY = (event.clientY - dragState.startClientY) / canvasScale.y;

    if (dragState.mode === "move") {
      commitBox({
        ...dragState.startBox,
        x: dragState.startBox.x + deltaX,
        y: dragState.startBox.y + deltaY,
      }, "move");
      return;
    }

    if (dragState.mode === "crop") {
      const deltaCropX = deltaX / Math.max(1, dragState.startBox.width);
      const deltaCropY = deltaY / Math.max(1, dragState.startBox.height);
      const nextCrop = { ...dragState.startCrop };

      if (dragState.cropEdge === "top") {
        nextCrop.top = dragState.startCrop.top + deltaCropY;
      }
      if (dragState.cropEdge === "right") {
        nextCrop.right = dragState.startCrop.right - deltaCropX;
      }
      if (dragState.cropEdge === "bottom") {
        nextCrop.bottom = dragState.startCrop.bottom - deltaCropY;
      }
      if (dragState.cropEdge === "left") {
        nextCrop.left = dragState.startCrop.left + deltaCropX;
      }

      commitCrop(nextCrop);
      return;
    }

    commitBox({
      ...dragState.startBox,
      width: dragState.startBox.width + deltaX,
      height: dragState.startBox.height + deltaY,
    }, "resize");
  };

  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragStateRef.current?.pointerId === event.pointerId) {
      dragStateRef.current = null;
      setIsDragging(false);
      setAlignmentGuides([]);
    }
  };

  return (
    <div
      ref={hostRef}
      className="pointer-events-none absolute inset-0 z-10"
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      {gridSettings.visible ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage: [
              "linear-gradient(to right, rgba(255,255,255,0.26) 1px, transparent 1px)",
              "linear-gradient(to bottom, rgba(255,255,255,0.26) 1px, transparent 1px)",
              "linear-gradient(to right, rgba(255,255,255,0.48) 1px, transparent 1px)",
              "linear-gradient(to bottom, rgba(255,255,255,0.48) 1px, transparent 1px)",
            ].join(", "),
            backgroundSize: [
              `${gridSize * canvasScale.x}px ${gridSize * canvasScale.y}px`,
              `${gridSize * canvasScale.x}px ${gridSize * canvasScale.y}px`,
              `${gridSize * 4 * canvasScale.x}px ${gridSize * 4 * canvasScale.y}px`,
              `${gridSize * 4 * canvasScale.x}px ${gridSize * 4 * canvasScale.y}px`,
            ].join(", "),
          }}
        />
      ) : null}

      {isDragging ? (
        <AlignmentReferenceGuides
          boxes={peerLayerBoxes}
          canvasScale={canvasScale}
        />
      ) : null}

      {alignmentGuides.map((guide, index) => (
        <div
          key={`${guide.orientation}-${guide.position}-${index}`}
          className="pointer-events-none absolute z-20"
          style={{
            left: guide.orientation === "vertical" ? guide.position * canvasScale.x : 0,
            top: guide.orientation === "horizontal" ? guide.position * canvasScale.y : 0,
            width: guide.orientation === "vertical" ? 2 : "100%",
            height: guide.orientation === "horizontal" ? 2 : "100%",
            background: guide.source === "grid" ? "rgba(20,184,166,0.95)" : "rgba(56,189,248,0.95)",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.35)",
          }}
        />
      ))}

      {selectedLayer && editMode === "move" ? (
        <>
          <button
            type="button"
            onPointerDown={(event) => beginDrag(event, "move")}
            disabled={disabled}
            className="pointer-events-auto absolute z-30 inline-flex h-8 min-w-8 items-center justify-center gap-1 rounded-md border border-white/80 bg-black/80 px-2 text-[11px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              left: clampNumber(selectedBox.x * canvasScale.x + 8, 8, Math.max(8, hostSize.width - 150)),
              top: clampNumber(selectedBox.y * canvasScale.y + 8, 8, Math.max(8, hostSize.height - 36)),
            }}
          >
            <Move className="h-3.5 w-3.5" />
            {selectedLayer.label}
          </button>
          <button
            type="button"
            onPointerDown={(event) => beginDrag(event, "resize")}
            disabled={disabled}
            className="pointer-events-auto absolute z-30 inline-flex h-8 w-8 items-center justify-center rounded-md border border-white/80 bg-black/80 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              left: clampNumber((selectedBox.x + selectedBox.width) * canvasScale.x - 16, 8, Math.max(8, hostSize.width - 36)),
              top: clampNumber((selectedBox.y + selectedBox.height) * canvasScale.y - 16, 8, Math.max(8, hostSize.height - 36)),
            }}
            aria-label={`Ajustar tamano de ${selectedLayer.label}`}
          >
            <Maximize2 className="h-3.5 w-3.5" />
          </button>
        </>
      ) : null}

      {selectedLayer ? (
        <div
          className="absolute rounded-sm"
          style={{
            left: selectedBox.x * canvasScale.x,
            top: selectedBox.y * canvasScale.y,
            width: selectedBox.width * canvasScale.x,
            height: selectedBox.height * canvasScale.y,
            border: `2px solid ${selectedColor}`,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.7)",
          }}
        >
          {editMode === "move" ? (
            <>
              <button
                type="button"
                onPointerDown={(event) => beginDrag(event, "move")}
                disabled={disabled}
                className="pointer-events-auto absolute left-2 top-2 inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border border-white/70 bg-black/70 px-2 text-[11px] font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Move className="h-3.5 w-3.5" />
                {selectedLayer.label}
              </button>

              <button
                type="button"
                onPointerDown={(event) => beginDrag(event, "resize")}
                disabled={disabled}
                className="pointer-events-auto absolute -bottom-3 -right-3 inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/70 bg-black/70 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Maximize2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <div
                className="absolute bg-black/35"
                style={{
                  left: 0,
                  top: 0,
                  right: 0,
                  height: `${selectedCrop.top * 100}%`,
                }}
              />
              <div
                className="absolute bg-black/35"
                style={{
                  right: 0,
                  top: 0,
                  bottom: 0,
                  width: `${selectedCrop.right * 100}%`,
                }}
              />
              <div
                className="absolute bg-black/35"
                style={{
                  left: 0,
                  right: 0,
                  bottom: 0,
                  height: `${selectedCrop.bottom * 100}%`,
                }}
              />
              <div
                className="absolute bg-black/35"
                style={{
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: `${selectedCrop.left * 100}%`,
                }}
              />
              <div
                className="absolute border border-dashed border-white/90"
                style={{
                  left: `${selectedCrop.left * 100}%`,
                  top: `${selectedCrop.top * 100}%`,
                  right: `${selectedCrop.right * 100}%`,
                  bottom: `${selectedCrop.bottom * 100}%`,
                }}
              />
              <button
                type="button"
                onPointerDown={(event) => beginDrag(event, "crop", "top")}
                disabled={disabled}
                className="pointer-events-auto absolute left-1/2 h-5 w-16 -translate-x-1/2 rounded-full border border-white/80 bg-black/75 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ top: `calc(${selectedCrop.top * 100}% - 10px)` }}
                aria-label="Recortar borde superior"
              />
              <button
                type="button"
                onPointerDown={(event) => beginDrag(event, "crop", "right")}
                disabled={disabled}
                className="pointer-events-auto absolute top-1/2 h-16 w-5 -translate-y-1/2 rounded-full border border-white/80 bg-black/75 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ right: `calc(${selectedCrop.right * 100}% - 10px)` }}
                aria-label="Recortar borde derecho"
              />
              <button
                type="button"
                onPointerDown={(event) => beginDrag(event, "crop", "bottom")}
                disabled={disabled}
                className="pointer-events-auto absolute left-1/2 h-5 w-16 -translate-x-1/2 rounded-full border border-white/80 bg-black/75 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ bottom: `calc(${selectedCrop.bottom * 100}% - 10px)` }}
                aria-label="Recortar borde inferior"
              />
              <button
                type="button"
                onPointerDown={(event) => beginDrag(event, "crop", "left")}
                disabled={disabled}
                className="pointer-events-auto absolute top-1/2 h-16 w-5 -translate-y-1/2 rounded-full border border-white/80 bg-black/75 text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-50"
                style={{ left: `calc(${selectedCrop.left * 100}% - 10px)` }}
                aria-label="Recortar borde izquierdo"
              />
              <div className="pointer-events-none absolute left-2 top-2 inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md border border-white/70 bg-black/70 px-2 text-[11px] font-semibold text-white shadow-sm">
                <Scissors className="h-3.5 w-3.5" />
                {selectedLayer.label}
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

function normalizeGridSize(value: number): number {
  if (!Number.isFinite(value)) {
    return 80;
  }

  return Math.min(MAX_GRID_SIZE, Math.max(MIN_GRID_SIZE, Math.round(value)));
}

function snapValueToGrid(value: number, gridSize: number): number {
  return Math.round(value / gridSize) * gridSize;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function snapBoxToGridReference(
  box: LayoutLayerBox,
  gridSize: number,
  mode: "move" | "resize",
): { box: LayoutLayerBox; guide: AlignmentGuide | null } {
  if (mode === "resize") {
    const right = snapValueToGrid(box.x + box.width, gridSize);
    const bottom = snapValueToGrid(box.y + box.height, gridSize);
    return {
      box: {
        ...box,
        width: Math.max(gridSize, right - box.x),
        height: Math.max(gridSize, bottom - box.y),
      },
      guide: {
        orientation: "vertical",
        position: right,
        source: "grid",
      },
    };
  }

  const corners = [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x, y: box.y + box.height },
    { x: box.x + box.width, y: box.y + box.height },
  ];
  const snappedCorners = corners.map((corner) => {
    const snappedX = snapValueToGrid(corner.x, gridSize);
    const snappedY = snapValueToGrid(corner.y, gridSize);
    return {
      deltaX: snappedX - corner.x,
      deltaY: snappedY - corner.y,
      distance: Math.hypot(snappedX - corner.x, snappedY - corner.y),
      snappedX,
      snappedY,
    };
  });
  const nearest = snappedCorners.reduce((best, candidate) =>
    candidate.distance < best.distance ? candidate : best,
  );

  return {
    box: {
      ...box,
      x: box.x + nearest.deltaX,
      y: box.y + nearest.deltaY,
    },
    guide: {
      orientation: "vertical",
      position: nearest.snappedX,
      source: "grid",
    },
  };
}

function getBoxAnchors(box: LayoutLayerBox) {
  return {
    vertical: [
      { key: "left", position: box.x },
      { key: "centerX", position: box.x + box.width / 2 },
      { key: "right", position: box.x + box.width },
    ],
    horizontal: [
      { key: "top", position: box.y },
      { key: "centerY", position: box.y + box.height / 2 },
      { key: "bottom", position: box.y + box.height },
    ],
  };
}

function getSmartGuideCandidates(peerBoxes: LayerAlignmentBox[]) {
  const vertical = [0, ASSEMBLY_WIDTH / 2, ASSEMBLY_WIDTH];
  const horizontal = [0, ASSEMBLY_HEIGHT / 2, ASSEMBLY_HEIGHT];

  for (const { box } of peerBoxes) {
    const anchors = getBoxAnchors(box);
    vertical.push(...anchors.vertical.map((anchor) => anchor.position));
    horizontal.push(...anchors.horizontal.map((anchor) => anchor.position));
  }

  return { vertical, horizontal };
}

function getNearestGuideDelta(
  movingAnchors: Array<{ position: number }>,
  candidates: number[],
) {
  let best: { delta: number; position: number; distance: number } | null = null;

  for (const movingAnchor of movingAnchors) {
    for (const candidate of candidates) {
      const delta = candidate - movingAnchor.position;
      const distance = Math.abs(delta);
      if (distance <= SMART_GUIDE_THRESHOLD && (!best || distance < best.distance)) {
        best = { delta, position: candidate, distance };
      }
    }
  }

  return best;
}

function snapBoxToSmartGuides(
  box: LayoutLayerBox,
  peerBoxes: LayerAlignmentBox[],
  mode: "move" | "resize",
): { box: LayoutLayerBox; guides: AlignmentGuide[] } {
  const candidates = getSmartGuideCandidates(peerBoxes);
  const anchors = getBoxAnchors(box);
  const verticalAnchors = mode === "resize"
    ? [{ position: box.x + box.width }]
    : anchors.vertical;
  const horizontalAnchors = mode === "resize"
    ? [{ position: box.y + box.height }]
    : anchors.horizontal;
  const verticalGuide = getNearestGuideDelta(verticalAnchors, candidates.vertical);
  const horizontalGuide = getNearestGuideDelta(horizontalAnchors, candidates.horizontal);

  const nextBox = { ...box };
  if (verticalGuide) {
    if (mode === "resize") {
      nextBox.width = Math.max(MIN_GRID_SIZE, box.width + verticalGuide.delta);
    } else {
      nextBox.x = box.x + verticalGuide.delta;
    }
  }
  if (horizontalGuide) {
    if (mode === "resize") {
      nextBox.height = Math.max(MIN_GRID_SIZE, box.height + horizontalGuide.delta);
    } else {
      nextBox.y = box.y + horizontalGuide.delta;
    }
  }

  return {
    box: nextBox,
    guides: [
      ...(verticalGuide
        ? [{ orientation: "vertical" as const, position: verticalGuide.position, source: "layer" as const }]
        : []),
      ...(horizontalGuide
        ? [{ orientation: "horizontal" as const, position: horizontalGuide.position, source: "layer" as const }]
        : []),
    ],
  };
}

function AlignmentReferenceGuides({
  boxes,
  canvasScale,
}: {
  boxes: LayerAlignmentBox[];
  canvasScale: { x: number; y: number };
}) {
  return (
    <>
      {boxes.flatMap((layer) => {
        const anchors = getBoxAnchors(layer.box);
        return [
          ...anchors.vertical.map((anchor) => (
            <div
              key={`${layer.layerId}-${anchor.key}`}
              className="pointer-events-none absolute z-10 border-l border-dashed border-white/30"
              style={{
                left: anchor.position * canvasScale.x,
                top: layer.box.y * canvasScale.y,
                height: layer.box.height * canvasScale.y,
              }}
            />
          )),
          ...anchors.horizontal.map((anchor) => (
            <div
              key={`${layer.layerId}-${anchor.key}`}
              className="pointer-events-none absolute z-10 border-t border-dashed border-white/30"
              style={{
                left: layer.box.x * canvasScale.x,
                top: anchor.position * canvasScale.y,
                width: layer.box.width * canvasScale.x,
              }}
            />
          )),
        ];
      })}
    </>
  );
}

function snapCropToGrid(
  crop: LayoutLayerCrop,
  box: LayoutLayerBox,
  gridSize: number,
): LayoutLayerCrop {
  const width = Math.max(1, box.width);
  const height = Math.max(1, box.height);

  return {
    top: snapValueToGrid(crop.top * height, gridSize) / height,
    right: snapValueToGrid(crop.right * width, gridSize) / width,
    bottom: snapValueToGrid(crop.bottom * height, gridSize) / height,
    left: snapValueToGrid(crop.left * width, gridSize) / width,
  };
}
