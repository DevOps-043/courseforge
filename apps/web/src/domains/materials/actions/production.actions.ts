"use server";

import { getErrorMessage } from "@/lib/errors";
import {
  getAccessToken,
  getAuthenticatedUser,
  getAuthorizedArtifactAdmin,
  getAuthorizedMaterialComponentAdmin,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";
import { callBackgroundFunctionJson } from "@/lib/server/background-function-client";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import { getVideoProviderAndId } from "@/lib/video-platform";
import { getProductionApiBaseUrl } from "@/lib/server/production-api-url";
import { DesktopWorkerControlPlane } from "@/lib/server/desktop-worker-control-plane";
import { RenderBatchService } from "@/domains/production/render-batches/render-batch.service";
import {
  renderBatchRequestSchema,
  type RenderBatchRequest,
  type RenderBatchStatusView,
} from "@/domains/production/render-batches/render-batch.types";
import { normalizeAssemblyAssets } from "@/remotion/assembly-assets.normalizer";
import {
  deriveAssemblyTargetDurationSeconds,
  withAssemblyTargetDuration,
} from "@/remotion/assembly-duration";
import { safeParseLayoutOverrideManifests } from "@/remotion/layout-overrides";
import type { LessonVideoData } from "@/domains/publication/types/publication.types";
import {
  buildBrollPromptJobInputSnapshot,
  buildProductionIdempotencyKey,
  createOrReuseProductionJob,
  resolveProductionComponentContext,
} from "@/domains/production/jobs/production-jobs.service";
import {
  PRODUCTION_JOB_STATUSES,
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "@/domains/production/types/production.types";
import { createClient } from "@/utils/supabase/server";
import type {
  MaterialAssets,
  ProductionDodChecklist,
  ProductionStatus,
  StoryboardItem,
} from "../types/materials.types";

interface ProductionArtifactRelation {
  course_id?: string | null;
}

interface ProductionMaterialsRelation {
  artifact_id?: string | null;
  artifacts?: ProductionArtifactRelation | ProductionArtifactRelation[] | null;
}

interface ProductionLessonRelation {
  lesson_id: string;
  lesson_title: string;
  module_title?: string | null;
  materials?: ProductionMaterialsRelation | ProductionMaterialsRelation[] | null;
  module_id?: string | null;
}

interface ProductionComponentRecord {
  assets?: MaterialAssets | null;
  content?: Record<string, unknown> | null;
  material_lesson_id?: string | null;
  material_lessons?: ProductionLessonRelation | ProductionLessonRelation[] | null;
  type: string;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function buildDodChecklist(
  assets: Partial<MaterialAssets>,
): ProductionDodChecklist {
  return {
    has_slides_url: Boolean(assets.slides_url),
    has_video_url: Boolean(assets.video_url),
    has_screencast_url: Boolean(assets.screencast_url),
    has_b_roll_prompts: Boolean(assets.b_roll_prompts),
    has_final_video_url: Boolean(assets.final_video_url),
  };
}

function resolveProductionStatus(
  componentType: string,
  assets: Partial<MaterialAssets> = {},
): ProductionStatus {
  // Si ya existe el video final (subido o enlazado), el asset de producción
  // se considera COMPLETADO directamente en tiempo real.
  if (assets.final_video_url) {
    return "COMPLETED";
  }

  const needsSlides =
    componentType === "VIDEO_THEORETICAL" || componentType === "VIDEO_GUIDE";
  const needsScreencast =
    componentType === "DEMO_GUIDE" || componentType === "VIDEO_GUIDE";
  const needsVoice = componentType.includes("VIDEO");
  
  // A talking head avatar is generally required for theoretical explanation videos
  const needsAvatar = componentType === "VIDEO_THEORETICAL";

  const hasRequiredSlides = !needsSlides || Boolean(assets.slides?.images?.length || assets.slides_url);
  const hasRequiredScreencast = !needsScreencast || Boolean(assets.screencast_url);
  const hasRequiredVoice = !needsVoice || Boolean(
    assets.voice_audio?.public_url || 
    assets.avatar_video?.public_url || 
    assets.video_url
  );
  const hasRequiredAvatar = !needsAvatar || Boolean(assets.avatar_video?.public_url);
  
  // Clips are ready if we have video clips uploaded or generated prompts for them
  const hasRequiredClips = !needsVoice || Boolean(assets.b_roll_clips?.length || assets.b_roll_prompts);

  if (
    hasRequiredSlides &&
    hasRequiredScreencast &&
    hasRequiredVoice &&
    hasRequiredAvatar &&
    hasRequiredClips
  ) {
    return "COMPLETED";
  }

  if (
    Boolean(assets.slides?.images?.length || assets.slides_url) ||
    Boolean(assets.screencast_url) ||
    Boolean(assets.voice_audio?.public_url || assets.video_url) ||
    Boolean(assets.avatar_video?.public_url) ||
    Boolean(assets.b_roll_clips?.length || assets.b_roll_prompts)
  ) {
    return "IN_PROGRESS";
  }

  return "PENDING";
}

function buildGammaDeckId(params: {
  componentType: string;
  currentAssets: Partial<MaterialAssets>;
  lesson?: ProductionLessonRelation;
}) {
  const { componentType, currentAssets, lesson } = params;
  if (currentAssets.gamma_deck_id || !lesson) {
    return currentAssets.gamma_deck_id;
  }

  const materials = firstRelation(lesson.materials);
  const artifact = firstRelation(materials?.artifacts);
  const courseId = artifact?.course_id || "CRS";
  const lessonNumMatch = lesson.lesson_title.match(/^(\d+(\.\d+)*)/);
  const lessonNum = lessonNumMatch
    ? lessonNumMatch[0]
    : `L${lesson.lesson_id.substring(0, 4)}`;

  const typeMap: Record<string, string> = {
    VIDEO_THEORETICAL: "VTH",
    VIDEO_GUIDE: "VGD",
    VIDEO_DEMO: "VDM",
    DEMO_GUIDE: "DG",
    QUIZ: "QZ",
  };
  const typeCode = typeMap[componentType] || "UNK";
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();

  return `${courseId}-${lessonNum}-${typeCode}-${suffix}`;
}

function isProductionComplete(_componentType: string, assets?: MaterialAssets | null) {
  return assets?.production_status === "COMPLETED";
}


async function getAuthorizedSupabase() {
  const supabase = await createClient();
  const authenticatedUser = await getAuthenticatedUser(supabase);

  if (!authenticatedUser) {
    return { error: "Unauthorized" as const, supabase, user: null };
  }

  // Use service role for admin DB operations — consistent with admin pattern
  // in artifact-action-auth.ts and required when Auth Bridge users have no GoTrue session
  return { error: null, supabase: getServiceRoleClient(), user: authenticatedUser };
}

export async function generateVideoPromptsAction(
  componentId: string,
  storyboard: StoryboardItem[],
) {
  const supabase = await createClient();
  const userToken = await getAccessToken(supabase);
  if (!userToken) return { success: false, error: "Unauthorized" };

  try {
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return { success: false, error: "Unauthorized" };
    }

    const admin = getServiceRoleClient();
    const context = await resolveProductionComponentContext({
      componentId,
      supabase: admin,
    });
    const inputSnapshot = buildBrollPromptJobInputSnapshot({
      componentId,
      storyboard,
    });
    const productionJob = await createOrReuseProductionJob(admin, {
      context,
      createdBy: authenticatedUser.userId,
      idempotencyKey: buildProductionIdempotencyKey({
        componentId,
        input: inputSnapshot,
        jobType: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
        provider: PRODUCTION_PROVIDERS.GEMINI,
      }),
      inputSnapshot,
      jobType: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
      provider: PRODUCTION_PROVIDERS.GEMINI,
      providerModel: "gemini-2.0-flash",
    });

    if (
      productionJob.status === PRODUCTION_JOB_STATUSES.SUCCEEDED &&
      typeof productionJob.output_snapshot?.prompts_text === "string"
    ) {
      return {
        success: true,
        prompts: productionJob.output_snapshot.prompts_text,
      };
    }

    const data = await callBackgroundFunctionJson<{ prompts?: string }>(
      "video-prompts-generation",
      {
        componentId,
        productionJobId: productionJob.id,
        storyboard,
        userToken,
      },
      {
        fallbackError: "No se pudieron generar los prompts de video",
        localHandlerLoader: () =>
          import("../../../../netlify/functions/video-prompts-generation"),
      },
    );

    return { success: true, prompts: data.prompts || "" };
  } catch (error: unknown) {
    console.error("[ProductionActions] Error generating prompts:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

/**
 * When a video is saved in the Production step, mirror it into publication_requests.lesson_videos
 * so the Send step always has up-to-date video data without requiring manual sync.
 * Fails silently to avoid blocking the production save.
 */
async function syncVideoToPublicationRequests(
  supabase: ReturnType<typeof getServiceRoleClient>,
  artifactId: string,
  lesson: ProductionLessonRelation,
  assets: MaterialAssets,
) {
  if (!assets.final_video_url) return;

  try {
    const { provider, id: videoId } = getVideoProviderAndId(assets.final_video_url);

    const videoData: LessonVideoData = {
      lesson_id: lesson.lesson_id,
      lesson_title: lesson.lesson_title,
      module_title: lesson.module_title || "",
      video_provider: provider,
      video_id: videoId,
      duration: assets.video_duration || 0,
    };

    const { data: existingRequest } = await supabase
      .from("publication_requests")
      .select("id, lesson_videos")
      .eq("artifact_id", artifactId)
      .maybeSingle();

    const currentLessonVideos =
      (existingRequest?.lesson_videos as Record<string, LessonVideoData> | null) || {};

    const updatedLessonVideos = {
      ...currentLessonVideos,
      [lesson.lesson_id]: videoData,
    };

    if (existingRequest?.id) {
      await supabase
        .from("publication_requests")
        .update({
          lesson_videos: updatedLessonVideos,
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingRequest.id);
    } else {
      await supabase.from("publication_requests").insert({
        artifact_id: artifactId,
        lesson_videos: updatedLessonVideos,
        status: "DRAFT",
        updated_at: new Date().toISOString(),
      });
    }
  } catch (error) {
    console.error("[ProductionActions] Error syncing video to publication_requests:", error);
  }
}

export async function saveMaterialAssetsAction(
  componentId: string,
  assets: Partial<MaterialAssets>,
) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const { data: rawComponent } = await supabase
    .from("material_components")
    .select(
      `
        assets, type, material_lesson_id,
        material_lessons (
          lesson_id, lesson_title, module_title, module_id,
          materials (
            artifact_id,
            artifacts ( course_id )
          )
        )
      `,
    )
    .eq("id", componentId)
    .single();

  const component = (rawComponent || null) as ProductionComponentRecord | null;
  const currentAssets = (component?.assets || {}) as MaterialAssets;
  const mergedAssets: MaterialAssets = { ...currentAssets, ...assets };
  const componentType = component?.type || "";
  const lesson = firstRelation(component?.material_lessons);
  const materials = firstRelation(lesson?.materials);
  const artifactId = materials?.artifact_id || undefined;
  const dodChecklist = buildDodChecklist(mergedAssets);
  const productionStatus = resolveProductionStatus(componentType, mergedAssets);

  const finalAssets: MaterialAssets = {
    ...mergedAssets,
    gamma_deck_id: buildGammaDeckId({
      componentType,
      currentAssets: mergedAssets,
      lesson,
    }),
    production_status: productionStatus,
    dod_checklist: dodChecklist,
    updated_at: new Date().toISOString(),
  };

  const { error: updateError } = await supabase
    .from("material_components")
    .update({ assets: finalAssets })
    .eq("id", componentId);

  if (updateError) {
    console.error("[ProductionActions] Error saving material assets:", updateError);
    return { success: false, error: updateError.message };
  }

  if (artifactId && lesson) {
    await markDownstreamDirtyAction(
      artifactId,
      5,
      "Materiales (assets actualizados)",
    );
    await syncProductionStatusAction(artifactId);
    await logPipelineEventAction(
      artifactId,
      productionStatus === "COMPLETED"
        ? "GO-OP-06_ASSET_COMPLETED"
        : "GO-OP-06_ASSET_UPDATED",
      {
        component_id: componentId,
        component_type: componentType,
        production_status: productionStatus,
        dod_checklist: dodChecklist,
      },
      "GO-OP-06",
      componentId,
      "material_component",
    );
  }

  return { success: true, productionStatus, dodChecklist };
}

export async function saveRemotionLayoutOverridesAction(
  componentId: string,
  rawLayoutOverrides: unknown,
  context: { templateId?: string | null; templateVersionId?: string | null } = {},
) {
  const authorized = await getAuthorizedMaterialComponentAdmin(componentId);
  if (!authorized) {
    return { success: false, error: "No autorizado para editar este componente" };
  }

  const parsedResult = safeParseLayoutOverrideManifests(rawLayoutOverrides);
  if (!parsedResult.success) {
    return { success: false, error: "Ajustes de layout invalidos" };
  }
  const parsed = parsedResult.data;
  const currentAssets = (authorized.component.assets || {}) as MaterialAssets;
  const existingParsedResult = safeParseLayoutOverrideManifests(currentAssets.layout_overrides);
  const existingLayoutOverrides = existingParsedResult.success ? existingParsedResult.data : [];
  const scopedTemplateId = context.templateId || parsed[0]?.templateId || null;
  const scopedTemplateVersionId = context.templateVersionId || parsed[0]?.templateVersionId || null;
  const isSameLayoutScope = (manifest: { templateId?: string | null; templateVersionId?: string | null }) => {
    if (!scopedTemplateId) return false;
    return (
      manifest.templateId === scopedTemplateId &&
      (scopedTemplateVersionId ? manifest.templateVersionId === scopedTemplateVersionId : true)
    );
  };
  const nextLayoutOverrides = scopedTemplateId
    ? [
        ...existingLayoutOverrides.filter((manifest) => !isSameLayoutScope(manifest)),
        ...parsed,
      ]
    : parsed;
  const now = new Date().toISOString();
  const nextAssets: MaterialAssets = {
    ...currentAssets,
    updated_at: now,
  };

  if (nextLayoutOverrides.length > 0) {
    nextAssets.layout_overrides = nextLayoutOverrides;
    nextAssets.layout_overrides_updated_at = now;
    if (currentAssets.final_video_url) {
      nextAssets.final_video_layout_stale = true;
    }
  } else {
    delete (nextAssets as any).layout_overrides;
    delete (nextAssets as any).layout_overrides_updated_at;
    delete (nextAssets as any).final_video_layout_stale;
  }

  const { error } = await authorized.admin
    .from("material_components")
    .update({ assets: nextAssets })
    .eq("id", componentId);

  if (error) {
    console.error("[ProductionActions] Error saving layout overrides:", error);
    return { success: false, error: error.message };
  }

  await markDownstreamDirtyAction(
    authorized.artifactId,
    7,
    parsed.length > 0
      ? "Postproduccion (layout ajustado)"
      : "Postproduccion (layout restablecido)",
  );
  await logPipelineEventAction(
    authorized.artifactId,
    parsed.length > 0
      ? "REMOTION_LAYOUT_OVERRIDES_SAVED"
      : "REMOTION_LAYOUT_OVERRIDES_CLEARED",
    {
      component_id: componentId,
      overrides_count: nextLayoutOverrides.length,
      final_video_layout_stale: Boolean(nextAssets.final_video_layout_stale),
    },
    "GO-OP-07",
    componentId,
    "material_component",
  );

  return {
    success: true,
    layoutOverrides: nextLayoutOverrides,
    finalVideoLayoutStale: Boolean(nextAssets.final_video_layout_stale),
  };
}

export async function syncProductionStatusAction(artifactId: string) {
  const supabase = await createClient();
  const { data: rawComponents, error: componentsError } = await supabase
    .from("material_components")
    .select(
      `
        id, type, assets,
        material_lessons!inner (
          materials!inner (
            artifact_id
          )
        )
      `,
    )
    .eq("material_lessons.materials.artifact_id", artifactId);

  if (componentsError || !rawComponents) {
    console.error(
      "[ProductionActions] Error fetching components for sync:",
      componentsError,
    );
    return { success: false };
  }

  const components = rawComponents as Array<{
    assets?: MaterialAssets | null;
    type: string;
  }>;
  const produceable = components.filter(
    (component) =>
      component.type.includes("VIDEO") || component.type === "DEMO_GUIDE",
  );

  if (produceable.length === 0) return { success: true };

  const total = produceable.length;
  const completed = produceable.filter((component) =>
    isProductionComplete(component.type, component.assets),
  ).length;
  const isDone = total > 0 && total === completed;

  const { error: updateError } = await supabase
    .from("artifacts")
    .update({ production_complete: isDone })
    .eq("id", artifactId);

  if (updateError) {
    console.error(
      "[ProductionActions] Error syncing production status:",
      updateError,
    );
    return { success: false };
  }

  return {
    success: true,
    isDone,
    progress: Math.round((completed / total) * 100),
  };
}

export async function logPipelineEventAction(
  artifactId: string,
  eventType: string,
  eventData: Record<string, unknown> = {},
  stepId?: string,
  entityId?: string,
  entityType?: string,
) {
  const { error: authError, supabase, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError };

  const { error } = await supabase.from("pipeline_events").insert({
    artifact_id: artifactId,
    event_type: eventType,
    event_data: {
      ...eventData,
      triggered_by: user.email || user.userId,
      timestamp: new Date().toISOString(),
    },
    step_id: stepId || null,
    entity_id: entityId || null,
    entity_type: entityType || null,
  });

  if (error) {
    console.error("[ProductionActions] Error logging pipeline event:", error);
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function updateProductionStatusAction(
  artifactId: string,
  isComplete: boolean,
) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const { error } = await supabase
    .from("artifacts")
    .update({ production_complete: isComplete })
    .eq("id", artifactId);

  if (error) {
    console.error(
      "[ProductionActions] Error updating production status:",
      error,
    );
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function assembleRemotionVideoAction(
  componentId: string,
  templateId: string,
  variables: Record<string, unknown>,
) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const webSupabase = await createClient();
  const token = await getAccessToken(webSupabase);
  if (!token) return { success: false, error: "No se encontró un token de autenticación" };

  let rawComponent: any = null;
  try {
    const { data, error: fetchError } = await supabase
      .from("material_components")
      .select(
        `
          assets, content, type, material_lesson_id,
          material_lessons (
            lesson_id, lesson_title, module_title, module_id,
            materials (
              artifact_id
            )
          )
        `,
      )
      .eq("id", componentId)
      .single();

    if (fetchError || !data) {
      return { success: false, error: "No se encontró el componente" };
    }
    rawComponent = data;
  } catch (err: any) {
    return { success: false, error: err.message || "Error al buscar el componente" };
  }

  const component = rawComponent as ProductionComponentRecord | null;
  const currentAssets = (component?.assets || {}) as MaterialAssets;
  const targetDurationSeconds = deriveAssemblyTargetDurationSeconds(component?.content);
  const renderAssets = withAssemblyTargetDuration(currentAssets, targetDurationSeconds);
  const normalizedAssets = normalizeAssemblyAssets(renderAssets, 30);
  const hasPrimaryRenderableAssets = Boolean(
    normalizedAssets.voiceAudioUrl ||
      normalizedAssets.avatarVideoUrl ||
      normalizedAssets.slides.length > 0 ||
      normalizedAssets.brollClips.length > 0,
  );

  if (!hasPrimaryRenderableAssets) {
    return {
      success: false,
      error:
        "No hay assets renderizables para Remotion. Sube voz, avatar, slides renderizables o B-roll antes de ensamblar.",
    };
  }

  try {
    // Update component status to IN_PROGRESS
    const updatedAssets: MaterialAssets = {
      ...renderAssets,
      production_status: "IN_PROGRESS",
      updated_at: new Date().toISOString(),
    };

    const { error: updateError } = await supabase
      .from("material_components")
      .update({ assets: updatedAssets })
      .eq("id", componentId);

    if (updateError) {
      console.error("[ProductionActions] Error setting production_status to IN_PROGRESS:", updateError);
      return { success: false, error: updateError.message };
    }

    const productionApiUrl = getProductionApiBaseUrl();
    console.log("[ProductionActions] Triggering Remotion render via production API.", {
      productionApiUrl,
      componentId,
      templateId,
      normalizedAssets: {
        slidesCount: normalizedAssets.slides.length,
        brollClipsCount: normalizedAssets.brollClips.length,
        hasAvatarVideo: Boolean(normalizedAssets.avatarVideoUrl),
        hasVoiceAudio: Boolean(normalizedAssets.voiceAudioUrl),
        totalDurationSeconds: normalizedAssets.totalDurationSeconds,
        assemblyTargetDurationSeconds: targetDurationSeconds ?? null,
        avatarDurationSeconds: typeof renderAssets.avatar_video?.duration === "number"
          ? renderAssets.avatar_video.duration
          : null,
        voiceDurationSeconds: typeof renderAssets.voice_audio?.duration === "number"
          ? renderAssets.voice_audio.duration
          : null,
      },
      variablesKeys: Object.keys(variables || {}),
    });
    
    const renderVariables = {
      ...variables,
      assemblyTargetDurationSeconds: targetDurationSeconds ?? null,
    };

    const response = await fetch(`${productionApiUrl}/api/v1/production/remotion/render`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        componentId,
        templateId,
        variables: renderVariables
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `HTTP Error ${response.status}`;
      let errorCode: string | undefined;
      try {
        const errorJson = JSON.parse(errorText);
        errorMessage = errorJson.error || errorMessage;
        errorCode = typeof errorJson.code === "string" ? errorJson.code : undefined;
      } catch (_) {}

      // Revert status to PENDING in case of request error
      await supabase
        .from("material_components")
        .update({
          assets: {
            ...currentAssets,
            production_status: "PENDING",
            updated_at: new Date().toISOString()
          }
        })
        .eq("id", componentId);

      return { success: false, error: errorMessage, code: errorCode };
    }

    const result = await response.json();
    if (result.status === "FAILED") {
      await supabase
        .from("material_components")
        .update({
          assets: {
            ...currentAssets,
            production_status: "PENDING",
            updated_at: new Date().toISOString()
          }
        })
        .eq("id", componentId);

      return {
        success: false,
        error: result.message || "El render fue rechazado por el proveedor",
        code: result.code,
      };
    }

    return {
      success: true,
      jobId: result.jobId,
      status: result.status,
      productionStatus: "IN_PROGRESS" as ProductionStatus
    };

  } catch (error: unknown) {
    console.error("[ProductionActions] Error initiating Remotion assembly:", error);
    
    // Revert status to PENDING
    try {
      await supabase
        .from("material_components")
        .update({
          assets: {
            ...currentAssets,
            production_status: "PENDING",
            updated_at: new Date().toISOString()
          }
        })
        .eq("id", componentId);
    } catch (_) {}

    return { success: false, error: getErrorMessage(error) };
  }
}

export async function createRemotionAssemblyBatchAction(input: RenderBatchRequest) {
  const parsed = renderBatchRequestSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "Solicitud de batch invalida" };
  }

  const auth = await getAuthorizedSupabase();
  if (auth.error || !auth.user) return { success: false, error: auth.error || "Unauthorized" };

  const authorized = await getAuthorizedArtifactAdmin(parsed.data.artifactId);
  if (!authorized?.artifact?.organization_id) {
    return { success: false, error: "No autorizado para ensamblar este artefacto" };
  }

  try {
    const organizationIds = await getAuthenticatedOrganizationIds(
      auth.user.userId,
      authorized.artifact.organization_id,
    )(authorized.admin);
    const service = new RenderBatchService(authorized.admin);
    const batch = await service.createBatch(parsed.data, {
      userId: auth.user.userId,
      organizationIds,
    });

    return { success: true, ...batch };
  } catch (error: unknown) {
    console.error("[ProductionActions] Error creating Remotion assembly batch:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getRemotionAssemblyBatchStatusAction(batchId: string): Promise<
  | { success: true; batch: RenderBatchStatusView }
  | { success: false; error: string }
> {
  const { error: authError, supabase, user } = await getAuthorizedSupabase();
  if (authError || !user) return { success: false, error: authError || "Unauthorized" };

  try {
    const organizationIds = await getAuthenticatedOrganizationIds(user.userId)(supabase);
    const service = new RenderBatchService(supabase);
    const batch = await service.getBatchStatus(batchId, organizationIds);
    return { success: true, batch };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function getRemotionJobStatusAction(jobId: string) {
  const { error: authError } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  const webSupabase = await createClient();
  const token = await getAccessToken(webSupabase);
  if (!token) return { success: false, error: "No se encontró un token de autenticación" };

  try {
    const productionApiUrl = getProductionApiBaseUrl();
    const response = await fetch(`${productionApiUrl}/api/v1/production/jobs/${jobId}/status`, {
      headers: {
        "Authorization": `Bearer ${token}`,
      }
    });

    if (!response.ok) {
      return { success: false, error: `HTTP Error ${response.status}` };
    }

    const job = await response.json();
    return {
      success: true,
      job
    };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function cancelRemotionAssemblyJobsAction(artifactId: string, jobIds: string[]) {
  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  if (!authorized?.artifact?.organization_id) {
    return { success: false, error: "No se encontro la organizacion del artefacto" };
  }

  const validJobIds = jobIds.filter((jobId) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId),
  );

  if (validJobIds.length === 0) {
    return { success: true, cancelledCount: 0 };
  }

  try {
    const now = new Date().toISOString();
    const { data: jobs, error: fetchError } = await authorized.admin
      .from("production_jobs")
      .select("id, material_component_id")
      .eq("artifact_id", artifactId)
      .eq("organization_id", authorized.artifact.organization_id)
      .in("id", validJobIds)
      .not("status", "in", "(SUCCEEDED,FAILED,CANCELLED)");

    if (fetchError) {
      return { success: false, error: fetchError.message };
    }

    const cancellableJobs = jobs || [];
    if (cancellableJobs.length === 0) {
      return { success: true, cancelledCount: 0 };
    }

    const cancellableIds = cancellableJobs.map((job) => job.id);
    const { error: updateError } = await authorized.admin
      .from("production_jobs")
      .update({
        status: "CANCELLED",
        failed_at: now,
        worker_heartbeat_at: now,
        provider_error: {
          code: "USER_CANCELLED",
          message: "El ensamblado fue detenido desde SofLIA - Engine.",
          stage: "user_cancelled",
        },
      })
      .in("id", cancellableIds);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    const componentIds = cancellableJobs
      .map((job) => job.material_component_id)
      .filter((componentId): componentId is string => typeof componentId === "string");

    if (componentIds.length > 0) {
      const { data: components } = await authorized.admin
        .from("material_components")
        .select("id, assets")
        .in("id", componentIds);

      for (const component of components || []) {
        await authorized.admin
          .from("material_components")
          .update({
            assets: {
              ...(component.assets || {}),
              production_status: "PENDING",
              updated_at: now,
            },
          })
          .eq("id", component.id);
      }
    }

    return { success: true, cancelledCount: cancellableIds.length };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export interface RenderWorkerStatusView {
  id: string;
  device_name?: string | null;
  platform?: string | null;
  arch?: string | null;
  app_version?: string | null;
  status: "LINKED" | "ONLINE" | "BUSY" | "OFFLINE" | "REVOKED" | string;
  last_heartbeat_at?: string | null;
  token_last4?: string | null;
  max_concurrent_jobs?: number | null;
  running_jobs?: number | null;
  available_slots?: number | null;
  capabilities?: Record<string, unknown> | null;
  last_capacity_report?: Record<string, unknown> | null;
  capacity_updated_at?: string | null;
  created_at?: string | null;
}

function getAuthenticatedOrganizationIds(userId: string, fallbackOrganizationId?: string | null) {
  return async (supabase: ReturnType<typeof getServiceRoleClient>) => {
    const organizationIds = new Set<string>();
    if (fallbackOrganizationId) organizationIds.add(fallbackOrganizationId);

    const { data: profile } = await supabase
      .from("profiles")
      .select("organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (typeof profile?.organization_id === "string") organizationIds.add(profile.organization_id);

    const { data: roleRows } = await supabase
      .from("organization_user_roles")
      .select("organization_id")
      .eq("user_id", userId);
    for (const row of roleRows || []) {
      if (typeof row.organization_id === "string") organizationIds.add(row.organization_id);
    }

    return Array.from(organizationIds);
  };
}

async function getArtifactOrganizationId(artifactId: string) {
  const authorized = await getAuthorizedArtifactAdmin(artifactId);
  return authorized?.artifact?.organization_id || null;
}

async function getProductionApiToken() {
  const webSupabase = await createClient();
  return getAccessToken(webSupabase);
}

export async function getRenderWorkerStatusAction(artifactId: string) {
  const organizationId = await getArtifactOrganizationId(artifactId);
  if (!organizationId) {
    return { success: false, error: "No se encontro la organizacion del artefacto" };
  }

  const token = await getProductionApiToken();
  if (!token) {
    return { success: false, error: "No se encontro un token de autenticacion" };
  }

  try {
    const productionApiUrl = getProductionApiBaseUrl();
    const [readinessResponse, workersResponse] = await Promise.all([
      fetch(`${productionApiUrl}/api/v1/production/remotion/readiness`, {
        headers: { "Authorization": `Bearer ${token}` },
      }),
      fetch(
        `${productionApiUrl}/api/v1/production/remotion/workers?organizationId=${encodeURIComponent(organizationId)}`,
        {
          headers: { "Authorization": `Bearer ${token}` },
        },
      ),
    ]);

    const readiness = await readinessResponse.json().catch(() => ({}));
    if (!workersResponse.ok) {
      return { success: false, error: `HTTP Error ${workersResponse.status}` };
    }

    const workerPayload = await workersResponse.json();
    const renderProvider =
      typeof readiness?.config?.provider === "string"
        ? readiness.config.provider
        : typeof readiness?.provider === "string"
          ? readiness.provider
          : null;

    return {
      success: true,
      apiUrl: productionApiUrl,
      renderProvider,
      requiresDesktopWorker: renderProvider === "desktop_worker",
      workers: (workerPayload.workers || []) as RenderWorkerStatusView[],
    };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function createRenderWorkerLinkCodeAction(artifactId: string) {
  const organizationId = await getArtifactOrganizationId(artifactId);
  if (!organizationId) {
    return { success: false, error: "No se encontro la organizacion del artefacto" };
  }

  const token = await getProductionApiToken();
  if (!token) {
    return { success: false, error: "No se encontro un token de autenticacion" };
  }

  try {
    const productionApiUrl = getProductionApiBaseUrl();
    const response = await fetch(`${productionApiUrl}/api/v1/production/remotion/workers/link-codes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ organizationId }),
    });

    if (!response.ok) {
      return { success: false, error: `HTTP Error ${response.status}` };
    }

    const result = await response.json();
    return {
      success: true,
      apiUrl: productionApiUrl,
      code: result.code as string,
      expiresAt: result.linkCode?.expires_at as string | undefined,
    };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function revokeRenderWorkerAction(artifactId: string, workerId: string) {
  const organizationId = await getArtifactOrganizationId(artifactId);
  if (!organizationId) {
    return { success: false, error: "No se encontro la organizacion del artefacto" };
  }

  try {
    const service = new DesktopWorkerControlPlane(getServiceRoleClient());
    await service.revokeWorker(workerId, organizationId);
    return { success: true };
  } catch (error: unknown) {
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function deleteFinalVideoForPublicationAction(componentId: string) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  try {
    const { data: rawComponent, error: fetchError } = await supabase
      .from("material_components")
      .select(
        `
          assets, type, material_lesson_id,
          material_lessons (
            lesson_id, lesson_title, module_title, module_id,
            materials (
              artifact_id
            )
          )
        `,
      )
      .eq("id", componentId)
      .single();

    if (fetchError || !rawComponent) {
      return { success: false, error: "No se encontro el componente" };
    }

    const component = (rawComponent || null) as ProductionComponentRecord | null;
    const lesson = firstRelation(component?.material_lessons);
    const materials = firstRelation(lesson?.materials);
    const artifactId = materials?.artifact_id || undefined;
    const cleanedAssets = { ...((component?.assets || {}) as MaterialAssets) };

    delete (cleanedAssets as any).final_video_url;
    delete (cleanedAssets as any).final_video_source;
    delete (cleanedAssets as any).final_video_storage_provider;
    delete (cleanedAssets as any).final_video_storage_path;
    delete (cleanedAssets as any).final_video_source_storage_path;
    delete (cleanedAssets as any).final_video_url_expires_at;
    delete (cleanedAssets as any).final_video_layout_stale;

    const productionStatus = resolveProductionStatus(component?.type || "", cleanedAssets);
    cleanedAssets.production_status = productionStatus;
    cleanedAssets.dod_checklist = buildDodChecklist(cleanedAssets);
    cleanedAssets.updated_at = new Date().toISOString();

    const { error: updateError } = await supabase
      .from("material_components")
      .update({ assets: cleanedAssets })
      .eq("id", componentId);

    if (updateError) {
      return { success: false, error: updateError.message };
    }

    if (artifactId && lesson?.lesson_id) {
      const { data: existingRequest } = await supabase
        .from("publication_requests")
        .select("id, lesson_videos")
        .eq("artifact_id", artifactId)
        .maybeSingle();

      if (existingRequest?.id) {
        const currentLessonVideos =
          (existingRequest.lesson_videos as Record<string, LessonVideoData> | null) || {};
        const nextLessonVideos = { ...currentLessonVideos };
        delete nextLessonVideos[lesson.lesson_id];

        await supabase
          .from("publication_requests")
          .update({
            lesson_videos: nextLessonVideos,
            updated_at: new Date().toISOString(),
          })
          .eq("id", existingRequest.id);
      }

      await markDownstreamDirtyAction(
        artifactId,
        7,
        "Postproduccion (video final eliminado)",
      );
      await syncProductionStatusAction(artifactId);
      await logPipelineEventAction(
        artifactId,
        "REMOTION_ASSEMBLY_VIDEO_DELETED",
        {
          component_id: componentId,
          lesson_id: lesson.lesson_id,
        },
        "GO-OP-07",
        componentId,
        "material_component",
      );
    }

    return { success: true, productionStatus };
  } catch (error: unknown) {
    console.error("[ProductionActions] Error deleting final video:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}

export async function completeRemotionAssemblyAction(
  componentId: string,
  finalVideoUrl: string,
) {
  const { error: authError, supabase } = await getAuthorizedSupabase();
  if (authError) return { success: false, error: authError };

  try {
    const { data: rawComponent, error: fetchError } = await supabase
      .from("material_components")
      .select(
        `
          assets, type, material_lesson_id,
          material_lessons (
            lesson_id, lesson_title, module_title, module_id,
            materials (
              artifact_id
            )
          )
        `,
      )
      .eq("id", componentId)
      .single();

    if (fetchError || !rawComponent) {
      return { success: false, error: "No se encontró el componente" };
    }

    const component = (rawComponent || null) as ProductionComponentRecord | null;
    const lesson = firstRelation(component?.material_lessons);
    const materials = firstRelation(lesson?.materials);
    const artifactId = materials?.artifact_id || undefined;

    if (artifactId && lesson) {
      const assets = (component?.assets || {}) as MaterialAssets;
      await syncVideoToPublicationRequests(supabase, artifactId, lesson, assets);
      await markDownstreamDirtyAction(
        artifactId,
        6, // Phase 6 - Production updated
        "Postproducción (Ensamblado Remotion local)",
      );
      await syncProductionStatusAction(artifactId);
      await logPipelineEventAction(
        artifactId,
        "REMOTION_ASSEMBLY_COMPLETED",
        {
          component_id: componentId,
          final_video_url: finalVideoUrl,
        },
        "GO-OP-07", // Phase 7: Postproduction
        componentId,
        "material_component",
      );
    }

    return { success: true };
  } catch (error: unknown) {
    console.error("[ProductionActions] Error completing Remotion assembly:", error);
    return { success: false, error: getErrorMessage(error) };
  }
}
