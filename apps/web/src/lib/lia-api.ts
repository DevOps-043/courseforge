import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GeminiRestResponse,
  LiaAction,
  LiaConfig,
  LiaGroundingMetadata,
  LiaSettingsRecord,
  ParsedLiaResponse,
} from "@/lib/lia-types";

const DEFAULT_COMPUTER_SETTINGS: LiaSettingsRecord = {
  model_name: "gemini-2.0-flash-exp",
  temperature: 0.3,
  setting_type: "COMPUTER",
};

const DEFAULT_STANDARD_SETTINGS: LiaSettingsRecord = {
  model_name: "gemini-2.0-flash",
  temperature: 0.7,
  setting_type: "LIA_MODEL",
};

interface GeminiRestCandidate {
  content?: {
    parts?: Array<{ text?: string }>;
  };
  groundingMetadata?: LiaGroundingMetadata;
}

interface GeminiRestApiResponse {
  candidates?: GeminiRestCandidate[];
}

interface LiaActionEnvelope {
  action?: LiaAction | null;
  actions?: LiaAction[];
  message?: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isLiaAction(value: unknown): value is LiaAction {
  if (!isObject(value) || typeof value.name !== "string") {
    return false;
  }

  return "args" in value && isObject(value.args);
}

export async function getLiaSettings(
  supabase: SupabaseClient,
  useComputerUse: boolean,
  organizationId?: string | null,
): Promise<LiaSettingsRecord> {
  const settingType = useComputerUse ? "COMPUTER" : "LIA_MODEL";

  let query = supabase
    .from("model_settings")
    .select("*")
    .eq("setting_type", settingType)
    .eq("is_active", true);

  if (organizationId) {
    query = query.eq("organization_id", organizationId);
  } else {
    query = query.is("organization_id", null);
  }

  const { data, error } = await query.single();

  if (error || !data) {
    console.warn(
      `No ${settingType} settings found for org ${organizationId || "global"}, using defaults.`,
    );
    return useComputerUse
      ? DEFAULT_COMPUTER_SETTINGS
      : DEFAULT_STANDARD_SETTINGS;
  }

  return data as LiaSettingsRecord;
}

export function detectHallucination(
  responseText: string,
  domMap: string | undefined,
): { isHallucinating: boolean; searchTerm: string | null } {
  if (!domMap) {
    return { isHallucinating: false, searchTerm: null };
  }

  const wizardStepNames = [
    "base",
    "temario",
    "plan",
    "fuentes",
    "materiales",
    "slides",
    "validacion",
    "idea central",
  ];

  const navigationTerms = [
    "ultimo",
    "primero",
    "anterior",
    "siguiente",
    "reciente",
    "mas reciente",
    "vuelvo",
    "volver",
    "lista",
    "creaste",
    "cree",
    "hice",
    "hiciste",
    "que cree",
    "que hice",
  ];

  const responseLower = responseText.toLowerCase();

  if (navigationTerms.some((term) => responseLower.includes(term))) {
    console.log(
      "[HALLUCINATION CHECK] Response is a navigation request - skipping hallucination check",
    );
    return { isHallucinating: false, searchTerm: null };
  }

  if (wizardStepNames.some((step) => responseLower.includes(step))) {
    console.log(
      "[HALLUCINATION CHECK] Response mentions wizard step - skipping hallucination check",
    );
    return { isHallucinating: false, searchTerm: null };
  }

  const claimPatterns = [
    /abro (?:el )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /veo (?:el )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /encontr[eé] (?:el )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /hago clic en (?:el )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /te llevo (?:al )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /navego (?:al )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /llevo (?:al )?(?:artefacto )?['"]?([^'".,]+)['"]?/i,
    /(?:artefacto|curso) ['"]?([^'".,]+)['"]?/i,
  ];

  const genericTerms = [
    "el",
    "la",
    "un",
    "una",
    "artefacto",
    "curso",
    "menu",
    "boton",
    "seccion",
    "de",
    "del",
    "paso",
    "fase",
    ...wizardStepNames,
    ...navigationTerms,
  ];

  for (const pattern of claimPatterns) {
    const match = responseLower.match(pattern);
    const claimedItem = match?.[1]?.trim().toLowerCase();

    if (!claimedItem || claimedItem.length < 3 || genericTerms.includes(claimedItem)) {
      continue;
    }

    const domMapLower = domMap.toLowerCase();

    if (domMapLower.includes(claimedItem)) {
      console.log(
        `[HALLUCINATION CHECK] "${claimedItem}" found in DOM map - no hallucination`,
      );
      return { isHallucinating: false, searchTerm: null };
    }

    const words = claimedItem
      .split(/\s+/)
      .filter((word) => word.length > 2 && !genericTerms.includes(word));
    const keyTerm = words.length > 0 ? words[words.length - 1] : claimedItem;

    if (wizardStepNames.includes(keyTerm)) {
      console.log(`[HALLUCINATION CHECK] "${keyTerm}" is a wizard step - skipping`);
      continue;
    }

    console.log(
      `[HALLUCINATION CHECK] Claimed: "${claimedItem}", Key term: "${keyTerm}"`,
    );

    if (!domMapLower.includes(keyTerm)) {
      console.log(
        `[HALLUCINATION DETECTED] Model claims "${claimedItem}" (key: "${keyTerm}") but it's not in DOM map`,
      );
      return { isHallucinating: true, searchTerm: keyTerm };
    }
  }

  return { isHallucinating: false, searchTerm: null };
}

function extractJsonBlock(text: string) {
  const start = text.indexOf("{");
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escape = false;

  for (let index = start; index < text.length; index++) {
    const char = text[index];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === "\\" && inString) {
      escape = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") {
      depth--;
      if (depth === 0) {
        return text.substring(start, index + 1);
      }
    }
  }

  return null;
}

export function parseActionFromResponse(text: string): ParsedLiaResponse | null {
  console.log("=== PARSING RESPONSE ===");
  console.log("Raw text length:", text.length);
  console.log("Raw text preview:", text.substring(0, 300));

  let cleanedText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanedText = codeBlockMatch[1];
    console.log("Found code block, extracted:", cleanedText.substring(0, 200));
  }

  const jsonStr = extractJsonBlock(cleanedText);
  console.log("Extracted JSON:", jsonStr ? jsonStr.substring(0, 300) : "null");

  if (!jsonStr) {
    console.log("No valid JSON found in response");
    console.log("Full response was:", text);
    return { cleanText: text };
  }

  try {
    const parsed = JSON.parse(jsonStr) as LiaActionEnvelope;
    const cleanText =
      typeof parsed.message === "string" ? parsed.message : "Ejecutando...";
    console.log("Parsed message:", cleanText);
    console.log("Parsed action:", parsed.action);
    console.log("Parsed actions:", parsed.actions);

    if (
      Array.isArray(parsed.actions) &&
      parsed.actions.length > 0 &&
      parsed.actions.every(isLiaAction)
    ) {
      console.log("Multiple actions parsed:", parsed.actions.length);
      return { actions: parsed.actions, cleanText };
    }

    if (isLiaAction(parsed.action)) {
      console.log("Single action parsed:", parsed.action.name);
      return { action: parsed.action, cleanText };
    }

    if (parsed.action === null || parsed.action === undefined) {
      console.log("Chat response (no action):", cleanText);
      return { cleanText };
    }
  } catch (error) {
    console.error("Error parsing action JSON:", error);
    console.error("JSON string was:", jsonStr);
  }

  return { cleanText: text };
}

export async function callGeminiREST(
  apiKey: string,
  model: string,
  prompt: string,
  config: LiaConfig,
): Promise<GeminiRestResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const body: {
    contents: Array<{ parts: Array<{ text: string }> }>;
    generationConfig: {
      temperature: number;
    };
    tools?: LiaConfig["tools"];
  } = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: config.temperature || 0.7,
    },
  };

  if (config.tools) {
    body.tools = config.tools;
  }

  console.log("Lia API - Calling REST API directly...");

  const restResponse = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!restResponse.ok) {
    const errorText = await restResponse.text();
    console.error("Lia API - REST API error:", restResponse.status, errorText);
    throw new Error(`Gemini API error: ${restResponse.status} - ${errorText}`);
  }

  const data = (await restResponse.json()) as GeminiRestApiResponse;
  return {
    text: data.candidates?.[0]?.content?.parts?.[0]?.text || "",
    groundingMetadata: data.candidates?.[0]?.groundingMetadata,
  };
}
