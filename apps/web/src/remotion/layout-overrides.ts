import { z } from "zod";

export const LAYOUT_OVERRIDE_MANIFEST_VERSION = 1;
export const TEMPLATE_LAYOUT_CONTRACT_VERSION = 2;
export const TEMPLATE_LAYOUT_COORDINATE_SPACE = "canvas" as const;

export const editableLayerItemPatternSchema = z.enum([
  "slide:{index}",
  "broll:{order}",
]);

export const editableLayerKindSchema = z.enum([
  "avatar",
  "slides",
  "broll",
  "caption",
  "background",
  "decorative",
  "custom",
]);

export const editableLayerCapabilitiesSchema = z.object({
  canMove: z.boolean().default(false),
  canResize: z.boolean().default(false),
  canCrop: z.boolean().default(false),
  canRotate: z.boolean().default(false),
  canHide: z.boolean().default(false),
  canReorder: z.boolean().default(false),
}).strict();

export const editableLayerDefinitionSchema = z.object({
  layerId: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  kind: editableLayerKindSchema,
  capabilities: editableLayerCapabilitiesSchema,
  defaultStackOrder: z.number().int().min(0).max(1000).optional(),
  stackGroup: z.string().trim().min(1).max(80).optional(),
  itemLayerIdPattern: editableLayerItemPatternSchema.optional(),
  defaultBox: z
    .object({
      x: z.number().finite().min(-10000).max(10000),
      y: z.number().finite().min(-10000).max(10000),
      width: z.number().finite().positive().max(10000),
      height: z.number().finite().positive().max(10000),
    })
    .strict()
    .optional(),
  constraints: z
    .object({
      minWidth: z.number().finite().positive().optional(),
      minHeight: z.number().finite().positive().optional(),
      maxWidth: z.number().finite().positive().optional(),
      maxHeight: z.number().finite().positive().optional(),
      lockAspectRatio: z.boolean().optional(),
      safeArea: z.enum(["full", "title-safe", "custom"]).optional(),
    })
    .strict()
    .optional(),
}).strict();

const layerIdSchema = z.string().trim().min(1).max(80);
const pixelCoordinateSchema = z.number().finite().min(-10000).max(10000);
const positiveDimensionSchema = z.number().finite().positive().max(10000);
const cropInsetSchema = z.number().finite().min(0).max(1);
const rotationAngleSchema = z.number().finite().min(-180).max(180);
const stackOrderSchema = z.number().int().min(0).max(1000);

export const layoutOverrideEditSchema = z.discriminatedUnion("kind", [
  z.object({
    layerId: layerIdSchema,
    kind: z.literal("position"),
    x: pixelCoordinateSchema,
    y: pixelCoordinateSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal("size"),
    width: positiveDimensionSchema,
    height: positiveDimensionSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal("crop"),
    top: cropInsetSchema,
    right: cropInsetSchema,
    bottom: cropInsetSchema,
    left: cropInsetSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal("rotation"),
    angle: rotationAngleSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal("visibility"),
    hidden: z.boolean(),
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal("stack"),
    order: stackOrderSchema,
  }).strict(),
]);

export const layoutOverrideManifestSchema = z.object({
  version: z.literal(LAYOUT_OVERRIDE_MANIFEST_VERSION),
  templateId: z.string().trim().min(1).max(160).optional(),
  templateVersionId: z.string().trim().min(1).max(160).nullable().optional(),
  componentId: z.string().trim().min(1).max(160).optional(),
  canvas: z.object({
    width: z.number().int().positive().max(10000),
    height: z.number().int().positive().max(10000),
    fps: z.number().int().positive().max(240).optional(),
  }).strict(),
  edits: z.array(layoutOverrideEditSchema).max(100).default([]),
}).strict();

export const layoutOverrideManifestListSchema = z
  .array(layoutOverrideManifestSchema)
  .max(20)
  .default([]);

export type EditableLayerDefinition = z.infer<
  typeof editableLayerDefinitionSchema
>;
export type LayoutOverrideEdit = z.infer<typeof layoutOverrideEditSchema>;
export type LayoutOverrideManifest = z.infer<
  typeof layoutOverrideManifestSchema
>;
export type LayoutOverrideManifestInput = z.input<
  typeof layoutOverrideManifestSchema
>;
export type LayoutOverrideManifestList = z.infer<
  typeof layoutOverrideManifestListSchema
>;

export function parseLayoutOverrideManifests(
  raw: unknown,
): LayoutOverrideManifestList {
  return layoutOverrideManifestListSchema.parse(raw ?? []);
}

export function safeParseLayoutOverrideManifests(raw: unknown) {
  return layoutOverrideManifestListSchema.safeParse(raw ?? []);
}

function supportsEditKind(
  layer: EditableLayerDefinition,
  kind: LayoutOverrideEdit["kind"],
): boolean {
  switch (kind) {
    case "position":
      return layer.capabilities.canMove;
    case "size":
      return layer.capabilities.canResize;
    case "crop":
      return layer.capabilities.canCrop;
    case "rotation":
      return layer.capabilities.canRotate;
    case "visibility":
      return layer.capabilities.canHide;
    case "stack":
      return layer.capabilities.canReorder;
  }
}

function matchesItemLayerPattern(layerId: string, pattern: string | undefined) {
  if (pattern === "slide:{index}") return /^slide:\d+$/.test(layerId);
  if (pattern === "broll:{order}") return /^broll:[1-9]\d*$/.test(layerId);
  return false;
}

export function filterLayoutOverridesForEditableLayers(
  manifests: LayoutOverrideManifest[],
  editableLayers: EditableLayerDefinition[],
): LayoutOverrideManifest[] {
  const layersById = new Map(editableLayers.map((layer) => [layer.layerId, layer] as const));

  return manifests.flatMap((manifest) => {
    const edits = manifest.edits.filter((edit) => {
      const directLayer = layersById.get(edit.layerId);
      if (directLayer) return supportsEditKind(directLayer, edit.kind);

      const patternLayer = editableLayers.find((layer) =>
        matchesItemLayerPattern(edit.layerId, layer.itemLayerIdPattern),
      );
      return Boolean(
        patternLayer &&
        edit.kind !== "stack" &&
        supportsEditKind(patternLayer, edit.kind),
      );
    });

    return edits.length > 0 ? [{ ...manifest, edits }] : [];
  });
}
