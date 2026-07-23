import {
  ASSEMBLY_FPS,
  ASSEMBLY_HEIGHT,
  ASSEMBLY_TEMPLATES,
  ASSEMBLY_WIDTH,
} from "../../../remotion/types";
import {
  getBrollItemLayerId,
  getSlideItemLayerId,
  isBrollItemLayerId,
  isSlideItemLayerId,
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
  canReorder?: boolean;
  defaultStackOrder?: number;
  stackGroup?: string;
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
  {
    id: REMOTION_EDITABLE_LAYERS.AVATAR,
    label: "Avatar",
    canReorder: true,
    defaultStackOrder: 30,
    stackGroup: "root",
  },
  {
    id: REMOTION_EDITABLE_LAYERS.SLIDES,
    label: "Diapositivas",
    canReorder: true,
    defaultStackOrder: 10,
    stackGroup: "primary-visual",
  },
  {
    id: REMOTION_EDITABLE_LAYERS.BROLL,
    label: "B-roll",
    canReorder: true,
    defaultStackOrder: 20,
    stackGroup: "primary-visual",
  },
  {
    id: REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL,
    label: "Contenedor visual",
    detail: "Area base",
    canReorder: true,
    defaultStackOrder: 10,
    stackGroup: "root",
  },
  {
    id: REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP,
    label: "Area de apoyo",
    detail: "Avatar enfocado",
    canReorder: true,
    defaultStackOrder: 20,
    stackGroup: "root",
  },
];

const MIN_LAYER_SIZE = 24;
const MIN_VISIBLE_CROP_AREA_RATIO = 0.1;

function getDefaultLayerOption(layerId: string): LayoutLayerOption {
  const layer = DEFAULT_EDITABLE_LAYOUT_LAYERS.find(
    (candidate) => candidate.id === layerId,
  );

  return layer ? { ...layer } : { id: layerId, label: layerId };
}

function getInternalLayerOption(
  layerId: string,
  templateSlug?: string | null,
): LayoutLayerOption {
  const layer = getDefaultLayerOption(layerId);

  if (
    templateSlug === ASSEMBLY_TEMPLATES.AVATAR_FOCUS &&
    layerId === REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL
  ) {
    return {
      ...layer,
      canReorder: false,
      defaultStackOrder: 0,
      stackGroup: "support-strip",
    };
  }

  return layer;
}

function getOrderedStackSiblings(
  manifest: LayoutOverrideManifest,
  editableLayers: LayoutLayerOption[],
  selectedLayer: LayoutLayerOption,
): LayoutLayerOption[] {
  const stackGroup = selectedLayer.stackGroup ?? "root";

  return editableLayers
    .map((layer, sourceIndex) => ({ layer, sourceIndex }))
    .filter(
      ({ layer }) =>
        layer.canReorder && (layer.stackGroup ?? "root") === stackGroup,
    )
    .sort((left, right) => {
      const orderDelta =
        getEffectiveLayoutLayerStackOrder(manifest, left.layer) -
        getEffectiveLayoutLayerStackOrder(manifest, right.layer);
      return orderDelta || left.sourceIndex - right.sourceIndex;
    })
    .map(({ layer }) => layer);
}

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
  templateSlug?: string | null,
  options: { allowInternalFallback?: boolean } = {},
): LayoutLayerOption[] {
  const metadataLayers = templateEditableLayers
    .flatMap((layer) => {
      const groupLayer = toLayoutLayerOption(layer);
      const itemLayers: LayoutLayerOption[] = [];

      if (layer.itemLayerIdPattern === "slide:{index}") {
        for (let index = 0; index < assetSummary.slideCount; index += 1) {
          itemLayers.push({
            ...groupLayer,
            id: getSlideItemLayerId(index),
            label: `Diapositiva ${index + 1}`,
            detail: "item",
            canReorder: false,
            defaultStackOrder: undefined,
            stackGroup: undefined,
          });
        }
      }

      if (layer.itemLayerIdPattern === "broll:{order}") {
        for (let order = 1; order <= assetSummary.brollCount; order += 1) {
          itemLayers.push({
            ...groupLayer,
            id: getBrollItemLayerId(order),
            label: `B-roll ${order}`,
            detail: "item",
            canReorder: false,
            defaultStackOrder: undefined,
            stackGroup: undefined,
          });
        }
      }

      return [...itemLayers, groupLayer];
    })
    .filter((layer): layer is LayoutLayerOption => Boolean(layer));
  if (metadataLayers.length > 0) {
    const visibleMetadataLayers = metadataLayers.filter((layer) => shouldShowLayer(layer.id, assetSummary));
    if (visibleMetadataLayers.length > 0) {
      return visibleMetadataLayers;
    }
  }

  if (options.allowInternalFallback === false) {
    return [];
  }

  const layers: LayoutLayerOption[] = [];

  if (assetSummary.hasAvatar) {
    layers.push(getInternalLayerOption(REMOTION_EDITABLE_LAYERS.AVATAR, templateSlug));
  }

  if (assetSummary.slideCount > 0) {
    for (let index = 0; index < assetSummary.slideCount; index += 1) {
      layers.push({
        id: getSlideItemLayerId(index),
        label: `Diapositiva ${index + 1}`,
        detail: "item",
        canReorder: false,
      });
    }
  }

  if (assetSummary.brollCount > 0) {
    for (let order = 1; order <= assetSummary.brollCount; order += 1) {
      layers.push({
        id: getBrollItemLayerId(order),
        label: `B-roll ${order}`,
        detail: "item",
        canReorder: false,
      });
    }
  }

  if (assetSummary.slideCount > 0) {
    layers.push({
      ...getInternalLayerOption(REMOTION_EDITABLE_LAYERS.SLIDES, templateSlug),
      label: "Todas las diapositivas",
      detail: `${assetSummary.slideCount}`,
    });
  }

  if (assetSummary.brollCount > 0) {
    layers.push({
      ...getInternalLayerOption(REMOTION_EDITABLE_LAYERS.BROLL, templateSlug),
      label: "Todo el B-roll",
      detail: `${assetSummary.brollCount}`,
    });
  }

  if (assetSummary.slideCount > 0 || assetSummary.brollCount > 0) {
    layers.push({
      ...getInternalLayerOption(REMOTION_EDITABLE_LAYERS.PRIMARY_VISUAL, templateSlug),
      detail: "base",
    });
  }

  if (
    assetSummary.hasAvatar &&
    (assetSummary.slideCount > 0 || assetSummary.brollCount > 0) &&
    templateSlug === ASSEMBLY_TEMPLATES.AVATAR_FOCUS
  ) {
    layers.push({
      ...getInternalLayerOption(REMOTION_EDITABLE_LAYERS.SUPPORT_STRIP, templateSlug),
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

export function resetLayoutLayerToDefault(params: {
  manifest: LayoutOverrideManifest;
  layerId: string;
  editableLayers: LayoutLayerOption[];
}): LayoutOverrideManifest {
  const selectedLayer = params.editableLayers.find(
    (layer) => layer.id === params.layerId,
  );
  const withoutSelectedLayer = removeLayoutLayerEdits(
    params.manifest,
    params.layerId,
  );
  if (!selectedLayer?.canReorder) return withoutSelectedLayer;

  const stackGroup = selectedLayer.stackGroup ?? "root";
  const siblingIds = new Set(
    params.editableLayers
      .filter(
        (layer) =>
          layer.canReorder && (layer.stackGroup ?? "root") === stackGroup,
      )
      .map((layer) => layer.id),
  );

  return {
    ...withoutSelectedLayer,
    edits: withoutSelectedLayer.edits.filter(
      (edit) => edit.kind !== "stack" || !siblingIds.has(edit.layerId),
    ),
  };
}

export function getEffectiveLayoutLayerStackOrder(
  manifest: LayoutOverrideManifest,
  layer: LayoutLayerOption,
): number {
  return (
    readLayoutLayerEdit(manifest, layer.id, "stack")?.order ??
    layer.defaultStackOrder ??
    0
  );
}

export function getLayoutLayerStackPosition(params: {
  manifest: LayoutOverrideManifest;
  layerId: string;
  editableLayers: LayoutLayerOption[];
}) {
  const selectedLayer = params.editableLayers.find(
    (layer) => layer.id === params.layerId,
  );
  if (!selectedLayer?.canReorder) {
    return { canMoveBackward: false, canMoveForward: false, index: -1, total: 0 };
  }

  const siblings = getOrderedStackSiblings(
    params.manifest,
    params.editableLayers,
    selectedLayer,
  );
  const index = siblings.findIndex((layer) => layer.id === selectedLayer.id);

  return {
    canMoveBackward: index > 0,
    canMoveForward: index >= 0 && index < siblings.length - 1,
    index,
    total: siblings.length,
  };
}

export function moveLayoutLayerInStack(params: {
  manifest: LayoutOverrideManifest;
  layerId: string;
  editableLayers: LayoutLayerOption[];
  direction: "backward" | "forward";
}): LayoutOverrideManifest {
  const selectedLayer = params.editableLayers.find(
    (layer) => layer.id === params.layerId,
  );
  if (!selectedLayer?.canReorder) return params.manifest;

  const siblings = getOrderedStackSiblings(
    params.manifest,
    params.editableLayers,
    selectedLayer,
  );
  const selectedIndex = siblings.findIndex((layer) => layer.id === selectedLayer.id);
  const targetIndex = selectedIndex + (params.direction === "forward" ? 1 : -1);
  if (selectedIndex < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
    return params.manifest;
  }

  const reordered = [...siblings];
  const selectedOrder = getEffectiveLayoutLayerStackOrder(
    params.manifest,
    reordered[selectedIndex],
  );
  const targetOrder = getEffectiveLayoutLayerStackOrder(
    params.manifest,
    reordered[targetIndex],
  );
  [reordered[selectedIndex], reordered[targetIndex]] = [
    reordered[targetIndex],
    reordered[selectedIndex],
  ];

  if (selectedOrder !== targetOrder) {
    const withSelectedOrder = upsertLayoutLayerEdit(params.manifest, {
      layerId: selectedLayer.id,
      kind: "stack",
      order: targetOrder,
    });
    return upsertLayoutLayerEdit(withSelectedOrder, {
      layerId: siblings[targetIndex].id,
      kind: "stack",
      order: selectedOrder,
    });
  }

  return reordered.reduce(
    (manifest, layer, index) =>
      upsertLayoutLayerEdit(manifest, {
        layerId: layer.id,
        kind: "stack",
        order: (index + 1) * 10,
      }),
    params.manifest,
  );
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
  layerId: string;
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

  if (isSlideItemLayerId(params.layerId)) {
    return getDefaultLayoutLayerBox({
      ...params,
      layerId: REMOTION_EDITABLE_LAYERS.SLIDES,
    });
  }

  if (isBrollItemLayerId(params.layerId)) {
    return getDefaultLayoutLayerBox({
      ...params,
      layerId: REMOTION_EDITABLE_LAYERS.BROLL,
    });
  }

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
  layerId: string;
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
  return {
    id: layer.layerId,
    label: layer.label,
    detail: layer.kind,
    defaultBox: layer.defaultBox ? normalizeLayerBox(layer.defaultBox) : undefined,
    canReorder: layer.capabilities.canReorder,
    defaultStackOrder: layer.defaultStackOrder,
    stackGroup: layer.stackGroup,
  };
}

function shouldShowLayer(layerId: string, assetSummary: LayoutAssetSummary): boolean {
  if (isSlideItemLayerId(layerId)) return assetSummary.slideCount > 0;
  if (isBrollItemLayerId(layerId)) return assetSummary.brollCount > 0;
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

  const normalized = {
    top: roundCropInset(clampCropPair(top, bottom)),
    right: roundCropInset(clampCropPair(right, left)),
    bottom: roundCropInset(clampCropPair(bottom, top)),
    left: roundCropInset(clampCropPair(left, right)),
  };

  const visibleWidth = Math.max(0, 1 - normalized.left - normalized.right);
  const visibleHeight = Math.max(0, 1 - normalized.top - normalized.bottom);

  if (visibleWidth * visibleHeight < MIN_VISIBLE_CROP_AREA_RATIO) {
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }

  return normalized;
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
