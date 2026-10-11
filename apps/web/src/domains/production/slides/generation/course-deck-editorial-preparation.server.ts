import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CourseDeckSpec } from "../specs/course-deck.schema";
import { buildCourseDeckEditableArtifact, COURSE_DECK_EDITORIAL_VERSION, CourseDeckEditorialError } from "../render/course-deck-editable-artifact.server";
import { createHash } from "node:crypto";
import { PRODUCTION_ASSET_TYPES, PRODUCTION_QA_STATUSES } from "../../types/production.types";
import { assertCourseDeckEditorialFontReady } from "./course-deck-editorial-fonts.server";

const registryRowSchema = z.object({ id: z.string().uuid(), storage_path: z.string(),
  checksum: z.string().nullable(), metadata: z.object({ slide_asset_id: z.string() }).passthrough() });
const EDITORIAL_REGISTRY_POLICY = Object.freeze({ maximumCandidatesPerSlot: 4 });

/** Server-only lookup of exact generated image records. A model slot ID, URL,
 * checksum, or caller-supplied UUID never grants access to an image. Registration
 * will independently check draft grants again before enabling editing. */
export async function resolveGeneratedCourseDeckImageAssets(params: {
  deck: CourseDeckSpec; organizationId: string; componentId: string; supabase: SupabaseClient; signal?: AbortSignal;
}) {
  params.signal?.throwIfAborted();
  if (params.deck.materialComponentId !== params.componentId) throw new CourseDeckEditorialError("IMAGE_BINDING_MISSING");
  const readyImages = params.deck.slides.flatMap(slide => [slide.visualAssets?.background, slide.visualAssets?.supporting])
    .filter(asset => asset?.status === "READY" && asset.url);
  const imageAssetIds = new Map<string, string>();
  if (readyImages.length) {
    if (readyImages.some(asset => !asset!.storagePath || !asset!.checksum)) throw new CourseDeckEditorialError("IMAGE_BINDING_MISSING");
    const slotIds = [...new Set(readyImages.map(asset => asset!.id))];
    const candidateLimit = slotIds.length * EDITORIAL_REGISTRY_POLICY.maximumCandidatesPerSlot;
    let query = params.supabase.from("production_assets")
      .select("id, storage_path, checksum, metadata")
      .eq("organization_id", params.organizationId).eq("material_component_id", params.componentId)
      .eq("asset_type", PRODUCTION_ASSET_TYPES.SLIDE_IMAGE_SET).neq("qa_status", PRODUCTION_QA_STATUSES.ARCHIVED)
      .in("metadata->>slide_asset_id", slotIds)
      .in("storage_path", [...new Set(readyImages.map(asset => asset!.storagePath!))])
      .in("checksum", [...new Set(readyImages.map(asset => asset!.checksum!))]);
    if (params.signal) query = query.abortSignal(params.signal);
    const { data, error } = await query.limit(candidateLimit + 1);
    params.signal?.throwIfAborted();
    if (error || !data || data.length > candidateLimit) throw new CourseDeckEditorialError("IMAGE_BINDING_MISSING");
    for (const asset of readyImages) {
      const candidates = data.flatMap(row => {
        const parsed = registryRowSchema.safeParse(row);
        return parsed.success && parsed.data.metadata.slide_asset_id === asset!.id
          && parsed.data.storage_path === asset!.storagePath && parsed.data.checksum === asset!.checksum ? [parsed.data] : [];
      });
      if (candidates.length !== 1) throw new CourseDeckEditorialError("IMAGE_BINDING_MISSING");
      imageAssetIds.set(asset!.id, candidates[0].id);
    }
  }
  return imageAssetIds;
}

export async function prepareGeneratedCourseDeckEditorial(params: Parameters<typeof resolveGeneratedCourseDeckImageAssets>[0]) {
  await assertCourseDeckEditorialFontReady({ ...params, font: params.deck.designSystem.font });
  return buildCourseDeckEditableArtifact(params.deck, await resolveGeneratedCourseDeckImageAssets(params));
}

/** Content-addressed artifact only. This neither changes a draft nor installs a
 * catalog. Consumers must reconstruct/verify trusted generation and current
 * tenant/resource authority before registering any fragment. */
export async function storeGeneratedCourseDeckEditorial(params: Parameters<typeof prepareGeneratedCourseDeckEditorial>[0]) {
  z.string().uuid().parse(params.componentId);
  z.string().uuid().parse(params.organizationId);
  const artifact = await prepareGeneratedCourseDeckEditorial(params);
  const serialized = JSON.stringify(artifact);
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  const bucket = "production-assets";
  const storagePath = `slides/${params.componentId}-soflia-engine-deck.editable-${sha256}.json`;
  const { error } = await params.supabase.storage.from(bucket).upload(storagePath, Buffer.from(serialized, "utf8"), {
    contentType: "application/json", upsert: true,
  });
  if (error) throw new Error("COURSE_DECK_EDITORIAL_STORAGE_UNAVAILABLE");
  return { format: COURSE_DECK_EDITORIAL_VERSION, storage_path: `${bucket}/${storagePath}`, sha256,
    source_spec_sha256: artifact.sourceSpecSha256, slide_count: artifact.fragments.length,
    field_count: artifact.fragments.reduce((count, fragment) => count + fragment.template.elements.length, 0),
    activation: artifact.activation };
}
