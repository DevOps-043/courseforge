import { APP_CONFIG } from "../../src/config/app";
import { Handler } from "@netlify/functions";
import {
  createOpenAiClient,
  createServiceRoleClient,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import {
  jsonResponse,
  methodNotAllowedResponse,
  parseVerifiedBackgroundBody,
  backgroundGuardFailureResponse,
} from "./shared/http";
import { syncBrollPromptsToMaterialComponent } from "../../src/domains/production/assets/production-asset-sync.service";
import {
  buildBrollPromptJobInputSnapshot,
  buildProductionIdempotencyKey,
  completeBrollPromptProductionJob,
  createOrReuseProductionJob,
  failProductionJob,
  claimPendingProductionJob,
  resolveProductionComponentContext,
} from "../../src/domains/production/jobs/production-jobs.service";
import {
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "../../src/domains/production/types/production.types";
import {
  formatBrollPromptsForAssets,
  parseCompletedBrollResponse,
  brollPromptOutputFormat,
} from "../../src/domains/production/validation/broll-prompts.schema";
import { buildCourseDeckSpecFromComponent } from "../../src/domains/production/slides/planning/course-deck-from-component.service";
import { CLIP_GENERATION_PROMPT_CODE } from "../../src/shared/config/prompts/materials-generation.prompts.modular";
import { resolveSinglePrompt } from "../../src/shared/config/prompts/prompt-resolver.service";

import { COURSE_TEXT_MODELS, withTextModelFallback } from "../../src/shared/ai/text-model-provider";

const BROLL_PROMPT_MODEL = COURSE_TEXT_MODELS.model;

interface VideoPromptsRequestBody {
  componentId?: string;
  productionJobId?: string;
  storyboard?: unknown;
  userToken?: string;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function normalizeStoryboardForSlides(storyboard: unknown) {
  const record = asRecord(storyboard);
  const storyboardItems = Array.isArray(storyboard)
    ? storyboard
    : Array.isArray(record.storyboard)
      ? record.storyboard
      : Array.isArray(record.takes)
        ? record.takes
        : [];

  return {
    ...record,
    storyboard: storyboardItems,
  };
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let requestBody: VideoPromptsRequestBody = {};
  let activeProductionJobId: string | null = null;
  let productionJobCompleted = false;

  try {
    requestBody = await parseVerifiedBackgroundBody<VideoPromptsRequestBody>(event);
  } catch (error) {
    return backgroundGuardFailureResponse(error);
  }

  try {
    const { componentId, productionJobId, storyboard } = requestBody;

    if (!componentId || !storyboard) {
      return { statusCode: 400, body: "Missing required fields" };
    }

    const supabase = createServiceRoleClient();
    const openai = createOpenAiClient();
    console.log(`[Video Prompts] Generating for component: ${componentId}`);

    const context = await resolveProductionComponentContext({
      componentId,
      supabase,
    });
    const inputSnapshot = buildBrollPromptJobInputSnapshot({
      componentId,
      storyboard,
      videoDurationContract: context.videoDurationContract,
    });
    const productionJob = productionJobId
      ? { id: productionJobId }
      : await createOrReuseProductionJob(supabase, {
          context,
          idempotencyKey: buildProductionIdempotencyKey({
            componentId,
            input: inputSnapshot,
            jobType: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
            provider: PRODUCTION_PROVIDERS.OPENAI,
          }),
          inputSnapshot,
          jobType: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
          provider: PRODUCTION_PROVIDERS.OPENAI,
          providerModel: BROLL_PROMPT_MODEL,
        });
    const claimed = await claimPendingProductionJob({
      jobId: productionJob.id,
      supabase,
    });
    if (!claimed) return jsonResponse({ success: false, error: "BROLL_JOB_ACTIVE: El trabajo ya está en curso o terminado. Actualiza el estado antes de reintentar." }, 409);
    activeProductionJobId = productionJob.id;

    console.log(
      `[Video Prompts] Organization: ${
        context.organizationId ?? "global (no org)"
      }`,
    );

    const systemPrompt = await resolveSinglePrompt(
      supabase,
      CLIP_GENERATION_PROMPT_CODE,
      context.organizationId,
    );

    const inputContext = JSON.stringify({
      duration_contract: context.videoDurationContract,
      storyboard,
    }, null, 2);
    const fullPrompt = `${systemPrompt}\n\nSTORYBOARD INPUT:\n${inputContext}`;

    const { result, model } = await withTextModelFallback(BROLL_PROMPT_MODEL, COURSE_TEXT_MODELS.fallbackModel, async model => {
      const response = await openai.responses.create({
        model, input: fullPrompt, store: false, text: { format: brollPromptOutputFormat },
      }, { timeout: 60_000, maxRetries: 0 });
      return { model, result: parseCompletedBrollResponse(response) };
    });
    if (
      context.videoDurationContract &&
      result.prompts.length < context.videoDurationContract.minimumBrollTakes
    ) {
      throw new Error(
        `La generación produjo ${result.prompts.length} prompts B-roll; el contrato requiere al menos ${context.videoDurationContract.minimumBrollTakes}.`,
      );
    }
    const promptsText = formatBrollPromptsForAssets(result.prompts);
    const slideDeckSpec = buildCourseDeckSpecFromComponent({
      artifactId: context.artifactId,
      component: {
        content: normalizeStoryboardForSlides(storyboard),
        id: componentId,
        type: context.componentType,
        durationContract: context.videoDurationContract || undefined,
      },
      input: {
        locale: "es",
        metadata: {
          brandLabel: APP_CONFIG.name,
        },
        template: "course-module",
      },
    }) as unknown as Record<string, unknown>;

    await completeBrollPromptProductionJob(supabase, {
      context,
      jobId: productionJob.id,
      model,
      promptItems: result.prompts,
      promptsText,
      slideDeckSpec,
    });
    productionJobCompleted = true;

    await syncBrollPromptsToMaterialComponent({
      componentId,
      promptsText,
      slideDeckSpec,
      supabase,
    });

    console.log(`[Video Prompts] Assets updated for ${componentId}`);

    return jsonResponse({ success: true, prompts: promptsText });
  } catch (error: unknown) {
    console.error("[Video Prompts] Error:", error);

    if (activeProductionJobId && !productionJobCompleted) {
      const supabase = createServiceRoleClient();
      await failProductionJob({
        error,
        jobId: activeProductionJobId,
        supabase,
      }).catch((jobError) => {
        console.error("[Video Prompts] Error marking job failed:", jobError);
      });
    }

    return jsonResponse({ success: false, error: getErrorMessage(error) }, 500);
  }
};
