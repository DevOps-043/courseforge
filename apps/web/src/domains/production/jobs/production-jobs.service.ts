import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assertProviderSupportsJobType } from "../providers/production-provider-registry";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  PRODUCTION_QA_STATUSES,
  type CompleteBrollPromptJobParams,
  type CreateProductionJobParams,
  type ProductionComponentContext,
  type ProductionJobRecord,
} from "../types/production.types";

interface ArtifactRelation {
  idea_central?: string | null;
  organization_id?: string | null;
}

interface MaterialRelation {
  artifact_id?: string | null;
  artifacts?: ArtifactRelation | ArtifactRelation[] | null;
}

interface MaterialLessonRelation {
  lesson_id?: string | null;
  lesson_title?: string | null;
  materials?: MaterialRelation | MaterialRelation[] | null;
  module_id?: string | null;
  module_title?: string | null;
}

interface MaterialComponentContextRecord {
  id: string;
  material_lesson_id?: string | null;
  material_lessons?: MaterialLessonRelation | MaterialLessonRelation[] | null;
  type: string;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function normalizeError(error: unknown) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name };
  }

  if (typeof error === "object" && error !== null) {
    return error as Record<string, unknown>;
  }

  return { message: String(error) };
}

export function preserveRetryableProviderCheckpoint(
  outputSnapshot: Record<string, unknown> | null | undefined,
) {
  if (!outputSnapshot || typeof outputSnapshot !== "object") return {};
  const speechCheckpoint = outputSnapshot.speech_checkpoint;
  if (!speechCheckpoint || typeof speechCheckpoint !== "object" || Array.isArray(speechCheckpoint)) {
    return {};
  }
  return { speech_checkpoint: speechCheckpoint };
}

export function buildProductionIdempotencyKey(params: {
  componentId: string;
  input: unknown;
  jobType: string;
  provider: string;
}) {
  const hash = createHash("sha256")
    .update(JSON.stringify(params.input))
    .digest("hex")
    .slice(0, 24);

  return [
    params.jobType,
    params.provider,
    params.componentId,
    hash,
  ].join(":");
}

export async function resolveProductionComponentContext(params: {
  componentId: string;
  supabase: SupabaseClient;
}): Promise<ProductionComponentContext> {
  const { componentId, supabase } = params;
  const { data, error } = await supabase
    .from("material_components")
    .select(
      `
        id, type, material_lesson_id,
        material_lessons (
          lesson_id, lesson_title, module_id, module_title,
          materials (
            artifact_id,
            artifacts ( idea_central, organization_id )
          )
        )
      `,
    )
    .eq("id", componentId)
    .single();

  if (error) {
    throw error;
  }

  const component = data as MaterialComponentContextRecord | null;
  if (!component) {
    throw new Error("No se encontro el componente de material.");
  }

  const lesson = firstRelation(component.material_lessons);
  const material = firstRelation(lesson?.materials);
  const artifact = firstRelation(material?.artifacts);

  if (!material?.artifact_id) {
    throw new Error("No se pudo resolver el artefacto del componente.");
  }

  return {
    artifactId: material.artifact_id,
    artifactTitle: artifact?.idea_central || null,
    componentId: component.id,
    componentType: component.type,
    lessonId: lesson?.lesson_id || null,
    lessonTitle: lesson?.lesson_title || null,
    materialLessonId: component.material_lesson_id || null,
    moduleId: lesson?.module_id || null,
    moduleTitle: lesson?.module_title || null,
    organizationId: artifact?.organization_id || null,
  };
}

export async function createOrReuseProductionJob(
  supabase: SupabaseClient,
  params: CreateProductionJobParams & { retryFailed?: boolean },
): Promise<ProductionJobRecord> {
  assertProviderSupportsJobType(params.provider, params.jobType);

  let existingQuery = supabase
    .from("production_jobs")
    .select("id, attempt, output_snapshot, provider_job_id, status")
    .eq("idempotency_key", params.idempotencyKey)
    .eq("job_type", params.jobType)
    .eq("provider", params.provider);

  existingQuery = params.context.organizationId
    ? existingQuery.eq("organization_id", params.context.organizationId)
    : existingQuery.is("organization_id", null);

  const { data: existingJob, error: existingError } =
    await existingQuery.maybeSingle();

  if (existingError) {
    throw existingError;
  }

  if (existingJob?.id) {
    if (
      params.retryFailed &&
      existingJob.status === PRODUCTION_JOB_STATUSES.FAILED
    ) {
      const now = new Date().toISOString();
      const { data: retriedJob, error: retryError } = await supabase
        .from("production_jobs")
        .update({
          attempt: (existingJob.attempt || 1) + 1,
          failed_at: null,
          // Speech generation is synchronous and may already have consumed
          // provider credits. Keep only its recovery checkpoint so a retry can
          // import the same audio instead of generating (and charging) again.
          output_snapshot: preserveRetryableProviderCheckpoint(existingJob.output_snapshot),
          provider_callback_id: null,
          provider_error: null,
          provider_job_id: null,
          provider_request_id: null,
          started_at: null,
          status: PRODUCTION_JOB_STATUSES.PENDING,
          updated_at: now,
        })
        .eq("id", existingJob.id)
        .eq("status", PRODUCTION_JOB_STATUSES.FAILED)
        .select("id, attempt, output_snapshot, provider_job_id, status")
        .maybeSingle();

      if (retryError) throw retryError;
      if (retriedJob?.id) return retriedJob as ProductionJobRecord;

      const { data: concurrentJob, error: concurrentError } = await supabase
        .from("production_jobs")
        .select("id, attempt, output_snapshot, provider_job_id, status")
        .eq("id", existingJob.id)
        .single();
      if (concurrentError) throw concurrentError;
      return concurrentJob as ProductionJobRecord;
    }

    return existingJob as ProductionJobRecord;
  }

  const { data, error } = await supabase
    .from("production_jobs")
    .insert({
      artifact_id: params.context.artifactId,
      created_by: params.createdBy || null,
      estimated_cost_cents: params.estimatedCostCents ?? null,
      idempotency_key: params.idempotencyKey,
      input_snapshot: params.inputSnapshot,
      job_type: params.jobType,
      lesson_id: params.context.lessonId,
      material_component_id: params.context.componentId,
      material_lesson_id: params.context.materialLessonId,
      module_id: params.context.moduleId,
      organization_id: params.context.organizationId,
      provider: params.provider,
      provider_model: params.providerModel || null,
      status: PRODUCTION_JOB_STATUSES.PENDING,
    })
    .select("id, attempt, output_snapshot, provider_job_id, status")
    .single();

  if (error) {
    if ((error as { code?: string }).code === "23505") {
      let concurrentQuery = supabase
        .from("production_jobs")
        .select("id, attempt, output_snapshot, provider_job_id, status")
        .eq("idempotency_key", params.idempotencyKey)
        .eq("job_type", params.jobType)
        .eq("provider", params.provider);
      concurrentQuery = params.context.organizationId
        ? concurrentQuery.eq("organization_id", params.context.organizationId)
        : concurrentQuery.is("organization_id", null);
      const { data: concurrentJob, error: concurrentError } = await concurrentQuery.single();
      if (concurrentError) throw concurrentError;
      return concurrentJob as ProductionJobRecord;
    }
    throw error;
  }

  return data as ProductionJobRecord;
}

/** Atomically grants one worker permission to start a billable provider call. */
export async function claimPendingProductionJob(params: {
  jobId: string;
  supabase: SupabaseClient;
}) {
  const now = new Date().toISOString();
  const { data, error } = await params.supabase
    .from("production_jobs")
    .update({
      started_at: now,
      status: PRODUCTION_JOB_STATUSES.RUNNING,
      updated_at: now,
    })
    .eq("id", params.jobId)
    .eq("status", PRODUCTION_JOB_STATUSES.PENDING)
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return Boolean(data?.id);
}

export async function markProductionJobRunning(params: {
  jobId: string;
  supabase: SupabaseClient;
}) {
  const { jobId, supabase } = params;
  const { error } = await supabase
    .from("production_jobs")
    .update({
      started_at: new Date().toISOString(),
      status: PRODUCTION_JOB_STATUSES.RUNNING,
      updated_at: new Date().toISOString(),
    })
    .eq("id", jobId);

  if (error) {
    throw error;
  }
}

export async function completeBrollPromptProductionJob(
  supabase: SupabaseClient,
  params: CompleteBrollPromptJobParams,
) {
  const now = new Date().toISOString();
  const slideDeckSpec = params.slideDeckSpec;
  const slideCount = Array.isArray(slideDeckSpec?.slides)
    ? slideDeckSpec.slides.length
    : 0;
  const assetRows = [
    {
      artifact_id: params.context.artifactId,
      asset_type: PRODUCTION_ASSET_TYPES.BROLL_PROMPTS,
      content: {
        prompts: params.promptItems,
        text: params.promptsText,
      },
      material_component_id: params.context.componentId,
      material_lesson_id: params.context.materialLessonId,
      lesson_id: params.context.lessonId,
      metadata: {
        component_type: params.context.componentType,
        model: params.model,
      },
      module_id: params.context.moduleId,
      organization_id: params.context.organizationId,
      production_job_id: params.jobId,
      provider: PRODUCTION_PROVIDERS.GEMINI,
      qa_status: PRODUCTION_QA_STATUSES.GENERATED,
    },
    ...(slideDeckSpec
      ? [{
          artifact_id: params.context.artifactId,
          asset_type: PRODUCTION_ASSET_TYPES.SLIDE_DECK_SPEC,
          content: slideDeckSpec,
          material_component_id: params.context.componentId,
          material_lesson_id: params.context.materialLessonId,
          lesson_id: params.context.lessonId,
          metadata: {
            component_type: params.context.componentType,
            generated_with: "video_prompts_generation",
            slide_count: slideCount,
            template: typeof slideDeckSpec.template === "string"
              ? slideDeckSpec.template
              : "course-module",
          },
          module_id: params.context.moduleId,
          organization_id: params.context.organizationId,
          production_job_id: params.jobId,
          provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
          qa_status: PRODUCTION_QA_STATUSES.PENDING,
        }]
      : []),
  ];
  const { error: assetError } = await supabase.from("production_assets").insert(assetRows);

  if (assetError) {
    throw assetError;
  }

  const outputSnapshot: Record<string, unknown> = {
    asset_type: PRODUCTION_ASSET_TYPES.BROLL_PROMPTS,
    prompts_text: params.promptsText,
    prompt_count: params.promptItems.length,
  };

  if (slideDeckSpec) {
    outputSnapshot.slide_deck_spec = {
      asset_type: PRODUCTION_ASSET_TYPES.SLIDE_DECK_SPEC,
      schema_version: slideDeckSpec.schemaVersion,
      slide_count: slideCount,
      template: slideDeckSpec.template,
      prepared_from: "storyboard",
    };
  }

  const { error: jobError } = await supabase
    .from("production_jobs")
    .update({
      completed_at: now,
      output_snapshot: outputSnapshot,
      status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
      updated_at: now,
    })
    .eq("id", params.jobId);

  if (jobError) {
    throw jobError;
  }
}

export async function failProductionJob(params: {
  error: unknown;
  jobId: string;
  outputSnapshot?: Record<string, unknown>;
  supabase: SupabaseClient;
}) {
  const { error: updateError } = await params.supabase
    .from("production_jobs")
    .update({
      failed_at: new Date().toISOString(),
      ...(params.outputSnapshot ? { output_snapshot: params.outputSnapshot } : {}),
      provider_error: normalizeError(params.error),
      status: PRODUCTION_JOB_STATUSES.FAILED,
      updated_at: new Date().toISOString(),
    })
    .eq("id", params.jobId);

  if (updateError) {
    throw updateError;
  }
}

export function buildBrollPromptJobInputSnapshot(params: {
  componentId: string;
  storyboard: unknown;
}) {
  return {
    component_id: params.componentId,
    storyboard: params.storyboard,
    job_type: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
  };
}
