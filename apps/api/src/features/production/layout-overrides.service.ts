import { z } from 'zod';

export const LAYOUT_OVERRIDE_MANIFEST_VERSION = 1;

const layerIdSchema = z.string().trim().min(1).max(80);
const pixelCoordinateSchema = z.number().finite().min(-10000).max(10000);
const positiveDimensionSchema = z.number().finite().positive().max(10000);
const cropInsetSchema = z.number().finite().min(0).max(1);
const rotationAngleSchema = z.number().finite().min(-180).max(180);

export const editableLayerDefinitionSchema = z.object({
  layerId: layerIdSchema,
  label: z.string().trim().min(1).max(120),
  kind: z.enum([
    'avatar',
    'slides',
    'broll',
    'caption',
    'background',
    'decorative',
    'custom',
  ]),
  capabilities: z.object({
    canMove: z.boolean().default(false),
    canResize: z.boolean().default(false),
    canCrop: z.boolean().default(false),
    canRotate: z.boolean().default(false),
    canHide: z.boolean().default(false),
  }).strict(),
  constraints: z
    .object({
      minWidth: z.number().finite().positive().optional(),
      minHeight: z.number().finite().positive().optional(),
      maxWidth: z.number().finite().positive().optional(),
      maxHeight: z.number().finite().positive().optional(),
      lockAspectRatio: z.boolean().optional(),
      safeArea: z.enum(['full', 'title-safe', 'custom']).optional(),
    })
    .strict()
    .optional(),
}).strict();

export const layoutOverrideEditSchema = z.discriminatedUnion('kind', [
  z.object({
    layerId: layerIdSchema,
    kind: z.literal('position'),
    x: pixelCoordinateSchema,
    y: pixelCoordinateSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal('size'),
    width: positiveDimensionSchema,
    height: positiveDimensionSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal('crop'),
    top: cropInsetSchema,
    right: cropInsetSchema,
    bottom: cropInsetSchema,
    left: cropInsetSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal('rotation'),
    angle: rotationAngleSchema,
  }).strict(),
  z.object({
    layerId: layerIdSchema,
    kind: z.literal('visibility'),
    hidden: z.boolean(),
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

export type EditableLayerDefinition = z.infer<typeof editableLayerDefinitionSchema>;
export type LayoutOverrideManifest = z.infer<typeof layoutOverrideManifestSchema>;
export type LayoutOverrideManifestList = z.infer<typeof layoutOverrideManifestListSchema>;

export function parseLayoutOverrideManifests(raw: unknown): LayoutOverrideManifestList {
  return layoutOverrideManifestListSchema.parse(raw ?? []);
}
