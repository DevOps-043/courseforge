import { createHash } from "node:crypto";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getOptionalOpenAIApiKey } from "@/lib/server/env";
import { getPipelineModelSettings } from "@/lib/server/model-settings";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
  markProductionJobRunning,
  failProductionJob,
} from "@/domains/production/jobs/production-jobs.service";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  PRODUCTION_QA_STATUSES,
  type ProductionComponentContext,
} from "@/domains/production/types/production.types";
import type {
  CourseDeckSpec,
  CourseVisualAsset,
  CourseVisualAssetPurpose,
} from "../specs/course-deck.schema";

const STORAGE_BUCKET = "production-assets";

type VisualAssetGenerationMode = "background" | "supporting";

interface VisualAssetGenerationResult {
  deckSpec: CourseDeckSpec;
  generatedCount: number;
  jobId: string | null;
  skippedReason?: "missing_openai_key" | "no_planned_assets" | "reused_job";
}

function modeForPurpose(purpose: CourseVisualAssetPurpose): VisualAssetGenerationMode {
  return purpose === "background" ? "background" : "supporting";
}

function jobTypeForMode(mode: VisualAssetGenerationMode) {
  return mode === "background"
    ? PRODUCTION_JOB_TYPES.SLIDE_BACKGROUND_GENERATION
    : PRODUCTION_JOB_TYPES.SLIDE_SUPPORTING_IMAGE_GENERATION;
}

function visualAssetsForSlide(slide: CourseDeckSpec["slides"][number]) {
  return slide.visualAssets || { background: null, supporting: null };
}

function assetForMode(slide: CourseDeckSpec["slides"][number], mode: VisualAssetGenerationMode) {
  const visualAssets = visualAssetsForSlide(slide);
  return mode === "background" ? visualAssets.background : visualAssets.supporting;
}

function updateAssetForMode(
  slide: CourseDeckSpec["slides"][number],
  mode: VisualAssetGenerationMode,
  asset: CourseVisualAsset,
) {
  return {
    ...slide,
    visualAssets: {
      ...visualAssetsForSlide(slide),
      [mode]: asset,
    },
  };
}

function storageObjectPath(componentId: string, asset: CourseVisualAsset) {
  const extension = "png";
  return `slides/${componentId}/visuals/${asset.purpose}/${asset.id}.${extension}`;
}

function collectPlannedAssets(deckSpec: CourseDeckSpec, mode: VisualAssetGenerationMode) {
  return deckSpec.slides.flatMap((slide) => {
    const asset = assetForMode(slide, mode);
    return asset?.status === "PLANNED" ? [{ asset, slideId: slide.id }] : [];
  });
}

function updateDeckAsset(
  deckSpec: CourseDeckSpec,
  slideId: string,
  mode: VisualAssetGenerationMode,
  asset: CourseVisualAsset,
) {
  return {
    ...deckSpec,
    slides: deckSpec.slides.map((slide) =>
      slide.id === slideId ? updateAssetForMode(slide, mode, asset) : slide),
  };
}

async function uploadGeneratedImage(params: {
  admin: SupabaseClient;
  asset: CourseVisualAsset;
  componentId: string;
  image: Buffer;
}) {
  const path = storageObjectPath(params.componentId, params.asset);
  const { error } = await params.admin.storage.from(STORAGE_BUCKET).upload(path, params.image, {
    contentType: "image/png",
    upsert: false,
  });

  if (error) {
    throw new Error(`No se pudo guardar imagen de slide: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = params.admin.storage.from(STORAGE_BUCKET).getPublicUrl(path);

  return {
    checksum: createHash("sha256").update(params.image).digest("hex"),
    publicUrl,
    storagePath: `${STORAGE_BUCKET}/${path}`,
  };
}

async function persistGeneratedAsset(params: {
  admin: SupabaseClient;
  asset: CourseVisualAsset;
  context: ProductionComponentContext;
  image: Buffer;
  jobId: string;
  model: string;
  publicUrl: string;
  storagePath: string;
}) {
  const { error } = await params.admin.from("production_assets").insert({
    artifact_id: params.context.artifactId,
    asset_type: PRODUCTION_ASSET_TYPES.SLIDE_IMAGE_SET,
    checksum: params.asset.checksum,
    content: {
      alt_text: params.asset.altText,
      prompt_hash: params.asset.promptHash,
      source_refs: params.asset.sourceRefs,
    },
    file_size_bytes: params.image.byteLength,
    lesson_id: params.context.lessonId,
    material_component_id: params.context.componentId,
    material_lesson_id: params.context.materialLessonId,
    metadata: {
      purpose: params.asset.purpose,
      slide_asset_id: params.asset.id,
      slot_id: params.asset.slot.id,
      slot_placement: params.asset.slot.placement,
      model: params.model,
    },
    mime_type: "image/png",
    module_id: params.context.moduleId,
    organization_id: params.context.organizationId,
    production_job_id: params.jobId,
    provider: PRODUCTION_PROVIDERS.OPENAI,
    public_url: params.publicUrl,
    qa_status: PRODUCTION_QA_STATUSES.GENERATED,
    storage_bucket: STORAGE_BUCKET,
    storage_path: params.storagePath,
  });

  if (error) throw error;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function restoreAssetsFromCompletedJob(params: {
  admin: SupabaseClient;
  deckSpec: CourseDeckSpec;
  jobId: string;
  mode: VisualAssetGenerationMode;
}) {
  const { data, error } = await params.admin
    .from("production_assets")
    .select("checksum, content, metadata, public_url, storage_path")
    .eq("production_job_id", params.jobId)
    .eq("asset_type", PRODUCTION_ASSET_TYPES.SLIDE_IMAGE_SET);
  if (error) throw error;

  const assetsById = new Map((data || []).flatMap((row) => {
    const metadata = asRecord(row.metadata);
    const assetId = typeof metadata.slide_asset_id === "string" ? metadata.slide_asset_id : null;
    return assetId ? [[assetId, row] as const] : [];
  }));

  let deckSpec = params.deckSpec;
  for (const slide of deckSpec.slides) {
    const plannedAsset = assetForMode(slide, params.mode);
    const persisted = plannedAsset ? assetsById.get(plannedAsset.id) : null;
    if (!plannedAsset || !persisted || !persisted.public_url || !persisted.storage_path || !persisted.checksum) continue;

    deckSpec = updateDeckAsset(deckSpec, slide.id, params.mode, {
      ...plannedAsset,
      checksum: persisted.checksum,
      status: "READY",
      storagePath: persisted.storage_path,
      url: persisted.public_url,
    });
  }

  return deckSpec;
}

async function generateImageWithConfiguredModels(params: {
  client: OpenAI;
  fallbackModel: string | null;
  model: string;
  prompt: string;
}) {
  try {
    const response = await params.client.images.generate({
      model: params.model,
      prompt: params.prompt,
      size: "1536x1024",
    });
    return { model: params.model, response };
  } catch (primaryError) {
    const fallbackModel = params.fallbackModel?.trim();
    if (!fallbackModel || fallbackModel === params.model) {
      throw primaryError;
    }

    const response = await params.client.images.generate({
      model: fallbackModel,
      prompt: params.prompt,
      size: "1536x1024",
    });
    return { model: fallbackModel, response };
  }
}

export async function generateSlideVisualAssets(params: {
  admin: SupabaseClient;
  context: ProductionComponentContext;
  createdBy: string;
  deckSpec: CourseDeckSpec;
  mode: VisualAssetGenerationMode;
}): Promise<VisualAssetGenerationResult> {
  const plannedAssets = collectPlannedAssets(params.deckSpec, params.mode);
  if (plannedAssets.length === 0) {
    return { deckSpec: params.deckSpec, generatedCount: 0, jobId: null, skippedReason: "no_planned_assets" };
  }

  const apiKey = getOptionalOpenAIApiKey();
  if (!apiKey) {
    return { deckSpec: params.deckSpec, generatedCount: 0, jobId: null, skippedReason: "missing_openai_key" };
  }

  const imageModelSettings = await getPipelineModelSettings(
    "SLIDES_IMAGE_GENERATION",
    params.context.organizationId,
  );
  const model = imageModelSettings.model_name;
  const jobInput = {
    assets: plannedAssets.map(({ asset, slideId }) => ({
      prompt_hash: asset.promptHash,
      purpose: asset.purpose,
      slide_id: slideId,
      slot_id: asset.slot.id,
    })),
    component_id: params.context.componentId,
    job_type: jobTypeForMode(params.mode),
    fallback_model: imageModelSettings.fallback_model,
    model,
  };
  const job = await createOrReuseProductionJob(params.admin, {
    context: params.context,
    createdBy: params.createdBy,
    idempotencyKey: buildProductionIdempotencyKey({
      componentId: params.context.componentId,
      input: jobInput,
      jobType: jobTypeForMode(params.mode),
      provider: PRODUCTION_PROVIDERS.OPENAI,
    }),
    inputSnapshot: jobInput,
    jobType: jobTypeForMode(params.mode),
    provider: PRODUCTION_PROVIDERS.OPENAI,
    providerModel: model,
  });

  if (job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED) {
    return {
      deckSpec: await restoreAssetsFromCompletedJob({
        admin: params.admin,
        deckSpec: params.deckSpec,
        jobId: job.id,
        mode: params.mode,
      }),
      generatedCount: 0,
      jobId: job.id,
      skippedReason: "reused_job",
    };
  }

  if (
    job.status === PRODUCTION_JOB_STATUSES.RUNNING ||
    job.status === PRODUCTION_JOB_STATUSES.WAITING_PROVIDER
  ) {
    return { deckSpec: params.deckSpec, generatedCount: 0, jobId: job.id, skippedReason: "reused_job" };
  }

  try {
    await markProductionJobRunning({ jobId: job.id, supabase: params.admin });
    const client = new OpenAI({ apiKey });
    let deckSpec = params.deckSpec;
    let generatedCount = 0;
    const failures: Array<{ assetId: string; message: string }> = [];

    for (const planned of plannedAssets) {
      try {
        const generatedImage = await generateImageWithConfiguredModels({
          client,
          fallbackModel: imageModelSettings.fallback_model,
          model,
          prompt: planned.asset.prompt,
        });
        const response = generatedImage.response;
        const encodedImage = response.data?.[0]?.b64_json;
        if (!encodedImage) {
          throw new Error("GPT Image no devolvio datos de imagen.");
        }

        const image = Buffer.from(encodedImage, "base64");
        const uploaded = await uploadGeneratedImage({
          admin: params.admin,
          asset: planned.asset,
          componentId: params.context.componentId,
          image,
        });
        const readyAsset: CourseVisualAsset = {
          ...planned.asset,
          checksum: uploaded.checksum,
          status: "READY",
          storagePath: uploaded.storagePath,
          url: uploaded.publicUrl,
        };
        await persistGeneratedAsset({
          admin: params.admin,
          asset: readyAsset,
          context: params.context,
          image,
          jobId: job.id,
          model: generatedImage.model,
          publicUrl: uploaded.publicUrl,
          storagePath: uploaded.storagePath,
        });
        deckSpec = updateDeckAsset(deckSpec, planned.slideId, params.mode, readyAsset);
        generatedCount += 1;
      } catch (error) {
        const message = error instanceof Error ? error.message : "No se pudo generar la imagen.";
        failures.push({ assetId: planned.asset.id, message });
        deckSpec = updateDeckAsset(deckSpec, planned.slideId, params.mode, {
          ...planned.asset,
          failureReason: message,
          status: "FAILED",
        });
      }
    }

    const now = new Date().toISOString();
    const { error } = await params.admin.from("production_jobs").update({
      completed_at: now,
      output_snapshot: {
        failures,
        generated_count: generatedCount,
        requested_count: plannedAssets.length,
      },
      status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
      updated_at: now,
    }).eq("id", job.id);
    if (error) throw error;

    return { deckSpec, generatedCount, jobId: job.id };
  } catch (error) {
    await failProductionJob({ error, jobId: job.id, supabase: params.admin });
    throw error;
  }
}

export function visualGenerationModeForPurpose(purpose: CourseVisualAssetPurpose) {
  return modeForPurpose(purpose);
}
