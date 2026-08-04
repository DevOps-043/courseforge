import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
} from "@/lib/server/artifact-action-auth";
import {
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
  failProductionJob,
  markProductionJobRunning,
  resolveProductionComponentContext,
} from "@/domains/production/jobs/production-jobs.service";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
  PRODUCTION_QA_STATUSES,
} from "@/domains/production/types/production.types";
import { generateCourseDeckWithQualityGate } from "@/domains/production/slides/generation/course-deck-generation-orchestrator.service";
import { renderCourseDeckHtml } from "@/domains/production/slides/render/html-deck-renderer.service";
import {
  courseDeckSpecSchema,
  slideDeckGenerateInputSchema,
  type CourseDeckSpec,
} from "@/domains/production/slides/specs/course-deck.schema";
import { validateCourseDeckQuality } from "@/domains/production/slides/validation/course-deck-qa.service";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "production-assets";

const requestBodySchema = slideDeckGenerateInputSchema.extend({
  componentId: z.string().min(1),
});

function deckBasePath(componentId: string) {
  return `slides/${componentId}-soflia-engine-deck`;
}

function getPreparedDeckSpec(assets: MaterialAssets, componentId: string): CourseDeckSpec | null {
  const preparedSpec = assets.slides?.prepared_spec;
  if (!preparedSpec) {
    return null;
  }

  const parsed = courseDeckSpecSchema.safeParse(preparedSpec);
  if (!parsed.success || parsed.data.materialComponentId !== componentId) {
    return null;
  }

  return parsed.data;
}

async function uploadTextAsset(params: {
  admin: NonNullable<Awaited<ReturnType<typeof getAuthorizedMaterialComponentAdmin>>>["admin"];
  content: string;
  contentType: string;
  storagePath: string;
}) {
  const contentType = params.contentType.split(";")[0]?.trim() || params.contentType;
  const contentBody = Buffer.from(params.content, "utf8");
  const { error } = await params.admin.storage
    .from(BUCKET)
    .upload(params.storagePath, contentBody, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`No se pudo guardar asset de slides: ${error.message}`);
  }

  const {
    data: { publicUrl },
  } = params.admin.storage.from(BUCKET).getPublicUrl(params.storagePath);

  return {
    publicUrl,
    storagePath: `${BUCKET}/${params.storagePath}`,
  };
}

export async function POST(request: Request) {
  const parsed = requestBodySchema.safeParse(await request.json());
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Solicitud invalida.", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const { componentId, ...input } = parsed.data;
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);
  if (!authenticatedUser) {
    return NextResponse.json({ error: "No autorizado." }, { status: 401 });
  }

  const authorizedComponent = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorizedComponent) {
    return NextResponse.json(
      { error: "Componente no encontrado para esta empresa" },
      { status: 404 },
    );
  }

  const context = await resolveProductionComponentContext({
    componentId,
    supabase: authorizedComponent.admin,
  });
  const inputSnapshot = {
    component_id: componentId,
    input,
    job_type: PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
  };
  const idempotencyKey = buildProductionIdempotencyKey({
    componentId,
    input: inputSnapshot,
    jobType: PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
    provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
  });
  const job = await createOrReuseProductionJob(authorizedComponent.admin, {
    context,
    createdBy: authenticatedUser.userId,
    idempotencyKey,
    inputSnapshot,
    jobType: PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
    provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
  });

  if (
    job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED ||
    job.status === PRODUCTION_JOB_STATUSES.RUNNING ||
    job.status === PRODUCTION_JOB_STATUSES.WAITING_PROVIDER
  ) {
    return NextResponse.json({
      success: true,
      reused: true,
      job,
      assets: authorizedComponent.component.assets || {},
    });
  }

  try {
    await markProductionJobRunning({
      jobId: job.id,
      supabase: authorizedComponent.admin,
    });

    const currentAssets = (authorizedComponent.component.assets || {}) as MaterialAssets;
    const preparedDeckSpec = input.customSlides?.length
      ? null
      : getPreparedDeckSpec(currentAssets, componentId);
    const deckGeneration = preparedDeckSpec
      ? (() => {
          const html = renderCourseDeckHtml(preparedDeckSpec);
          const qaReport = validateCourseDeckQuality({
            deckSpec: preparedDeckSpec,
            html,
          });

          return {
            deckSpec: preparedDeckSpec,
            html,
            qaReport,
            stages: [
              {
                durationMs: 0,
                name: "deck_brief",
                status: "success",
                summary: "Spec preparado desde storyboard de produccion.",
              },
              {
                durationMs: 0,
                name: "slide_plan",
                status: "success",
                summary: `Se reutilizaron ${preparedDeckSpec.slides.length} slides preparadas.`,
              },
              {
                durationMs: 0,
                name: "chart_data",
                status: "success",
                summary: "Graficas resueltas desde el spec preparado.",
              },
              {
                durationMs: 0,
                name: "visual_direction",
                status: "success",
                summary: `Template ${preparedDeckSpec.template}.`,
              },
              {
                durationMs: 0,
                name: "html_render",
                status: "success",
                summary: "HTML renderizado desde spec preparado.",
              },
              {
                durationMs: 0,
                name: "quality_gate",
                status: "success",
                summary: `QA ${qaReport.status}.`,
              },
            ],
          };
        })()
      : generateCourseDeckWithQualityGate({
          artifactId: authorizedComponent.artifactId,
          component: authorizedComponent.component,
          input,
        });
    const { deckSpec, html, qaReport, stages } = deckGeneration;

    if (qaReport.status === "FAIL") {
      const failingCodes = qaReport.findings
        .filter((finding) => finding.severity === "error")
        .map((finding) => finding.code)
        .join(", ");
      throw new Error(`Deck SofLIA - Engine no paso QA: ${failingCodes}`);
    }

    const basePath = deckBasePath(componentId);
    const specUpload = await uploadTextAsset({
      admin: authorizedComponent.admin,
      content: JSON.stringify(deckSpec, null, 2),
      contentType: "application/json",
      storagePath: `${basePath}.json`,
    });
    const htmlUpload = await uploadTextAsset({
      admin: authorizedComponent.admin,
      content: html,
      contentType: "text/html",
      storagePath: `${basePath}.html`,
    });
    const qaUpload = await uploadTextAsset({
      admin: authorizedComponent.admin,
      content: JSON.stringify(qaReport, null, 2),
      contentType: "application/json",
      storagePath: `${basePath}.qa.json`,
    });

    const now = new Date().toISOString();
    const assetRows = [
      {
        artifact_id: context.artifactId,
        asset_type: PRODUCTION_ASSET_TYPES.SLIDE_DECK_SPEC,
        content: deckSpec,
        material_component_id: context.componentId,
        material_lesson_id: context.materialLessonId,
        lesson_id: context.lessonId,
        metadata: {
          slide_count: deckSpec.slides.length,
          template: deckSpec.template,
          qa_status: qaReport.status,
        },
        module_id: context.moduleId,
        organization_id: context.organizationId,
        production_job_id: job.id,
        provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
        qa_status: PRODUCTION_QA_STATUSES.GENERATED,
        storage_bucket: BUCKET,
        storage_path: specUpload.storagePath,
      },
      {
        artifact_id: context.artifactId,
        asset_type: PRODUCTION_ASSET_TYPES.SLIDE_DECK_HTML,
        content: {
          deck_schema_version: deckSpec.schemaVersion,
          slide_count: deckSpec.slides.length,
        },
        material_component_id: context.componentId,
        material_lesson_id: context.materialLessonId,
        lesson_id: context.lessonId,
        metadata: {
          qa_status: qaReport.status,
          renderer: "soflia-engine-slides-v1",
          template: deckSpec.template,
        },
        mime_type: "text/html",
        module_id: context.moduleId,
        organization_id: context.organizationId,
        production_job_id: job.id,
        provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
        public_url: htmlUpload.publicUrl,
        qa_status: PRODUCTION_QA_STATUSES.READY_FOR_QA,
        storage_bucket: BUCKET,
        storage_path: htmlUpload.storagePath,
      },
      {
        artifact_id: context.artifactId,
        asset_type: PRODUCTION_ASSET_TYPES.SLIDE_DECK_QA_REPORT,
        content: qaReport,
        material_component_id: context.componentId,
        material_lesson_id: context.materialLessonId,
        lesson_id: context.lessonId,
        metadata: {
          finding_count: qaReport.findings.length,
          stage_count: stages.length,
          status: qaReport.status,
        },
        module_id: context.moduleId,
        organization_id: context.organizationId,
        production_job_id: job.id,
        provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
        qa_status: PRODUCTION_QA_STATUSES.GENERATED,
        storage_bucket: BUCKET,
        storage_path: qaUpload.storagePath,
      },
    ];
    const { error: assetError } = await authorizedComponent.admin
      .from("production_assets")
      .insert(assetRows);

    if (assetError) {
      throw assetError;
    }

    const updatedAssets: MaterialAssets = {
      ...currentAssets,
      final_video_assembly_stale: true,
      production_status: "DECK_READY",
      slides_url: htmlUpload.publicUrl,
      slides: {
        ...(currentAssets.slides || {}),
        html_content_path: htmlUpload.storagePath,
        html_public_url: htmlUpload.publicUrl,
        open_design_project_id: `soflia-engine-slides-${componentId}`,
        qa_content_path: qaUpload.storagePath,
        qa_report: qaReport as unknown as Record<string, unknown>,
        spec_content_path: specUpload.storagePath,
      },
      updated_at: now,
    };

    const { error: updateError } = await authorizedComponent.admin
      .from("material_components")
      .update({ assets: updatedAssets })
      .eq("id", componentId);

    if (updateError) {
      throw updateError;
    }

    const { error: jobUpdateError } = await authorizedComponent.admin
      .from("production_jobs")
      .update({
        completed_at: now,
        output_snapshot: {
          html_storage_path: htmlUpload.storagePath,
          qa_status: qaReport.status,
          qa_storage_path: qaUpload.storagePath,
          spec_storage_path: specUpload.storagePath,
          slide_count: deckSpec.slides.length,
          stages,
        },
        status: PRODUCTION_JOB_STATUSES.SUCCEEDED,
        updated_at: now,
      })
      .eq("id", job.id);

    if (jobUpdateError) {
      throw jobUpdateError;
    }

    return NextResponse.json({
      success: true,
      assets: updatedAssets,
      deckSpec,
      htmlPublicUrl: htmlUpload.publicUrl,
      jobId: job.id,
      qaReport,
      stages,
    });
  } catch (error: unknown) {
    await failProductionJob({
      error,
      jobId: job.id,
      supabase: authorizedComponent.admin,
    });
    console.error("[production/slides/generate] Unexpected error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo generar el deck." },
      { status: 500 },
    );
  }
}
