import { z } from "zod";
import { HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS, hyperframesAssetManifestItemSchema } from "../hyperframes/hyperframes.types";

const uuid = z.string().uuid(), ids = z.array(uuid).max(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS)
  .refine(values => new Set(values).size === values.length);
/** Explicit selection intent, never grants or source/Storage authority. Absence
 * keeps the previous source-draft-scoped acquisition and persisted semantics. */
export const htmlReconstructionResourceSelectionSchema = z.object({
  scope: z.literal("CURRENT_TENANT_RESOURCE_SELECTION_NOT_GRANTS"), productionAssetIds: ids, soundEffectAssetIds: ids,
  branding: z.object({introAssetId: uuid.nullable(), outroAssetId: uuid.nullable()}).strict(),
}).strict().refine(selection => {
  const brands = [...new Set([selection.branding.introAssetId, selection.branding.outroAssetId].filter((id): id is string => id !== null))];
  const selected = [...selection.productionAssetIds, ...selection.soundEffectAssetIds, ...brands];
  return selected.length <= HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS && new Set(selected).size === selected.length;
}, "Selected resource identities must be bounded and unambiguous across source types");
export const htmlReconstructionSelectedResourceBindingSchema = hyperframesAssetManifestItemSchema.extend({
  origin: z.enum(["PRODUCTION", "BRANDING", "SOUND_EFFECT"]),
  placements: z.array(z.enum(["INTRO", "OUTRO"])).min(1).max(2).optional(),
}).strict().refine(binding => binding.origin === "BRANDING" ? binding.placements !== undefined
  && new Set(binding.placements).size === binding.placements.length : binding.placements === undefined);
export type HtmlReconstructionResourceSelection = z.infer<typeof htmlReconstructionResourceSelectionSchema>;
