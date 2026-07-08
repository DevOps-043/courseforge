import { GoogleGenAI } from "@google/genai";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "@/lib/server/env";
import { getPipelineModelSettings } from "@/lib/server/model-settings";
import { bundleAgentSpecSchema, type BundleAgentSpec } from "./types";
import { buildSpecFromConversation, normalizeBundleAgentSpecForRendering } from "./spec.service";
import { sanitizeErrorMessage } from "./redaction.service";

interface MessageForSpec {
  role: string;
  content_redacted: string;
}

export interface AiSpecGenerationResult {
  spec: BundleAgentSpec;
  model: string;
  source: "openai" | "gemini" | "deterministic_fallback";
  warning: string | null;
}

interface OpenAIResponsesPayload {
  output?: Array<{
    content?: Array<{
      text?: string;
      type?: string;
    }>;
  }>;
  output_text?: string;
}

function buildPrompt(input: {
  title?: string | null;
  messages: MessageForSpec[];
}) {
  const conversation = input.messages
    .map((message) => `${message.role}: ${message.content_redacted}`)
    .join("\n")
    .slice(0, 16_000);

  return `Eres SofLIA Bundle Agent dentro de Courseforge. Convierte esta conversacion en una especificacion JSON segura para un bundle Remotion.

Reglas estrictas:
- Responde solo JSON, sin markdown.
- No incluyas codigo fuente.
- No incluyas secretos, tokens, credenciales, URLs remotas ni datos sensibles.
- No pidas dependencias ni runtime arbitrario.
- Si el titulo sugerido es generico ("Nuevo bundle Remotion"), crea un titulo descriptivo basado en el diseño solicitado.
- description debe ser un resumen funcional claro, no una copia literal de toda la conversacion.
- visualStyle debe ser una direccion visual concisa y completa; no debe quedar cortada a media frase.
- defaultProps.title y defaultProps.subtitle son copy visible dentro del video: deben ser cortos, editoriales y aptos para pantalla.
- Nunca pongas instrucciones internas, nombres de props, nombres de componentes, labels tecnicos ni el prompt del usuario en defaultProps.
- Evita textos visibles como "Avatar en primera persona", "Avatar pendiente", "Direccion visual", "Locucion activa" o nombres de zonas del layout.
- Incluye en requiredAssets solo assets realmente inferidos: slides, audio, avatar, broll, captions.
- Si el usuario pide colores, agrega props simples como accentColor en propsSchema/defaultProps.
- Usa compositionId estable con letras, numeros, punto, guion, dos puntos o guion bajo.
- durationFrames entre 30 y 900; fps entre 12 y 60; width max 3840; height max 2160.
- propsSchema debe ser JSON Schema simple type=object con properties de tipos basicos.
- defaultProps debe ser pequeno y compatible con propsSchema.

Contrato exacto:
{
  "title": "string",
  "description": "string",
  "visualStyle": "string",
  "compositionId": "string",
  "durationFrames": 150,
  "fps": 30,
  "width": 1920,
  "height": 1080,
  "requiredAssets": ["slides", "audio"],
  "propsSchema": {
    "type": "object",
    "required": ["title"],
    "properties": {
      "title": { "type": "string", "description": "..." }
    }
  },
  "defaultProps": { "title": "..." },
  "changeSummary": "string"
}

Titulo sugerido: ${input.title || "SofLIA Remotion bundle"}

Conversacion:
${conversation}`;
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    return trimmed;
  }

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    return fenced[1].trim();
  }

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) {
    return trimmed.slice(first, last + 1);
  }

  throw new Error("Gemini no devolvio un objeto JSON.");
}

function getOpenAIOutputText(payload: OpenAIResponsesPayload) {
  if (payload.output_text) {
    return payload.output_text;
  }

  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string" && content.text.trim()) {
        return content.text;
      }
    }
  }

  return "";
}

function fallbackSpec(input: { title?: string | null; messages: MessageForSpec[] }, warning: string | null): AiSpecGenerationResult {
  return {
    spec: buildSpecFromConversation(input),
    model: "courseforge-deterministic-fallback",
    source: "deterministic_fallback",
    warning,
  };
}

async function generateSpecWithOpenAI(input: {
  apiKey: string;
  title?: string | null;
  messages: MessageForSpec[];
}): Promise<AiSpecGenerationResult> {
  const model = process.env.OPENAI_BUNDLE_AGENT_MODEL || "gpt-4.1-mini";
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      input: buildPrompt(input),
      temperature: 0.3,
      text: {
        format: {
          type: "json_object",
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    throw new Error(`OpenAI spec generation failed: HTTP ${response.status} ${errorText.slice(0, 500)}`);
  }

  const payload = (await response.json()) as OpenAIResponsesPayload;
  const parsed = JSON.parse(extractJsonObject(getOpenAIOutputText(payload)));
  const spec = normalizeBundleAgentSpecForRendering(bundleAgentSpecSchema.parse(parsed));

  return {
    spec,
    model,
    source: "openai",
    warning: null,
  };
}

async function generateSpecWithGemini(input: {
  apiKey: string;
  organizationId: string;
  title?: string | null;
  messages: MessageForSpec[];
}): Promise<AiSpecGenerationResult> {
  const settings = await getPipelineModelSettings("MATERIALS", input.organizationId);
  const model = settings.model_name || settings.fallback_model || "gemini-2.5-flash";
  const genAI = new GoogleGenAI({ apiKey: input.apiKey });
  const result = await genAI.models.generateContent({
    model,
    contents: buildPrompt(input),
    config: {
      temperature: Math.min(0.7, Math.max(0.1, settings.temperature || 0.4)),
      responseMimeType: "application/json",
    },
  });

  const parsed = JSON.parse(extractJsonObject(result.text || ""));
  const spec = normalizeBundleAgentSpecForRendering(bundleAgentSpecSchema.parse(parsed));

  return {
    spec,
    model,
    source: "gemini",
    warning: null,
  };
}

export async function generateBundleSpecWithAi(input: {
  organizationId: string;
  title?: string | null;
  messages: MessageForSpec[];
}): Promise<AiSpecGenerationResult> {
  const openAIApiKey = getOptionalOpenAIApiKey();
  const geminiApiKey = getOptionalGeminiApiKey();
  const warnings: string[] = [];

  if (openAIApiKey) {
    try {
      return await generateSpecWithOpenAI({
        apiKey: openAIApiKey,
        title: input.title,
        messages: input.messages,
      });
    } catch (error) {
      warnings.push(`OpenAI: ${sanitizeErrorMessage(error)}`);
    }
  }

  if (geminiApiKey) {
    try {
      const result = await generateSpecWithGemini({
        apiKey: geminiApiKey,
        organizationId: input.organizationId,
        title: input.title,
        messages: input.messages,
      });

      return {
        ...result,
        warning: warnings.length > 0 ? warnings.join(" | ") : null,
      };
    } catch (error) {
      warnings.push(`Gemini: ${sanitizeErrorMessage(error)}`);
    }
  }

  return fallbackSpec(
    input,
    warnings.length > 0 ? warnings.join(" | ") : "No AI provider API key configured.",
  );
}
