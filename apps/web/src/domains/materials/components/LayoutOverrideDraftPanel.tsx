"use client";

import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Grid3X3,
  Magnet,
  Move,
  RotateCcw,
  Scissors,
} from "lucide-react";
import {
  ASSEMBLY_HEIGHT,
  ASSEMBLY_WIDTH,
} from "@/remotion/types";
import {
  REMOTION_EDITABLE_LAYERS,
  type RemotionEditableLayerId,
} from "@/remotion/layout-override-styles";
import type { LayoutOverrideManifest } from "@/remotion/layout-overrides";
import type {
  LayoutOverrideEditMode,
  LayoutOverrideGridSettings,
} from "./LayoutOverridePreviewOverlay";
import {
  createEmptyLayoutOverrideManifest,
  getLayoutLayerStackPosition,
  moveLayoutLayerInStack,
  readLayoutLayerEdit,
  resetLayoutLayerToDefault,
  type LayoutLayerOption,
  upsertLayoutLayerEdit,
} from "./layoutOverrideDraftModel";

interface LayoutOverrideDraftPanelProps {
  componentId: string;
  templateId: string;
  templateVersionId?: string | null;
  value: LayoutOverrideManifest[];
  onChange: (value: LayoutOverrideManifest[]) => void;
  disabled?: boolean;
  editableLayers: LayoutLayerOption[];
  selectedLayerId?: RemotionEditableLayerId;
  onSelectedLayerChange?: (layerId: RemotionEditableLayerId) => void;
  editMode?: LayoutOverrideEditMode;
  onEditModeChange?: (mode: LayoutOverrideEditMode) => void;
  gridSettings?: LayoutOverrideGridSettings;
  onGridSettingsChange?: (settings: LayoutOverrideGridSettings) => void;
}

const GRID_SIZE_OPTIONS = [40, 80, 120, 160] as const;

function parseNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function LayoutOverrideDraftPanel({
  componentId,
  templateId,
  templateVersionId,
  value,
  onChange,
  disabled = false,
  editableLayers,
  selectedLayerId: controlledSelectedLayerId,
  onSelectedLayerChange,
  editMode = "move",
  onEditModeChange,
  gridSettings = { visible: true, snap: true, size: 80 },
  onGridSettingsChange,
}: LayoutOverrideDraftPanelProps) {
  const [localSelectedLayerId, setLocalSelectedLayerId] =
    useState<RemotionEditableLayerId>(REMOTION_EDITABLE_LAYERS.AVATAR);
  const selectedLayerId = controlledSelectedLayerId ?? localSelectedLayerId;
  const manifest =
    value[0] ??
    createEmptyLayoutOverrideManifest({
      componentId,
      templateId,
      templateVersionId,
    });
  const position = readLayoutLayerEdit(manifest, selectedLayerId, "position");
  const size = readLayoutLayerEdit(manifest, selectedLayerId, "size");
  const crop = readLayoutLayerEdit(manifest, selectedLayerId, "crop");
  const selectedLayer = editableLayers.find((layer) => layer.id === selectedLayerId);
  const selectedDefaultBox = selectedLayer?.defaultBox;
  const displayX = position?.x ?? selectedDefaultBox?.x ?? 0;
  const displayY = position?.y ?? selectedDefaultBox?.y ?? 0;
  const displayWidth = size?.width ?? selectedDefaultBox?.width ?? ASSEMBLY_WIDTH;
  const displayHeight = size?.height ?? selectedDefaultBox?.height ?? ASSEMBLY_HEIGHT;
  const stackPosition = getLayoutLayerStackPosition({
    manifest,
    layerId: selectedLayerId,
    editableLayers,
  });

  const updateManifest = (nextManifest: LayoutOverrideManifest) => {
    onChange(nextManifest.edits.length > 0 ? [nextManifest] : []);
  };

  const changeSelectedLayer = (layerId: RemotionEditableLayerId) => {
    setLocalSelectedLayerId(layerId);
    onSelectedLayerChange?.(layerId);
  };

  const updatePosition = (field: "x" | "y", rawValue: string) => {
    const current = position ?? {
      layerId: selectedLayerId,
      kind: "position" as const,
      x: displayX,
      y: displayY,
    };
    updateManifest(
      upsertLayoutLayerEdit(manifest, {
        ...current,
        [field]: parseNumber(rawValue),
      }),
    );
  };

  const updateSize = (field: "width" | "height", rawValue: string) => {
    const current = size ?? {
      layerId: selectedLayerId,
      kind: "size" as const,
      width: displayWidth,
      height: displayHeight,
    };
    updateManifest(
      upsertLayoutLayerEdit(manifest, {
        ...current,
        [field]: Math.max(1, parseNumber(rawValue)),
      }),
    );
  };

  const updateCrop = (
    field: "top" | "right" | "bottom" | "left",
    rawValue: string,
  ) => {
    const current = crop ?? {
      layerId: selectedLayerId,
      kind: "crop" as const,
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
    updateManifest(
      upsertLayoutLayerEdit(manifest, {
        ...current,
        [field]: Math.min(1, Math.max(0, parseNumber(rawValue) / 100)),
      }),
    );
  };

  const resetLayer = () => {
    updateManifest(
      resetLayoutLayerToDefault({
        manifest,
        layerId: selectedLayerId,
        editableLayers,
      }),
    );
  };

  const resetCrop = () => {
    updateManifest({
      ...manifest,
      edits: manifest.edits.filter(
        (edit) => !(edit.layerId === selectedLayerId && edit.kind === "crop"),
      ),
    });
  };

  const moveSelectedLayer = (direction: "backward" | "forward") => {
    updateManifest(
      moveLayoutLayerInStack({
        manifest,
        layerId: selectedLayerId,
        editableLayers,
        direction,
      }),
    );
  };

  const updateGridSettings = (patch: Partial<LayoutOverrideGridSettings>) => {
    onGridSettingsChange?.({ ...gridSettings, ...patch });
  };

  return (
    <div className="rounded-2xl border border-[#00D4B3]/20 bg-[#00D4B3]/5 p-5">
      <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h4 className="text-sm font-bold text-gray-900 dark:text-white">
            Editor de layout
          </h4>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            Ajusta capas visibles, recorte y alineacion con grid.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-[#6C757D]/20 dark:bg-[#0F1419]">
            {([
              { mode: "move" as const, label: "Mover", Icon: Move },
              { mode: "crop" as const, label: "Recortar", Icon: Scissors },
            ]).map(({ mode, label, Icon }) => (
              <button
                key={mode}
                type="button"
                onClick={() => onEditModeChange?.(mode)}
                disabled={disabled}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  editMode === mode
                    ? "bg-[#0A2540] text-white"
                    : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 dark:border-[#6C757D]/20 dark:bg-[#0F1419]">
            <button
              type="button"
              onClick={() => updateGridSettings({ visible: !gridSettings.visible })}
              disabled={disabled}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                gridSettings.visible
                  ? "bg-[#00D4B3] text-[#0A2540]"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              <Grid3X3 className="h-3.5 w-3.5" />
              Grid
            </button>
            <button
              type="button"
              onClick={() => updateGridSettings({ snap: !gridSettings.snap })}
              disabled={disabled}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                gridSettings.snap
                  ? "bg-[#00D4B3] text-[#0A2540]"
                  : "text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-white/5"
              }`}
            >
              <Magnet className="h-3.5 w-3.5" />
              Snap
            </button>
          </div>
          <label className="inline-flex items-center gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            Paso
            <select
              value={gridSettings.size}
              onChange={(event) =>
                updateGridSettings({ size: Number(event.target.value) })
              }
              disabled={disabled}
              className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
            >
              {GRID_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}px
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            onClick={resetLayer}
            disabled={disabled}
            className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2 py-1 text-xs font-semibold text-gray-700 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#6C757D]/20 dark:text-gray-200 dark:hover:bg-white/5"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset
          </button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(220px,1fr)_minmax(140px,0.7fr)_minmax(140px,0.7fr)]">
        <div className="space-y-2">
          <label className="block space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            Capa
            <select
              value={selectedLayerId}
              onChange={(event) =>
                changeSelectedLayer(event.target.value as RemotionEditableLayerId)
              }
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
            >
              {editableLayers.map((layer) => (
                <option key={layer.id} value={layer.id}>
                  {layer.detail ? `${layer.label} (${layer.detail})` : layer.label}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => moveSelectedLayer("backward")}
              disabled={disabled || !stackPosition.canMoveBackward}
              title="Bajar una capa"
              aria-label="Bajar una capa"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-gray-200 dark:hover:bg-white/5"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveSelectedLayer("forward")}
              disabled={disabled || !stackPosition.canMoveForward}
              title="Subir una capa"
              aria-label="Subir una capa"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-700 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-gray-200 dark:hover:bg-white/5"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <span className="text-[11px] text-gray-500 dark:text-gray-400">
              {stackPosition.total > 1 && stackPosition.index >= 0
                ? `Nivel ${stackPosition.index + 1} de ${stackPosition.total}`
                : "Orden fijo"}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            X
            <input
              type="number"
              value={displayX}
              onChange={(event) => updatePosition("x", event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            Y
            <input
              type="number"
              value={displayY}
              onChange={(event) => updatePosition("y", event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
            />
          </label>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <label className="space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            W
            <input
              type="number"
              value={displayWidth}
              onChange={(event) => updateSize("width", event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
            />
          </label>
          <label className="space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300">
            H
            <input
              type="number"
              value={displayHeight}
              onChange={(event) => updateSize("height", event.target.value)}
              disabled={disabled}
              className="w-full rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
            />
          </label>
        </div>

      </div>

      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="text-xs font-bold uppercase tracking-wide text-gray-500 dark:text-gray-400">
          Recorte (%)
        </span>
        <button
          type="button"
          onClick={resetCrop}
          disabled={disabled || !crop}
          className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs font-semibold text-gray-600 transition hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-[#6C757D]/20 dark:bg-[#0F1419] dark:text-gray-300 dark:hover:bg-white/5"
        >
          Mostrar completo
        </button>
      </div>

      <div className="mt-2 grid gap-2 sm:grid-cols-4">
          {(["top", "right", "bottom", "left"] as const).map((field) => (
            <label
              key={field}
              className="space-y-1 text-xs font-semibold text-gray-600 dark:text-gray-300"
            >
              {field.slice(0, 1).toUpperCase()}
              <input
                type="number"
                min={0}
                max={100}
                value={Math.round(((crop?.[field] ?? 0) as number) * 100)}
                onChange={(event) => updateCrop(field, event.target.value)}
                disabled={disabled}
                className="w-full min-w-[56px] rounded-lg border border-gray-200 bg-white px-2 py-2 text-xs dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-white"
              />
            </label>
          ))}
      </div>
    </div>
  );
}
