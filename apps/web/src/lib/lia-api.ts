import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GeminiRestResponse,
  LiaAction,
  LiaConfig,
  LiaGroundingMetadata,
  LiaSettingsRecord,
  ParsedLiaResponse,
} from "@/lib/lia-types";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import { fetchWithDeadline, readJsonResponseWithLimit } from "@/lib/server/outbound-http";

const LIA_PROVIDER_TIMEOUT_MS = 60_000;
const LIA_PROVIDER_RESPONSE_MAX_BYTES = 4 * 1024 * 1024;

const DEFAULT_COMPUTER_SETTINGS: LiaSettingsRecord = {
  model_name: "gemini-3.5-flash",
  temperature: 0.3,
  setting_type: "COMPUTER",
};

const DEFAULT_STANDARD_SETTINGS: LiaSettingsRecord = {
  model_name: "gemini-3.5-flash",
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
    return { isHallucinating: false, searchTerm: null };
  }

  if (wizardStepNames.some((step) => responseLower.includes(step))) {
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
      return { isHallucinating: false, searchTerm: null };
    }

    const words = claimedItem
      .split(/\s+/)
      .filter((word) => word.length > 2 && !genericTerms.includes(word));
    const keyTerm = words.length > 0 ? words[words.length - 1] : claimedItem;

    if (wizardStepNames.includes(keyTerm)) {
      continue;
    }

    if (!domMapLower.includes(keyTerm)) {
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
  let cleanedText = text;
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) {
    cleanedText = codeBlockMatch[1];
  }

  const jsonStr = extractJsonBlock(cleanedText);

  if (!jsonStr) {
    return { cleanText: text };
  }

  try {
    const parsed = JSON.parse(jsonStr) as LiaActionEnvelope;
    const cleanText =
      typeof parsed.message === "string" ? parsed.message : "Ejecutando...";
    if (
      Array.isArray(parsed.actions) &&
      parsed.actions.length > 0 &&
      parsed.actions.every(isLiaAction)
    ) {
      return { actions: parsed.actions, cleanText };
    }

    if (isLiaAction(parsed.action)) {
      return { action: parsed.action, cleanText };
    }

    if (parsed.action === null || parsed.action === undefined) {
      return { cleanText };
    }
  } catch {
    // The caller can safely fall back to the original assistant text.
  }

  return { cleanText: text };
}

export async function callGeminiREST(
  apiKey: string,
  model: string,
  prompt: string,
  config: LiaConfig,
  correlationId?: string,
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

  const logger = createOperationalLogger("lia.gemini", {
    correlationId: resolveCorrelationId(correlationId),
    model,
  });
  const startedAt = Date.now();
  logger.info("lia.provider.requested", { promptLength: prompt.length });

  const restResponse = await fetchWithDeadline(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }, LIA_PROVIDER_TIMEOUT_MS);

  if (!restResponse.ok) {
    logger.error("lia.provider.failed", new Error(`HTTP ${restResponse.status}`), {
      durationMs: Date.now() - startedAt,
      status: restResponse.status,
    });
    throw new Error(`Gemini API error: HTTP ${restResponse.status}`);
  }

  const data = await readJsonResponseWithLimit<GeminiRestApiResponse>(
    restResponse,
    LIA_PROVIDER_RESPONSE_MAX_BYTES,
  );
  const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
  logger.info("lia.provider.completed", {
    durationMs: Date.now() - startedAt,
    responseLength: responseText.length,
  });
  return {
    text: responseText,
    groundingMetadata: data.candidates?.[0]?.groundingMetadata,
  };
}
