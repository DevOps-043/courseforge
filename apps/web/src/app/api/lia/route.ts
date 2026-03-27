import { NextRequest, NextResponse } from "next/server";
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
  getActiveOrgIdFromCookieHeader,
} from "@/lib/lia-route-helpers";

interface LiaRequestPayload {
  actionResult?: string;
  computerUseMode?: boolean;
  domMap?: string;
  messages: Array<{ content: string; role: string }>;
  screenshot?: string;
  url?: string;
}

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();
    const payload = (await req.json()) as LiaRequestPayload;
    const useComputerUse = Boolean(payload.computerUseMode && payload.screenshot);
    const activeOrgId = getActiveOrgIdFromCookieHeader(
      req.headers.get("cookie") || "",
    );
    const settings = await getLiaSettings(supabase, useComputerUse, activeOrgId);
    const modelName = settings.model_name;
    const config = buildLiaConfig(settings, useComputerUse);
    const apiKey =
      process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY;

    console.log("Lia API - API Key check:", {
      GOOGLE_GENERATIVE_AI_API_KEY: process.env.GOOGLE_GENERATIVE_AI_API_KEY
        ? `Found (${process.env.GOOGLE_GENERATIVE_AI_API_KEY.slice(0, 8)}...)`
        : "NOT FOUND",
      GOOGLE_API_KEY: process.env.GOOGLE_API_KEY
        ? `Found (${process.env.GOOGLE_API_KEY.slice(0, 8)}...)`
        : "NOT FOUND",
      usingKey: apiKey ? `Yes (${apiKey.slice(0, 8)}...)` : "NO KEY",
    });

    if (!apiKey) {
      console.error("Lia API - CRITICAL: No API key found");
      return NextResponse.json(
        { error: "API key not configured" },
        { status: 500 },
      );
    }

    console.log("Lia API - Mode:", useComputerUse ? "COMPUTER" : "STANDARD");
    console.log("Lia API - Model:", modelName);
    console.log("Lia API - Config:", JSON.stringify(config));

    let dbContextSummary = "";
    if (useComputerUse) {
      try {
        const dbContext = await getLiaDBContext(supabase);
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
            console.log("=== SENDING OVERRIDE TO FRONTEND ===");
            console.log(
              "Response data:",
              JSON.stringify(overrideResponse, null, 2),
            );
            return NextResponse.json(overrideResponse);
          }
        }

        const responseData = buildComputerUseResponse(parsed);
        console.log("=== SENDING TO FRONTEND ===");
        console.log("Response data:", JSON.stringify(responseData, null, 2));
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
  } catch (error: any) {
    console.error("Error in Lia API:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error.message },
      { status: 500 },
    );
  }
}
