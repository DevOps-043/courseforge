import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getErrorMessage } from "@/lib/errors";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { signBackgroundPayload } from "@/lib/server/background-payload-signature";
import type { MaterialAssets } from "@/domains/materials/types/materials.types";
import {
  getAuthenticatedUser,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
  MaterialComponentLookupUnavailableError,
} from "@/lib/server/artifact-action-auth";
import { verifyBackgroundPayload } from "@/lib/server/background-payload-signature";
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
import { generateCourseDeckWithCopySynthesisQualityGate } from "@/domains/production/slides/generation/course-deck-generation-orchestrator.service";
import { loadSlideSourcePack } from "@/domains/production/slides/data/slide-source-pack-loader.service";
import {
  resolveSlideAgentModelConfig,
  resolveSlideAgentPromptConfig,
} from "@/domains/production/slides/agents/slide-agent-prompt-resolver.service";
import { renderCourseDeckHtml } from "@/domains/production/slides/render/html-deck-renderer.service";
import {
  courseDeckSpecSchema,
  slideDeckGenerateInputSchema,
  type CourseDeckSpec,
} from "@/domains/production/slides/specs/course-deck.schema";
import { validateCourseDeckQuality } from "@/domains/production/slides/validation/course-deck-qa.service";
import {
  planDeckVisualAssets,
  visualAssetPlanSummary,
} from "@/domains/production/slides/visuals/slide-visual-asset-planning.service";
import { generateSlideVisualAssets } from "@/domains/production/slides/visuals/slide-visual-asset-generation.service";

export const runtime = "nodejs";
export const maxDuration = 120;

const BUCKET = "production-assets";
const SLIDE_COPY_PIPELINE_VERSION = "visible-copy-synthesis-v4";

const requestBodySchema = slideDeckGenerateInputSchema.extend({
  appearanceOnly: z.boolean().optional(),
  componentId: z.string().min(1),
  forceRegenerate: z.boolean().optional(),
  regenerationRequestId: z.string().uuid().optional(),
  slideTemplateRunId: z.string().uuid().optional(),
});

function deckBasePath(componentId: string) {
  return `slides/${componentId}-soflia-engine-deck`;
}

function stableFingerprint(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

function copySynthesisSignature(params: {
  locale: "es" | "en";
  model?: { fallbackModel: string | null; modelName: string; temperature: number; thinkingLevel: string | null };
  prompt?: { code: string; content: string; version: string };
  sourcePack: Awaited<ReturnType<typeof loadSlideSourcePack>>;
}) {
  return stableFingerprint({
    locale: params.locale,
    model: params.model,
    pipelineVersion: SLIDE_COPY_PIPELINE_VERSION,
    prompt: params.prompt && {
      code: params.prompt.code,
      contentHash: stableFingerprint(params.prompt.content),
      version: params.prompt.version,
    },
    sources: params.sourcePack.items.map((item) => ({
      excerpt: item.excerpt,
      notes: item.notes,
      rationale: item.rationale,
      ref: item.ref,
    })),
  });
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

function canReusePreparedDeckSpec(params: {
  assets: MaterialAssets;
  componentId: string;
  copySynthesisSignature: string;
  forceRegenerate: boolean;
  slideTemplateRunId?: string;
}) {
  if (params.forceRegenerate) {
    return false;
  }

  if (params.assets.slides?.copy_synthesis_signature !== params.copySynthesisSignature) {
    return false;
  }

  const requestedTemplateRunId = params.slideTemplateRunId || null;
  const storedTemplateRunId = params.assets.slides?.selected_slide_template_run_id || null;
  if (requestedTemplateRunId !== storedTemplateRunId) {
    return false;
  }

  return Boolean(getPreparedDeckSpec(params.assets, params.componentId));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

async function resolveSlideTemplateDesignSystem(params: {
  admin: NonNullable<Awaited<ReturnType<typeof getAuthorizedMaterialComponentAdmin>>>["admin"];
  organizationId: string;
  slideTemplateRunId?: string;
}) {
  if (!params.slideTemplateRunId) return null;

  const { data: run, error } = await params.admin
    .from("soflia_bundle_generation_runs")
    .select("id, organization_id, spec_id, status, bundle_storage_path, validation_report")
    .eq("id", params.slideTemplateRunId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();

  if (error) throw error;
  if (!run) {
    throw new Error("Plantilla de slides no encontrada para esta organizacion.");
  }
  if (run.status !== "PACKAGED" || !run.bundle_storage_path) {
    throw new Error("La plantilla seleccionada aun no esta lista para generar slides.");
  }

  const validationInfo = asRecord(asRecord(run.validation_report)?.info);
  if (validationInfo?.artifactKind && validationInfo.artifactKind !== "slide_template") {
    throw new Error("La plantilla seleccionada no es una plantilla HTML de slides.");
  }

  const { data: specRow, error: specError } = await params.admin
    .from("soflia_bundle_specs")
    .select("spec_json")
    .eq("id", run.spec_id)
    .eq("organization_id", params.organizationId)
    .maybeSingle();

  if (specError) throw specError;
  const spec = asRecord(specRow?.spec_json);
  if (spec?.artifactKind !== "slide_template") {
    throw new Error("La spec de la plantilla seleccionada no es valida para slides HTML.");
  }

  const blueprint = asRecord(spec.templateBlueprint);
  const designTokens = asRecord(blueprint?.designTokens);
  const modifiers = asRecord(blueprint?.modifiers);
  const visualSlots = Object.fromEntries(
    (Array.isArray(blueprint?.layouts) ? blueprint.layouts : [])
      .flatMap((rawLayout) => {
        const layout = asRecord(rawLayout);
        return layout && typeof layout.id === "string" && Array.isArray(layout.imageSlots)
          ? [[layout.id, layout.imageSlots]]
          : [];
      }),
  );

  return {
    accent: typeof designTokens?.accent === "string" ? designTokens.accent : undefined,
    accent2: typeof designTokens?.accent2 === "string" ? designTokens.accent2 : undefined,
    background: typeof designTokens?.background === "string" ? designTokens.background : undefined,
    fontPairing: typeof modifiers?.fontPairing === "string" ? modifiers.fontPairing : undefined,
    muted: typeof designTokens?.muted === "string" ? designTokens.muted : undefined,
    selectedSlideTemplateRunId: run.id as string,
    surface: typeof designTokens?.surface === "string" ? designTokens.surface : undefined,
    text: typeof designTokens?.text === "string" ? designTokens.text : undefined,
    title: typeof spec.title === "string" ? spec.title : null,
    visualSlots: Object.keys(visualSlots).length > 0 ? visualSlots : undefined,
    visualStyleGuide: typeof blueprint?.visualStyleGuide === "string"
      ? blueprint.visualStyleGuide
      : undefined,
  };
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

  const { componentId } = parsed.data;
  const internalRequest = getAutomationRequest(request, componentId);
  const supabase = internalRequest ? null : await createClient();
  const authenticatedUser = internalRequest
    ? { userId: internalRequest.createdBy }
    : await getAuthenticatedUser(supabase!);
  if (!authenticatedUser) return NextResponse.json({ error: "No autorizado." }, { status: 401 });

  let authorizedComponent;
  try {
    authorizedComponent = internalRequest
      ? await getInternalAuthorizedComponent(componentId, internalRequest.organizationId)
      : await getAuthorizedMaterialComponentAdmin(componentId);
  } catch (error) {
    if (error instanceof MaterialComponentLookupUnavailableError) {
      return NextResponse.json(
        {
          code: error.code,
          error: error.message,
          retryable: error.retryable,
        },
        {
          headers: { "Retry-After": "5" },
          status: 503,
        },
      );
    }
    throw error;
  }
  if (!authorizedComponent) {
    return NextResponse.json(
      { error: "Componente no encontrado para esta empresa" },
      { status: 404 },
    );
  }

  const queueContext = await resolveProductionComponentContext({
    componentId,
    supabase: authorizedComponent.admin,
  });
  if (!queueContext.organizationId) {
    return NextResponse.json(
      { error: "No se pudo resolver la organizacion del componente." },
      { status: 409 },
    );
  }

  const backgroundRequest = {
    createdBy: authenticatedUser.userId,
    organizationId: queueContext.organizationId,
    payload: parsed.data,
  };
  const queuedAt = new Date().toISOString();
  try {
    await callBackgroundFunctionJson(
      "slides-generation-background",
      signBackgroundPayload(backgroundRequest),
      {
        fallbackError: "No se pudo iniciar el worker de slides.",
        localHandlerLoader: async () => ({
          handler: async () => {
            const result = await runSlideDeckGeneration({
              authorizedComponent,
              createdBy: authenticatedUser.userId,
              payload: parsed.data,
            });
            return { statusCode: result.status, body: await result.text() };
          },
        }),
      },
    );
  } catch (error) {
    return NextResponse.json(
      { error: getErrorMessage(error, "No se pudo iniciar el worker de slides.") },
      { status: 503 },
    );
  }

  return NextResponse.json(
    {
      success: true,
      job: null,
      queuedAt,
      status: "QUEUED",
      submissionStatus: "QUEUED",
    },
    { status: 202 },
  );
}

export async function runSlideDeckGeneration(params: {
  authorizedComponent: NonNullable<Awaited<ReturnType<typeof getAuthorizedMaterialComponentAdmin>>>;
  createdBy: string;
  payload: z.infer<typeof requestBodySchema>;
}) {
  const {
    appearanceOnly = false,
    componentId,
    forceRegenerate = false,
    regenerationRequestId,
    slideTemplateRunId,
    ...input
  } = params.payload;
  const authorizedComponent = params.authorizedComponent;

  const context = await resolveProductionComponentContext({
    componentId,
    supabase: authorizedComponent.admin,
  });
  if (context.artifactId !== authorizedComponent.artifactId) {
    return NextResponse.json({ error: "Componente no encontrado para esta empresa" }, { status: 404 });
  }
  const currentAssets = (authorizedComponent.component.assets || {}) as MaterialAssets;
  const sourcePack = await loadSlideSourcePack({
    artifactId: authorizedComponent.artifactId,
    lessonId: context.lessonId,
    sourceRefs: (authorizedComponent.component as { source_refs?: unknown }).source_refs,
    supabase: authorizedComponent.admin,
  });
  const agentPrompts = await resolveSlideAgentPromptConfig(
    authorizedComponent.admin,
    context.organizationId,
  );
  const agentModels = await resolveSlideAgentModelConfig(
    authorizedComponent.admin,
    context.organizationId,
  );
  const synthesisSignature = copySynthesisSignature({
    locale: input.locale,
    model: agentModels.visibleCopy,
    prompt: agentPrompts.visibleCopy,
    sourcePack,
  });
  const inputSnapshot = {
    appearance_only: appearanceOnly,
    component_id: componentId,
    copy_synthesis: {
      signature: synthesisSignature,
      version: SLIDE_COPY_PIPELINE_VERSION,
    },
    force_regenerate: forceRegenerate,
    input,
    job_type: PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
    regeneration_request_id: forceRegenerate ? regenerationRequestId || randomUUID() : null,
    slide_template_run_id: slideTemplateRunId || null,
  };
  const idempotencyKey = buildProductionIdempotencyKey({
    componentId,
    input: inputSnapshot,
    jobType: PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
    provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
  });
  const job = await createOrReuseProductionJob(authorizedComponent.admin, {
    context,
    createdBy: params.createdBy,
    idempotencyKey,
    inputSnapshot,
    jobType: PRODUCTION_JOB_TYPES.SLIDE_DECK_GENERATION,
    provider: PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES,
  });

  if (
    !forceRegenerate &&
    (
      job.status === PRODUCTION_JOB_STATUSES.SUCCEEDED ||
      job.status === PRODUCTION_JOB_STATUSES.RUNNING ||
      job.status === PRODUCTION_JOB_STATUSES.WAITING_PROVIDER
    )
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

    if (slideTemplateRunId && !context.organizationId) {
      throw new Error("No se pudo resolver la organizacion para seleccionar plantilla de slides.");
    }
    const selectedSlideTemplate = await resolveSlideTemplateDesignSystem({
      admin: authorizedComponent.admin,
      organizationId: context.organizationId || "",
      slideTemplateRunId,
    });
    const preparedDeckSpec = input.customSlides?.length ||
      !canReusePreparedDeckSpec({
        assets: currentAssets,
        componentId,
        copySynthesisSignature: synthesisSignature,
        forceRegenerate: forceRegenerate && !appearanceOnly,
        slideTemplateRunId,
      })
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
      : await generateCourseDeckWithCopySynthesisQualityGate({
          artifactId: authorizedComponent.artifactId,
          agentModels,
          agentPrompts,
          component: {
            ...authorizedComponent.component,
            sourcePack,
          },
          input,
        });
    const { deckSpec: generatedDeckSpec, stages } = deckGeneration;
    const deckSpecWithTemplate = selectedSlideTemplate
      ? courseDeckSpecSchema.parse({
          ...generatedDeckSpec,
          appearance: input.appearance,
          designSystem: {
            ...generatedDeckSpec.designSystem,
            accent: selectedSlideTemplate.accent || generatedDeckSpec.designSystem.accent,
            accent2: selectedSlideTemplate.accent2 || generatedDeckSpec.designSystem.accent2,
            background: selectedSlideTemplate.background || generatedDeckSpec.designSystem.background,
            fontPairing: selectedSlideTemplate.fontPairing || generatedDeckSpec.designSystem.fontPairing,
            muted: selectedSlideTemplate.muted || generatedDeckSpec.designSystem.muted,
            surface: selectedSlideTemplate.surface || generatedDeckSpec.designSystem.surface,
            text: selectedSlideTemplate.text || generatedDeckSpec.designSystem.text,
            visualSlots: selectedSlideTemplate.visualSlots || generatedDeckSpec.designSystem.visualSlots,
            visualStyleGuide: selectedSlideTemplate.visualStyleGuide || generatedDeckSpec.designSystem.visualStyleGuide,
          },
        })
      : courseDeckSpecSchema.parse({
          ...generatedDeckSpec,
          appearance: input.appearance,
        });
    const plannedDeckSpec = planDeckVisualAssets({
      deckSpec: deckSpecWithTemplate,
      forceRegenerate: forceRegenerate && !appearanceOnly,
    });
    const backgroundVisuals = input.generateVisuals !== false
      ? await generateSlideVisualAssets({
          admin: authorizedComponent.admin,
          context,
          createdBy: params.createdBy,
          deckSpec: plannedDeckSpec,
          mode: "background",
        })
      : { deckSpec: plannedDeckSpec, generatedCount: 0, jobId: null };
    const supportingVisuals = input.generateVisuals !== false
      ? await generateSlideVisualAssets({
          admin: authorizedComponent.admin,
          context,
          createdBy: params.createdBy,
          deckSpec: backgroundVisuals.deckSpec,
          mode: "supporting",
        })
      : { deckSpec: backgroundVisuals.deckSpec, generatedCount: 0, jobId: null };
    const deckSpec = supportingVisuals.deckSpec;
    const html = renderCourseDeckHtml(deckSpec);
    const qaReport = validateCourseDeckQuality({ deckSpec, html });

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
          appearance: deckSpec.appearance,
          copy_pipeline_version: SLIDE_COPY_PIPELINE_VERSION,
          copy_synthesis_signature: synthesisSignature,
          slide_count: deckSpec.slides.length,
          slide_template_run_id: selectedSlideTemplate?.selectedSlideTemplateRunId || null,
          slide_template_title: selectedSlideTemplate?.title || null,
          template: deckSpec.template,
          qa_status: qaReport.status,
          visual_assets: visualAssetPlanSummary(deckSpec),
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
          appearance: deckSpec.appearance,
          copy_pipeline_version: SLIDE_COPY_PIPELINE_VERSION,
          copy_synthesis_signature: synthesisSignature,
          qa_status: qaReport.status,
          renderer: "soflia-engine-slides-v1",
          slide_template_run_id: selectedSlideTemplate?.selectedSlideTemplateRunId || null,
          slide_template_title: selectedSlideTemplate?.title || null,
          template: deckSpec.template,
          visual_assets: visualAssetPlanSummary(deckSpec),
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
          copy_pipeline_version: SLIDE_COPY_PIPELINE_VERSION,
          copy_synthesis_signature: synthesisSignature,
          finding_count: qaReport.findings.length,
          stage_count: stages.length,
          status: qaReport.status,
          visual_assets: visualAssetPlanSummary(deckSpec),
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

    const assetsPatch: Partial<MaterialAssets> = {
      final_video_assembly_stale: true,
      production_status: "DECK_READY",
      slides_url: htmlUpload.publicUrl,
      slides: {
        ...(currentAssets.slides || {}),
        appearance: deckSpec.appearance,
        copy_pipeline_version: SLIDE_COPY_PIPELINE_VERSION,
        copy_synthesis_signature: synthesisSignature,
        html_content_path: htmlUpload.storagePath,
        html_public_url: htmlUpload.publicUrl,
        open_design_project_id: `soflia-engine-slides-${componentId}`,
        qa_content_path: qaUpload.storagePath,
        qa_report: qaReport as unknown as Record<string, unknown>,
        selected_slide_template_run_id: selectedSlideTemplate?.selectedSlideTemplateRunId,
        selected_slide_template_title: selectedSlideTemplate?.title,
        prepared_spec: deckSpec as unknown as Record<string, unknown>,
        spec_content_path: specUpload.storagePath,
      },
      updated_at: now,
    };

    const { data: updatedAssets, error: updateError } = await authorizedComponent.admin.rpc(
      "patch_material_component_assets",
      {
        p_assets_patch: assetsPatch,
        p_component_id: componentId,
      },
    );

    if (updateError) {
      throw updateError;
    }

    const { error: jobUpdateError } = await authorizedComponent.admin
      .from("production_jobs")
      .update({
        completed_at: now,
        output_snapshot: {
          appearance: deckSpec.appearance,
          background_visual_job_id: backgroundVisuals.jobId,
          background_visuals_generated: backgroundVisuals.generatedCount,
          html_storage_path: htmlUpload.storagePath,
          copy_pipeline_version: SLIDE_COPY_PIPELINE_VERSION,
          copy_synthesis_signature: synthesisSignature,
          qa_status: qaReport.status,
          qa_storage_path: qaUpload.storagePath,
          slide_template_run_id: selectedSlideTemplate?.selectedSlideTemplateRunId || null,
          slide_template_title: selectedSlideTemplate?.title || null,
          spec_storage_path: specUpload.storagePath,
          slide_count: deckSpec.slides.length,
          stages,
          supporting_visual_job_id: supportingVisuals.jobId,
          supporting_visuals_generated: supportingVisuals.generatedCount,
          visual_assets: visualAssetPlanSummary(deckSpec),
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

function getAutomationRequest(request: Request, componentId: string): { createdBy: string; organizationId: string } | null {
  const raw = request.headers.get("x-production-automation");
  if (!raw) return null;
  try {
    const value = verifyBackgroundPayload<{ componentId: string; createdBy: string; organizationId: string }>(JSON.parse(raw));
    return value.componentId === componentId && value.createdBy && value.organizationId ? value : null;
  } catch {
    return null;
  }
}

async function getInternalAuthorizedComponent(componentId: string, organizationId: string) {
  const admin = getServiceRoleClient();
  const { data: component, error } = await admin
    .from("material_components")
    .select("id, type, content, assets, material_lesson_id, material_lessons!inner(materials!inner(artifact_id))")
    .eq("id", componentId)
    .maybeSingle();
  if (error) throw new MaterialComponentLookupUnavailableError();
  if (!component) return null;
  const lesson = Array.isArray(component.material_lessons) ? component.material_lessons[0] : component.material_lessons;
  const materials = Array.isArray(lesson?.materials) ? lesson.materials[0] : lesson?.materials;
  const artifactId = materials?.artifact_id;
  if (!artifactId) return null;
  const { data: artifact, error: artifactError } = await admin
    .from("artifacts")
    .select("organization_id")
    .eq("id", artifactId)
    .maybeSingle();
  if (artifactError) throw new MaterialComponentLookupUnavailableError();
  if (artifact?.organization_id !== organizationId) return null;
  return { admin, artifactId, component };
}
