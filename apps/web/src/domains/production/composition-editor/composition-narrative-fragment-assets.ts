import { z } from "zod";
import type { CompositionClip } from "./composition-document.types";
import type { NarrativeFragmentAssetBinding } from "./composition-narrative-fragment.types";
import { PRODUCTION_ASSET_TYPES as ASSET_TYPES, PRODUCTION_QA_STATUSES as QA_STATUSES } from "../types/production.types";

const AUDIO_ASSET_TYPES = new Set<string>([ASSET_TYPES.VOICE_AUDIO, ASSET_TYPES.PROCESSED_AUDIO, ASSET_TYPES.SOURCE_MEDIA]);
const VIDEO_ASSET_TYPES = new Set<string>([ASSET_TYPES.AVATAR_VIDEO_CLIP, ASSET_TYPES.AVATAR_VIDEO, ASSET_TYPES.SOURCE_MEDIA, ASSET_TYPES.FINAL_VIDEO]);

const registrySchema = z.object({ id: z.string().uuid(), organization_id: z.string().uuid(), material_component_id: z.string().uuid(),
  checksum: z.string().regex(/^[a-f0-9]{64}$/), qa_status: z.enum([QA_STATUSES.READY_FOR_QA, QA_STATUSES.APPROVED, QA_STATUSES.EXPORTED, QA_STATUSES.PUBLISHED]),
  asset_type: z.enum([ASSET_TYPES.VOICE_AUDIO, ASSET_TYPES.PROCESSED_AUDIO, ASSET_TYPES.AVATAR_VIDEO_CLIP, ASSET_TYPES.AVATAR_VIDEO, ASSET_TYPES.SOURCE_MEDIA, ASSET_TYPES.FINAL_VIDEO]),
  mime_type: z.string().min(1), duration_milliseconds: z.number().int().positive().nullable().optional() });

/** Registry metadata only. The caller still owns authorized reads and in-transaction rechecks. */
export function resolveNarrativeFragmentAsset(params: { clip: CompositionClip; registryAsset: unknown;
  organizationId: string; componentId: string; linkedAssetIds: readonly string[]; sourceEndSeconds: number }): NarrativeFragmentAssetBinding | null {
  const { clip } = params;
  if (clip.source.type !== "PRODUCTION_ASSET") return null;
  const parsed = registrySchema.safeParse(params.registryAsset);
  if (!parsed.success) return null;
  const asset = parsed.data;
  if (asset.id !== clip.source.productionAssetId || asset.organization_id !== params.organizationId
    || asset.material_component_id !== params.componentId || !params.linkedAssetIds.includes(asset.id)) return null;
  const compatible = clip.kind === "AUDIO" ? /^audio\//i.test(asset.mime_type) && AUDIO_ASSET_TYPES.has(asset.asset_type)
    : clip.kind === "VIDEO" ? /^video\//i.test(asset.mime_type) && VIDEO_ASSET_TYPES.has(asset.asset_type)
      : clip.kind === "IMAGE" && /^image\//i.test(asset.mime_type) && asset.asset_type === ASSET_TYPES.SOURCE_MEDIA;
  if (!compatible || (clip.kind !== "IMAGE" && (!asset.duration_milliseconds || params.sourceEndSeconds > asset.duration_milliseconds / 1000))) return null;
  return { assetId: asset.id, checksum: asset.checksum, qaStatus: asset.qa_status, durationMilliseconds: asset.duration_milliseconds ?? null };
}
