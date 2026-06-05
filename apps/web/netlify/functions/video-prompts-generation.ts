import { Handler } from "@netlify/functions";
import {
  createGeminiClient,
  createServiceRoleClient,
} from "./shared/bootstrap";
import { getErrorMessage } from "./shared/errors";
import {
  jsonResponse,
  methodNotAllowedResponse,
  parseJsonBody,
} from "./shared/http";
import { syncBrollPromptsToMaterialComponent } from "../../src/domains/production/assets/production-asset-sync.service";
import {
  buildBrollPromptJobInputSnapshot,
  buildProductionIdempotencyKey,
  completeBrollPromptProductionJob,
  createOrReuseProductionJob,
  failProductionJob,
  markProductionJobRunning,
  resolveProductionComponentContext,
} from "../../src/domains/production/jobs/production-jobs.service";
import {
  PRODUCTION_JOB_TYPES,
  PRODUCTION_PROVIDERS,
} from "../../src/domains/production/types/production.types";
import {
  formatBrollPromptsForAssets,
  parseBrollPromptResponse,
} from "../../src/domains/production/validation/broll-prompts.schema";
import { CLIP_GENERATION_PROMPT_CODE } from "../../src/shared/config/prompts/materials-generation.prompts.modular";
import { resolveSinglePrompt } from "../../src/shared/config/prompts/prompt-resolver.service";

const BROLL_PROMPT_MODEL = "gemini-2.0-flash";

interface VideoPromptsRequestBody {
  componentId?: string;
  productionJobId?: string;
  storyboard?: unknown;
  userToken?: string;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return methodNotAllowedResponse();
  }

  let requestBody: VideoPromptsRequestBody = {};
  let activeProductionJobId: string | null = null;
  let productionJobCompleted = false;

  try {
    requestBody = parseJsonBody<VideoPromptsRequestBody>(event);
    activeProductionJobId = requestBody.productionJobId || null;
    const { componentId, productionJobId, storyboard } = requestBody;

    if (!componentId || !storyboard) {
      return { statusCode: 400, body: "Missing required fields" };
    }

    const supabase = createServiceRoleClient();
    const genAI = createGeminiClient();
    console.log(`[Video Prompts] Generating for component: ${componentId}`);

    const context = await resolveProductionComponentContext({
      componentId,
      supabase,
    });
    const inputSnapshot = buildBrollPromptJobInputSnapshot({
      componentId,
      storyboard,
    });
    const productionJob = productionJobId
      ? { id: productionJobId }
      : await createOrReuseProductionJob(supabase, {
          context,
          idempotencyKey: buildProductionIdempotencyKey({
            componentId,
            input: inputSnapshot,
            jobType: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
            provider: PRODUCTION_PROVIDERS.GEMINI,
          }),
          inputSnapshot,
          jobType: PRODUCTION_JOB_TYPES.BROLL_PROMPT_GENERATION,
          provider: PRODUCTION_PROVIDERS.GEMINI,
          providerModel: BROLL_PROMPT_MODEL,
        });
    activeProductionJobId = productionJob.id;

    await markProductionJobRunning({
      jobId: productionJob.id,
      supabase,
    });

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

    const inputContext = JSON.stringify(storyboard, null, 2);
    const fullPrompt = `${systemPrompt}\n\nSTORYBOARD INPUT:\n${inputContext}`;

    const response = await genAI.models.generateContent({
      model: BROLL_PROMPT_MODEL,
      contents: fullPrompt,
      config: {
        temperature: 0.7,
        responseModalities: ["TEXT"],
      },
    });

    const responseText = response.text || "";
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      throw new Error("No valid JSON in response");
    }

    const result = parseBrollPromptResponse(JSON.parse(jsonMatch[0]));
    const promptsText = formatBrollPromptsForAssets(result.prompts);

    await completeBrollPromptProductionJob(supabase, {
      context,
      jobId: productionJob.id,
      model: BROLL_PROMPT_MODEL,
      promptItems: result.prompts,
      promptsText,
    });
    productionJobCompleted = true;

    await syncBrollPromptsToMaterialComponent({
      componentId,
      promptsText,
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
