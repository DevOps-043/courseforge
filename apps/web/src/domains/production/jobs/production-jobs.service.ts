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
  organization_id?: string | null;
}

interface MaterialRelation {
  artifact_id?: string | null;
  artifacts?: ArtifactRelation | ArtifactRelation[] | null;
}

interface MaterialLessonRelation {
  lesson_id?: string | null;
  materials?: MaterialRelation | MaterialRelation[] | null;
  module_id?: string | null;
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
          lesson_id, module_id,
          materials (
            artifact_id,
            artifacts ( organization_id )
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
    componentId: component.id,
    componentType: component.type,
    lessonId: lesson?.lesson_id || null,
    materialLessonId: component.material_lesson_id || null,
    moduleId: lesson?.module_id || null,
    organizationId: artifact?.organization_id || null,
  };
}

export async function createOrReuseProductionJob(
  supabase: SupabaseClient,
  params: CreateProductionJobParams,
): Promise<ProductionJobRecord> {
  assertProviderSupportsJobType(params.provider, params.jobType);

  let existingQuery = supabase
    .from("production_jobs")
    .select("id, output_snapshot, status")
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
    return existingJob as ProductionJobRecord;
  }

  const { data, error } = await supabase
    .from("production_jobs")
    .insert({
      artifact_id: params.context.artifactId,
      created_by: params.createdBy || null,
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
    .select("id, output_snapshot, status")
    .single();

  if (error) {
    throw error;
  }

  return data as ProductionJobRecord;
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
  const { error: assetError } = await supabase.from("production_assets").insert({
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
  });

  if (assetError) {
    throw assetError;
  }

  const { error: jobError } = await supabase
    .from("production_jobs")
    .update({
      completed_at: now,
      output_snapshot: {
        asset_type: PRODUCTION_ASSET_TYPES.BROLL_PROMPTS,
        prompts_text: params.promptsText,
        prompt_count: params.promptItems.length,
      },
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
  supabase: SupabaseClient;
}) {
  const { error: updateError } = await params.supabase
    .from("production_jobs")
    .update({
      failed_at: new Date().toISOString(),
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
