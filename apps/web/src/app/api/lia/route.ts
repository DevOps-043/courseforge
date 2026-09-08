import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/utils/supabase/server";
import { getLiaDBContext, generateDBContextSummary } from "@/lib/lia-db-context";
import {
  callGeminiREST,
  detectHallucination,
  getLiaSettings,
  parseActionFromResponse,
} from "@/lib/lia-api";
import {
  buildComputerUseResponse,
  buildConversationPrompt,
  buildHallucinationOverrideResponse,
  buildLiaConfig,
  buildSystemInstruction,
  cleanStandardResponse,
  extractGroundingSources,
} from "@/lib/lia-route-helpers";
import type { LiaRequestPayload } from "@/lib/lia-types";
import {
  getGeminiApiKey,
  getOptionalServerEnvValue,
} from "@/lib/server/env";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  getAuthenticatedUser,
  getServiceRoleClient,
} from "@/lib/server/artifact-action-auth";

const LIA_RATE_LIMIT = 30;
const LIA_RATE_WINDOW_SECONDS = 60;
const liaRequestSchema = z.object({
  actionResult: z.string().max(20_000).optional(),
  computerUseMode: z.boolean().optional(),
  domMap: z.string().max(100_000).optional(),
  messages: z.array(z.object({
    role: z.string().min(1).max(30),
    content: z.string().max(20_000),
  })).min(1).max(50),
  screenshot: z.string().max(7_000_000).optional(),
  url: z.string().url().max(2_000).optional(),
}).strict();

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    if (!authenticatedUser) {
      return NextResponse.json({ error: "No autorizado." }, { status: 401 });
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant?.organizationId) {
      return NextResponse.json(
        { error: "Empresa no válida o no autorizada." },
        { status: 403 },
      );
    }

    const admin = getServiceRoleClient();
    const { data: rateLimitRows, error: rateLimitError } = await admin.rpc(
      "consume_api_rate_limit",
      {
        p_limit: LIA_RATE_LIMIT,
        p_rate_key: `lia:${tenant.organizationId}:${authenticatedUser.userId}`,
        p_window_seconds: LIA_RATE_WINDOW_SECONDS,
      },
    );
    if (rateLimitError) {
      console.error("[Lia API] Rate limit unavailable", { code: rateLimitError.code });
      return NextResponse.json(
        { error: "Servicio temporalmente no disponible." },
        { status: 503 },
      );
    }
    const rateLimit = Array.isArray(rateLimitRows) ? rateLimitRows[0] : null;
    if (!rateLimit?.allowed) {
      const retryAfter = Math.max(
        1,
        Math.ceil((new Date(rateLimit?.reset_at || Date.now()).getTime() - Date.now()) / 1000),
      );
      return NextResponse.json(
        { error: "Demasiadas solicitudes. Intenta nuevamente en un momento." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }

    const parsedPayload = liaRequestSchema.safeParse(await req.json());
    if (!parsedPayload.success) {
      return NextResponse.json({ error: "Solicitud inválida." }, { status: 400 });
    }
    const payload: LiaRequestPayload = parsedPayload.data;
    const useComputerUse = Boolean(payload.computerUseMode && payload.screenshot);
    const organizationId = tenant.organizationId;
    const settings = await getLiaSettings(supabase, useComputerUse, organizationId);
    const modelName = settings.model_name;
    const config = buildLiaConfig(settings, useComputerUse);
    const primaryGeminiApiKey = getOptionalServerEnvValue(
      "GOOGLE_GENERATIVE_AI_API_KEY",
    );
    const fallbackGeminiApiKey = getOptionalServerEnvValue("GOOGLE_API_KEY");
    const apiKey = getGeminiApiKey();

    console.log("Lia API - API Key check:", {
      GOOGLE_GENERATIVE_AI_API_KEY: Boolean(primaryGeminiApiKey),
      GOOGLE_API_KEY: Boolean(fallbackGeminiApiKey),
      usingKey: Boolean(apiKey),
    });

    console.log("Lia API - Mode:", useComputerUse ? "COMPUTER" : "STANDARD");
    console.log("Lia API - Model:", modelName);

    let dbContextSummary = "";
    if (useComputerUse) {
      try {
        const dbContext = await getLiaDBContext(supabase, organizationId);
        dbContextSummary = generateDBContextSummary(dbContext);
        console.log("Lia API - DB Context loaded:", dbContext.stats);
      } catch (error) {
        console.warn("Failed to load DB context:", error);
      }
    }

    const systemInstruction = buildSystemInstruction(
      useComputerUse,
      payload.domMap,
      dbContextSummary,
    );
    const fullPrompt = buildConversationPrompt(payload, systemInstruction);
    const result = await callGeminiREST(apiKey, modelName, fullPrompt, config);
    const responseText = result.text;
    const groundingMetadata = result.groundingMetadata;

    console.log("Lia API - Response received, length:", responseText.length);

    if (useComputerUse) {
      const parsed = parseActionFromResponse(responseText);
      if (parsed) {
        const hallucinationCheck = detectHallucination(
          parsed.cleanText,
          payload.domMap,
        );

        if (
          hallucinationCheck.isHallucinating &&
          payload.domMap &&
          hallucinationCheck.searchTerm
        ) {
          console.log("[HALLUCINATION OVERRIDE] Detected hallucination");
          console.log(
            `[HALLUCINATION OVERRIDE] Search term: "${hallucinationCheck.searchTerm}"`,
          );

          const overrideResponse = buildHallucinationOverrideResponse(
            payload.domMap,
            hallucinationCheck.searchTerm,
          );

          if (overrideResponse) {
            return NextResponse.json(overrideResponse);
          }
        }

        const responseData = buildComputerUseResponse(parsed);
        return NextResponse.json(responseData);
      }
    }

    const sources = extractGroundingSources(groundingMetadata);
    const cleanContent = cleanStandardResponse(responseText);

    return NextResponse.json({
      message: {
        role: "model",
        content: cleanContent,
        timestamp: new Date().toISOString(),
        sources: sources.length > 0 ? sources : undefined,
      },
    });
  } catch (error: unknown) {
    console.error("Error in Lia API:", error);
    return NextResponse.json(
      {
        error: "Internal Server Error",
      },
      { status: 500 },
    );
  }
}
