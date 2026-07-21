import {
  ASSEMBLY_FPS,
  ASSEMBLY_HEIGHT,
  ASSEMBLY_TEMPLATES,
  ASSEMBLY_WIDTH,
} from "../../../remotion/types";
import {
  REMOTION_EDITABLE_LAYERS,
  type RemotionEditableLayerId,
} from "../../../remotion/layout-override-styles";
import { parseTemplateRenderConfig } from "../../../remotion/template-config";
import type {
  EditableLayerDefinition,
  LayoutOverrideEdit,
  LayoutOverrideManifest,
} from "../../../remotion/layout-overrides";

export interface LayoutLayerOption {
  id: RemotionEditableLayerId;
  label: string;
  detail?: string;
  defaultBox?: LayoutLayerBox;
}

export interface LayoutLayerBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutLayerCrop {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface LayoutAssetSummary {
  hasAvatar: boolean;
  slideCount: number;
  brollCount: number;
}

export const DEFAULT_EDITABLE_LAYOUT_LAYERS: LayoutLayerOption[] = [
  { id: REMOTION_EDITABLE_LAYERS.AVATAR, label: "Avatar" },
  { id: REMOTION_EDITABLE_LAYERS.SLIDES, label: "Diapositivas" },
  { id: REMOTION_EDITABLE_LAYERS.BROLL, label: "B-roll" },
  {
    id: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
    label: "Contenedor visual",
    detail: "Area base",
  },
  {
    id: REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP,
    label: "Area de apoyo",
    detail: "Avatar enfocado",
  },
];

const MIN_LAYER_SIZE = 24;

export function createEmptyLayoutOverrideManifest(params: {
  componentId: string;
  templateId: string;
  templateVersionId?: string | null;
}): LayoutOverrideManifest {
  return {
    version: 1,
    componentId: params.componentId,
    templateId: params.templateId,
    templateVersionId: params.templateVersionId ?? null,
    canvas: {
      width: ASSEMBLY_WIDTH,
      height: ASSEMBLY_HEIGHT,
      fps: ASSEMBLY_FPS,
    },
    edits: [],
  };
}

export function getEditableLayoutLayers(
  assetSummary: LayoutAssetSummary,
  templateEditableLayers: EditableLayerDefinition[] = [],
): LayoutLayerOption[] {
  const metadataLayers = templateEditableLayers
    .map(toLayoutLayerOption)
    .filter((layer): layer is LayoutLayerOption => Boolean(layer));
  if (metadataLayers.length > 0) {
    const visibleMetadataLayers = metadataLayers.filter((layer) => shouldShowLayer(layer.id, assetSummary));
    if (visibleMetadataLayers.length > 0) {
      return visibleMetadataLayers;
    }
  }

  const layers: LayoutLayerOption[] = [];

  if (assetSummary.hasAvatar) {
    layers.push({ id: REMOTION_EDITABLE_LAYERS.AVATAR, label: "Avatar" });
  }

  if (assetSummary.slideCount > 0) {
    layers.push({
      id: REMOTION_EDITABLE_LAYERS.SLIDES,
      label: "Diapositivas",
      detail: `${assetSummary.slideCount}`,
    });
  }

  if (assetSummary.brollCount > 0) {
    layers.push({
      id: REMOTION_EDITABLE_LAYERS.BROLL,
      label: "B-roll",
      detail: `${assetSummary.brollCount}`,
    });
  }

  if (assetSummary.slideCount > 0 || assetSummary.brollCount > 0) {
    layers.push({
      id: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
      label: "Contenedor visual",
      detail: "base",
    });
  }

  if (
    assetSummary.hasAvatar &&
    (assetSummary.slideCount > 0 || assetSummary.brollCount > 0)
  ) {
    layers.push({
      id: REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP,
      label: "Area de apoyo",
      detail: "franja",
    });
  }

  return layers.length > 0 ? layers : DEFAULT_EDITABLE_LAYOUT_LAYERS;
}

export function readLayoutLayerEdit<TKind extends LayoutOverrideEdit["kind"]>(
  manifest: LayoutOverrideManifest,
  layerId: string,
  kind: TKind,
): Extract<LayoutOverrideEdit, { kind: TKind }> | null {
  return (
    manifest.edits.find(
      (edit): edit is Extract<LayoutOverrideEdit, { kind: TKind }> =>
        edit.layerId === layerId && edit.kind === kind,
    ) ?? null
  );
}

export function upsertLayoutLayerEdit(
  manifest: LayoutOverrideManifest,
  edit: LayoutOverrideEdit,
): LayoutOverrideManifest {
  return {
    ...manifest,
    edits: [
      ...manifest.edits.filter(
        (existing) =>
          !(existing.layerId === edit.layerId && existing.kind === edit.kind),
      ),
      edit,
    ],
  };
}

export function removeLayoutLayerEdits(
  manifest: LayoutOverrideManifest,
  layerId: string,
): LayoutOverrideManifest {
  return {
    ...manifest,
    edits: manifest.edits.filter((edit) => edit.layerId !== layerId),
  };
}

export function commitLayoutLayerBox(params: {
  manifest: LayoutOverrideManifest;
  layerId: string;
  box: LayoutLayerBox;
}): LayoutOverrideManifest {
  const normalizedBox = normalizeLayerBox(params.box);
  const withPosition = upsertLayoutLayerEdit(params.manifest, {
    layerId: params.layerId,
    kind: "position",
    x: normalizedBox.x,
    y: normalizedBox.y,
  });

  return upsertLayoutLayerEdit(withPosition, {
    layerId: params.layerId,
    kind: "size",
    width: normalizedBox.width,
    height: normalizedBox.height,
  });
}

export function commitLayoutLayerCrop(params: {
  manifest: LayoutOverrideManifest;
  layerId: string;
  crop: LayoutLayerCrop;
}): LayoutOverrideManifest {
  return upsertLayoutLayerEdit(params.manifest, {
    layerId: params.layerId,
    kind: "crop",
    ...normalizeLayerCrop(params.crop),
  });
}

export function getDefaultLayoutLayerBox(params: {
  layerId: RemotionEditableLayerId;
  templateSlug?: string | null;
  templateConfig?: unknown;
  assetSummary?: LayoutAssetSummary;
  editableLayers?: LayoutLayerOption[];
}): LayoutLayerBox {
  const metadataDefaultBox = params.editableLayers?.find(
    (layer) => layer.id === params.layerId,
  )?.defaultBox;
  if (metadataDefaultBox) {
    return normalizeLayerBox(metadataDefaultBox);
  }

  const templateConfig = parseTemplateRenderConfig(params.templateConfig);
  const fullCanvas = {
    x: 0,
    y: 0,
    width: ASSEMBLY_WIDTH,
    height: ASSEMBLY_HEIGHT,
  };

  if (params.templateSlug === ASSEMBLY_TEMPLATES.SPLIT_AVATAR) {
    if (
      params.layerId === REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL ||
      params.layerId === REMOTION_EDITABLE_LAYERS.SLIDES
    ) {
      return { x: 0, y: 0, width: ASSEMBLY_WIDTH / 2, height: ASSEMBLY_HEIGHT };
    }
    if (params.layerId === REMOTION_EDITABLE_LAYERS.BROLL) {
      return getDefaultBrollLayerBox({
        container: { x: 0, y: 0, width: ASSEMBLY_WIDTH / 2, height: ASSEMBLY_HEIGHT },
        hasSlides: Boolean(params.assetSummary?.slideCount),
      });
    }
    if (params.layerId === REMOTION_EDITABLE_LAYERS.AVATAR) {
      return {
        x: ASSEMBLY_WIDTH / 2,
        y: 0,
        width: ASSEMBLY_WIDTH / 2,
        height: ASSEMBLY_HEIGHT,
      };
    }
    return fullCanvas;
  }

  if (params.templateSlug === ASSEMBLY_TEMPLATES.AVATAR_FOCUS) {
    if (params.layerId === REMOTION_EDITABLE_LAYERS.BROLL) {
      const supportHeight = ASSEMBLY_HEIGHT * templateConfig.supportStripHeight;
      return getDefaultBrollLayerBox({
        container: {
          x: 0,
          y: ASSEMBLY_HEIGHT - supportHeight,
          width: ASSEMBLY_WIDTH,
          height: supportHeight,
        },
        hasSlides: Boolean(params.assetSummary?.slideCount),
      });
    }
    if (params.layerId === REMOTION_EDITABLE_LAYERS.SLIDES) {
      const height = ASSEMBLY_HEIGHT * templateConfig.supportStripHeight;
      return {
        x: 0,
        y: ASSEMBLY_HEIGHT - height,
        width: ASSEMBLY_WIDTH,
        height,
      };
    }
    if (params.layerId === REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP) {
      const height = ASSEMBLY_HEIGHT * templateConfig.supportStripHeight;
      return {
        x: 0,
        y: ASSEMBLY_HEIGHT - height,
        width: ASSEMBLY_WIDTH,
        height,
      };
    }
    return fullCanvas;
  }

  if (params.layerId === REMOTION_EDITABLE_LAYERS.AVATAR) {
    const width = ASSEMBLY_WIDTH * templateConfig.avatarScale;
    const height = width * (9 / 16);
    const offset = 48;
    const x = templateConfig.avatarPosition.endsWith("left")
      ? offset
      : ASSEMBLY_WIDTH - width - offset;
    const y = templateConfig.avatarPosition.startsWith("top")
      ? offset
      : ASSEMBLY_HEIGHT - height - offset;

    return { x, y, width, height };
  }

  if (params.layerId === REMOTION_EDITABLE_LAYERS.BROLL) {
    return getDefaultBrollLayerBox({
      container: fullCanvas,
      hasSlides: Boolean(params.assetSummary?.slideCount),
    });
  }

  return fullCanvas;
}

export function getEffectiveLayoutLayerBox(params: {
  manifest: LayoutOverrideManifest;
  layerId: RemotionEditableLayerId;
  templateSlug?: string | null;
  templateConfig?: unknown;
  assetSummary?: LayoutAssetSummary;
  editableLayers?: LayoutLayerOption[];
}): LayoutLayerBox {
  const fallback = getDefaultLayoutLayerBox(params);
  const position = readLayoutLayerEdit(params.manifest, params.layerId, "position");
  const size = readLayoutLayerEdit(params.manifest, params.layerId, "size");

  return normalizeLayerBox({
    x: position?.x ?? fallback.x,
    y: position?.y ?? fallback.y,
    width: size?.width ?? fallback.width,
    height: size?.height ?? fallback.height,
  });
}

function getDefaultBrollLayerBox(params: {
  container: LayoutLayerBox;
  hasSlides: boolean;
}): LayoutLayerBox {
  if (!params.hasSlides) {
    return params.container;
  }

  const width = Math.round(params.container.width * 0.34);
  const height = Math.round(width * (9 / 16));
  const inset = 48;

  return {
    x: params.container.x + params.container.width - width - inset,
    y: params.container.y + params.container.height - height - inset,
    width,
    height,
  };
}

function toLayoutLayerOption(layer: EditableLayerDefinition): LayoutLayerOption | null {
  if (!isRemotionEditableLayerId(layer.layerId)) return null;

  return {
    id: layer.layerId,
    label: layer.label,
    detail: layer.kind,
    defaultBox: layer.defaultBox ? normalizeLayerBox(layer.defaultBox) : undefined,
  };
}

function isRemotionEditableLayerId(value: string): value is RemotionEditableLayerId {
  return Object.values(REMOTION_EDITABLE_LAYERS).includes(value as RemotionEditableLayerId);
}

function shouldShowLayer(layerId: RemotionEditableLayerId, assetSummary: LayoutAssetSummary): boolean {
  if (layerId === REMOTION_EDITABLE_LAYERS.AVATAR) return assetSummary.hasAvatar;
  if (layerId === REMOTION_EDITABLE_LAYERS.SLIDES) return assetSummary.slideCount > 0;
  if (layerId === REMOTION_EDITABLE_LAYERS.BROLL) return assetSummary.brollCount > 0;
  if (layerId === REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL) {
    return assetSummary.slideCount > 0 || assetSummary.brollCount > 0;
  }
  if (layerId === REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP) {
    return assetSummary.hasAvatar && (assetSummary.slideCount > 0 || assetSummary.brollCount > 0);
  }
  return true;
}

export function normalizeLayerBox(box: LayoutLayerBox): LayoutLayerBox {
  return {
    x: clampNumber(box.x, -ASSEMBLY_WIDTH, ASSEMBLY_WIDTH * 2),
    y: clampNumber(box.y, -ASSEMBLY_HEIGHT, ASSEMBLY_HEIGHT * 2),
    width: clampNumber(box.width, MIN_LAYER_SIZE, ASSEMBLY_WIDTH * 2),
    height: clampNumber(box.height, MIN_LAYER_SIZE, ASSEMBLY_HEIGHT * 2),
  };
}

export function normalizeLayerCrop(crop: LayoutLayerCrop): LayoutLayerCrop {
  const top = clampCropInset(crop.top);
  const right = clampCropInset(crop.right);
  const bottom = clampCropInset(crop.bottom);
  const left = clampCropInset(crop.left);

  return {
    top: roundCropInset(clampCropPair(top, bottom)),
    right: roundCropInset(clampCropPair(right, left)),
    bottom: roundCropInset(clampCropPair(bottom, top)),
    left: roundCropInset(clampCropPair(left, right)),
  };
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.round(value)));
}

function clampCropInset(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(0.95, Math.max(0, value));
}

function clampCropPair(value: number, opposite: number): number {
  return Math.min(value, 0.95 - opposite);
}

function roundCropInset(value: number): number {
  return Math.round(value * 10000) / 10000;
}
