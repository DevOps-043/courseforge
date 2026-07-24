import { GoogleGenAI } from "@google/genai";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "@/lib/server/env";
import { getPipelineModelSettings } from "@/lib/server/model-settings";
import {
  bundleAgentMessageMetadataSchema,
  bundleAgentSpecSchema,
  type BundleAgentSpec,
  type BundleAgentVisualReference,
} from "./types";
import { buildSpecFromConversation, normalizeBundleAgentSpecForRendering } from "./spec.service";
import { sanitizeErrorMessage } from "./redaction.service";

interface MessageForSpec {
  role: string;
  content_redacted: string;
  metadata?: unknown;
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

interface OpenAIInputMessage {
  role: "user";
  content: Array<
    | { type: "input_text"; text: string }
    | { type: "input_image"; image_url: string; detail?: "low" | "high" | "auto" }
  >;
}

function getVisualReferencesFromMessage(message: MessageForSpec): BundleAgentVisualReference[] {
  const parsed = bundleAgentMessageMetadataSchema.safeParse(message.metadata || {});
  return parsed.success ? parsed.data.visualReferences || [] : [];
}

function getImageReferences(messages: MessageForSpec[]) {
  return messages
    .flatMap((message) => getVisualReferencesFromMessage(message))
    .filter((reference) => reference.type === "image" && reference.publicUrl);
}

function formatBytes(sizeBytes: number) {
  if (sizeBytes >= 1024 * 1024) return `${Math.round(sizeBytes / (1024 * 1024))} MB`;
  return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
}

function buildVisualReferenceContext(messages: MessageForSpec[]) {
  const references = messages.flatMap((message) => getVisualReferencesFromMessage(message));

  if (references.length === 0) {
    return "Sin referencias visuales adjuntas.";
  }

  return references
    .map((reference, index) => {
      const note = reference.note ? ` Nota del usuario: ${reference.note}` : "";
      const visualSummary = reference.visualSummary ? ` Analisis automatico: ${reference.visualSummary}` : "";
      return `${index + 1}. ${reference.type.toUpperCase()} "${reference.fileName}" (${reference.mimeType}, ${formatBytes(reference.sizeBytes)}).${note}${visualSummary}`;
    })
    .join("\n");
}

function buildConstraintText(messages: MessageForSpec[]) {
  return [
    messages.map((message) => message.content_redacted).join("\n"),
    buildVisualReferenceContext(messages),
  ].join("\n").toLowerCase();
}

function extractReferenceFrameColor(messages: MessageForSpec[]) {
  const text = [
    messages.map((message) => message.content_redacted).join("\n"),
    buildVisualReferenceContext(messages),
  ].join("\n");
  const explicitFrameColor = text.match(/(?:frame\/border color|marco|border color)\s+(#[0-9a-fA-F]{6})/i);
  if (explicitFrameColor?.[1]) return explicitFrameColor[1].toUpperCase();

  const explicitHex = text.match(/#[0-9a-fA-F]{6}\b/);
  return explicitHex ? explicitHex[0].toUpperCase() : null;
}

function hasReferenceWireframeConstraint(messages: MessageForSpec[]) {
  const text = buildConstraintText(messages);

  return (
    text.includes("wireframe structure") ||
    text.includes("large left region plus right column split") ||
    text.includes("distribución de la imagen") ||
    text.includes("distribucion de la imagen") ||
    text.includes("estructura de la imagen") ||
    text.includes("color del marco") ||
    text.includes("conservando el color del marco")
  );
}

function hasSceneSwapConstraint(messages: MessageForSpec[]) {
  const text = buildConstraintText(messages);

  return (
    text.includes("todos los elementos de la izquierda se van a la derecha") ||
    text.includes("los de la derecha a la izquierda") ||
    text.includes("left") && text.includes("right") && text.includes("swap")
  );
}

function hasSupportExpansionConstraint(messages: MessageForSpec[]) {
  const text = buildConstraintText(messages);

  return (
    text.includes("si no hay b-roll") ||
    text.includes("si no hay broll") ||
    text.includes("si no hay diapositiva") ||
    text.includes("tomará el espacio del otro") ||
    text.includes("tomara el espacio del otro")
  );
}

function mergePropsSchemaProperties(spec: BundleAgentSpec, properties: Record<string, { type: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null"; description?: string }>) {
  return {
    ...spec.propsSchema,
    type: "object" as const,
    properties: {
      ...(spec.propsSchema.properties || {}),
      ...properties,
    },
  };
}

function applyVisualReferenceConstraints(spec: BundleAgentSpec, messages: MessageForSpec[]) {
  const shouldLockReference = hasReferenceWireframeConstraint(messages);
  const shouldSwapScenes = shouldLockReference || hasSceneSwapConstraint(messages);
  const shouldExpandSupport = shouldLockReference || hasSupportExpansionConstraint(messages);

  if (!shouldLockReference && !shouldSwapScenes && !shouldExpandSupport) {
    return spec;
  }

  const accentColor = extractReferenceFrameColor(messages) || (
    typeof spec.defaultProps.accentColor === "string" ? spec.defaultProps.accentColor : spec.creativeBrief.colorTokens.accent
  );
  const requiredAssets = Array.from(new Set([
    ...spec.requiredAssets,
    ...(shouldLockReference ? ["avatar", "slides", "broll"] as const : []),
  ]));
  const motionDirectives = [
    shouldSwapScenes ? "Scene changes happen on slide changes; left and right regions trade sides with smooth positional interpolation." : null,
    shouldExpandSupport ? "If either slide or B-roll is missing, the available support media expands to occupy both right-side regions." : null,
  ].filter(Boolean).join(" ");
  const visualStyle = [
    spec.visualStyle,
    shouldLockReference ? "reference wireframe lock: orange frame, avatar left, slide top-right, B-roll bottom-right" : null,
    motionDirectives,
  ].filter(Boolean).join("; ").slice(0, 240);
  const creativeBrief = {
    ...spec.creativeBrief,
    directionName: shouldLockReference ? "Reference Wireframe Lock" : spec.creativeBrief.directionName,
    layoutSystem: shouldLockReference
      ? "Reference wireframe lock: thick colored outer frame, left half reserved for avatar, right half split equally with slide region above and B-roll region below."
      : spec.creativeBrief.layoutSystem,
    motionLanguage: [
      spec.creativeBrief.motionLanguage,
      motionDirectives,
    ].filter(Boolean).join(" ").slice(0, 500),
    colorTokens: {
      ...spec.creativeBrief.colorTokens,
      paletteName: shouldLockReference ? "Reference frame color" : spec.creativeBrief.colorTokens.paletteName,
      background: shouldLockReference ? accentColor : spec.creativeBrief.colorTokens.background,
      surface: shouldLockReference ? "#FFFFFF" : spec.creativeBrief.colorTokens.surface,
      accent: accentColor,
      text: shouldLockReference ? "#0F172A" : spec.creativeBrief.colorTokens.text,
      muted: shouldLockReference ? "#475569" : spec.creativeBrief.colorTokens.muted,
    },
    similarityCheck: {
      ...spec.creativeBrief.similarityCheck,
      differentiators: Array.from(new Set([
        "Reference image geometry is treated as a hard layout contract.",
        shouldSwapScenes ? "Left and right regions swap at every slide change." : null,
        shouldExpandSupport ? "Support media expands when slide or B-roll is missing." : null,
        ...spec.creativeBrief.similarityCheck.differentiators,
      ].filter((item): item is string => typeof item === "string"))).slice(0, 10),
    },
    visualVariants: [
      {
        id: "variant-reference-wireframe",
        name: "Reference wireframe",
        composition: "Avatar occupies the left half; slide and B-roll split the right half into upper and lower regions.",
        palette: `Reference frame color ${accentColor} with white content regions.`,
        motion: shouldSwapScenes ? "Scene-indexed left/right position swap with smooth interpolation." : "Measured opacity transitions aligned to slide changes.",
        emphasis: "Faithful structure and frame color from the uploaded reference.",
      },
      ...spec.creativeBrief.visualVariants.filter((variant) => variant.id !== "variant-reference-wireframe"),
    ].slice(0, 6),
  };

  return bundleAgentSpecSchema.parse({
    ...spec,
    visualStyle,
    creativeBrief,
    requiredAssets,
    propsSchema: mergePropsSchemaProperties(spec, {
      visualVariantId: { type: "string", description: "ID de variante visual declarada en creativeBrief.visualVariants." },
      animationVariant: { type: "string", description: "Ritmo de animacion elegido desde la direccion creativa." },
      designTokens: { type: "object", description: "Tokens visuales seguros expuestos por la direccion creativa." },
      sceneSwapOnSlideChange: { type: "boolean", description: "Intercambia izquierda/derecha al cambiar de diapositiva." },
      expandMissingSupportMedia: { type: "boolean", description: "Expande slide o B-roll cuando falta el otro soporte visual." },
    }),
    defaultProps: {
      ...spec.defaultProps,
      accentColor,
      animationVariant: shouldSwapScenes ? "scene-swap" : spec.defaultProps.animationVariant,
      designTokens: {
        ...(typeof spec.defaultProps.designTokens === "object" && spec.defaultProps.designTokens ? spec.defaultProps.designTokens : {}),
        backgroundColor: creativeBrief.colorTokens.background,
        surfaceColor: creativeBrief.colorTokens.surface,
        accentColor,
        textColor: creativeBrief.colorTokens.text,
        mutedTextColor: creativeBrief.colorTokens.muted,
        typographyDisplay: creativeBrief.typographyTokens.display,
        typographyBody: creativeBrief.typographyTokens.body,
      },
      expandMissingSupportMedia: shouldExpandSupport,
      sceneSwapOnSlideChange: shouldSwapScenes,
      visualVariantId: creativeBrief.visualVariants[0].id,
    },
    changeSummary: [
      spec.changeSummary,
      shouldLockReference ? "Applied uploaded reference as hard wireframe layout and frame-color contract." : null,
      shouldSwapScenes ? "Enabled scene swaps on slide changes." : null,
      shouldExpandSupport ? "Enabled support-media expansion when slide or B-roll is missing." : null,
    ].filter(Boolean).join(" "),
  });
}

function buildFallbackMessagesWithVisualContext(messages: MessageForSpec[]): MessageForSpec[] {
  const visualContext = buildVisualReferenceContext(messages);

  if (visualContext === "Sin referencias visuales adjuntas.") {
    return messages;
  }

  return [
    ...messages,
    {
      role: "USER",
      content_redacted: `Referencias visuales adjuntas para orientar estilo, layout, ritmo o atmosfera:\n${visualContext}`,
    },
  ];
}

function buildOpenAIInput(input: { title?: string | null; messages: MessageForSpec[] }): string | OpenAIInputMessage[] {
  const prompt = buildPrompt(input);
  const imageReferences = getImageReferences(input.messages).slice(0, 4);

  if (imageReferences.length === 0) {
    return prompt;
  }

  return [
    {
      role: "user",
      content: [
        { type: "input_text", text: prompt },
        ...imageReferences.map((reference) => ({
          type: "input_image" as const,
          image_url: reference.publicUrl!,
          detail: "high" as const,
        })),
      ],
    },
  ];
}

function buildGeminiContents(input: { title?: string | null; messages: MessageForSpec[] }) {
  const prompt = buildPrompt(input);
  const imageReferences = getImageReferences(input.messages).slice(0, 4);

  if (imageReferences.length === 0) {
    return prompt;
  }

  return [
    {
      role: "user",
      parts: [
        { text: prompt },
        ...imageReferences.map((reference) => ({
          fileData: {
            mimeType: reference.mimeType,
            fileUri: reference.publicUrl!,
          },
        })),
      ],
    },
  ];
}

function buildPrompt(input: {
  title?: string | null;
  messages: MessageForSpec[];
}) {
  const latestUserMessage = [...input.messages]
    .reverse()
    .find((message) => message.role === "USER")
    ?.content_redacted
    .trim() || "Sin mensaje de usuario.";
  const conversation = input.messages
    .map((message) => `${message.role}: ${message.content_redacted}`)
    .join("\n")
    .slice(0, 16_000);
  const visualReferences = buildVisualReferenceContext(input.messages).slice(0, 4_000);

  return `Eres SofLIA Bundle Agent dentro de SofLIA - Engine. Convierte esta conversacion en una especificacion JSON segura para un bundle de video.

Reglas estrictas:
- Responde solo JSON, sin markdown.
- No incluyas codigo fuente.
- No incluyas secretos, tokens, credenciales, URLs remotas ni datos sensibles.
- No pidas dependencias ni runtime arbitrario.
- Si el titulo sugerido es generico ("Nuevo bundle de video"), crea un titulo descriptivo basado en el diseño solicitado.
- description debe ser un resumen funcional claro, no una copia literal de toda la conversacion.
- visualStyle debe ser una direccion visual concisa y completa; no debe quedar cortada a media frase.
- defaultProps.title y defaultProps.subtitle son copy visible dentro del video: deben ser cortos, editoriales y aptos para pantalla.
- Nunca pongas instrucciones internas, nombres de props, nombres de componentes, labels tecnicos ni el prompt del usuario en defaultProps.
- Evita textos visibles como "Avatar en primera persona", "Avatar pendiente", "Direccion visual", "Locucion activa" o nombres de zonas del layout.
- La retroalimentacion mas reciente del usuario es autoridad sobre mensajes anteriores. Si contradice una version previa, aplica el cambio nuevo.
- Si hay feedback posterior a una spec o version anterior, changeSummary debe mencionar cambios concretos y la nueva spec debe cambiar layout, color, assets o copy cuando el feedback lo solicite.
- Antes de definir el bundle, actua como director creativo de Remotion y completa creativeBrief.
- creativeBrief debe incluir: directionName, visualReferences, layoutSystem, motionLanguage, colorTokens, typographyTokens, similarityCheck, componentArchitecture y visualVariants.
- visualVariants debe tener al menos 3 variantes visuales realmente distintas.
- similarityCheck.differentiators debe contener al menos 4 diferencias frente a plantillas comunes.
- Nunca reutilices como idea base: titulo centrado, subtitulo debajo, fondo degradado generico, cards con fade-in o transicion de slide generica.
- La direccion creativa debe diferir en al menos 4 dimensiones: composicion, paleta, tipografia, ritmo, transicion, estructura de escenas, uso de media, profundidad/camara, textura/fondo o jerarquia.
- Incluye en requiredAssets solo assets realmente inferidos: slides, audio, avatar, broll, captions.
- Si hay slides y broll, la plantilla debe ser capaz de mostrar ambos de forma intencional: alternados, combinados, superpuestos o en zonas separadas. No debe ocultar B-roll solo porque existan diapositivas.
- Usa las referencias visuales adjuntas como inspiracion de estilo, composicion, ritmo, motion, colores o atmosfera; no las trates como assets finales del render.
- Si el usuario pide usar una referencia visual para estructura, layout, marco, color o composicion, esa referencia deja de ser inspiracion y se vuelve restriccion dura.
- Cuando el analisis automatico detecte frame/border color, divisores o regiones, refleja esos hallazgos en creativeBrief.layoutSystem, creativeBrief.colorTokens.accent, visualStyle y changeSummary.
- Para wireframes de regiones, mapea las etiquetas o zonas detectadas a assets: avatar = zona de avatar, slides/diapositiva = zona de diapositiva, broll/B-roll = zona de B-roll.
- Si el usuario indica que cada cambio de escena ocurre al cambiar diapositiva, expone sceneSwapOnSlideChange=true y animationVariant="scene-swap".
- Si el usuario indica que izquierda y derecha intercambian lados, creativeBrief.motionLanguage debe describir ese swap y defaultProps.sceneSwapOnSlideChange debe ser true.
- Si el usuario indica que slide o B-roll debe ocupar el espacio del otro cuando falte, defaultProps.expandMissingSupportMedia debe ser true.
- No bases la animacion esperada en transform/translate/scale/rotate sobre capas editables; el editor de layout de SofLIA - Engine controla posicion, tamano y recorte. Describe motion compatible con fades, cortes, ritmo visual y cambios de opacidad.
- No copies rutas internas, URLs de storage, nombres privados de archivo ni metadatos tecnicos dentro de defaultProps.
- durationFrames es solo fallback/preview de la plantilla, no debe hardcodear la duracion final del render.
- La plantilla final debe resolver la duracion con calculateMetadata usando props.totalDurationInFrames y, cuando aplique, metadata real del avatar/audio.
- Si el usuario pide colores, agrega props simples como accentColor en propsSchema/defaultProps.
- propsSchema/defaultProps debe exponer visualVariantId, animationVariant y designTokens cuando creativeBrief exista.
- Usa compositionId estable con letras, numeros, punto, guion, dos puntos o guion bajo.
- durationFrames entre 30 y 900; fps entre 12 y 60; width max 3840; height max 2160.
- propsSchema debe ser JSON Schema simple type=object con properties de tipos basicos.
- defaultProps debe ser pequeno y compatible con propsSchema.

Contrato exacto:
{
  "title": "string",
  "description": "string",
  "visualStyle": "string",
  "creativeBrief": {
    "directionName": "string",
    "visualReferences": ["string", "string"],
    "layoutSystem": "string",
    "motionLanguage": "string",
    "colorTokens": {
      "paletteName": "string",
      "background": "#05070B",
      "surface": "#111827",
      "accent": "#00D4B3",
      "text": "#F8FAFC",
      "muted": "#CBD5E1"
    },
    "typographyTokens": {
      "display": "string",
      "body": "string",
      "label": "string"
    },
    "similarityCheck": {
      "avoidedPatterns": ["Centered title with subtitle below", "Single gradient background", "Generic fade-in cards"],
      "differentiators": ["composition", "palette", "motion rhythm", "information hierarchy"]
    },
    "componentArchitecture": ["Typed root composition", "Variant-aware layout resolver", "Reusable media layers"],
    "visualVariants": [
      {
        "id": "variant-a",
        "name": "string",
        "composition": "string",
        "palette": "string",
        "motion": "string",
        "emphasis": "string"
      },
      {
        "id": "variant-b",
        "name": "string",
        "composition": "string",
        "palette": "string",
        "motion": "string",
        "emphasis": "string"
      },
      {
        "id": "variant-c",
        "name": "string",
        "composition": "string",
        "palette": "string",
        "motion": "string",
        "emphasis": "string"
      }
    ]
  },
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
  "defaultProps": {
    "title": "...",
    "visualVariantId": "variant-reference-wireframe",
    "animationVariant": "scene-swap",
    "sceneSwapOnSlideChange": true,
    "expandMissingSupportMedia": true,
    "designTokens": { "backgroundColor": "#DE8D00", "surfaceColor": "#FFFFFF", "accentColor": "#DE8D00" }
  },
  "changeSummary": "string"
}

Titulo sugerido: ${input.title || "SofLIA video bundle"}

Ultimo mensaje/feedback del usuario:
${latestUserMessage.slice(0, 4_000)}

Referencias visuales adjuntas:
${visualReferences}

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
    spec: buildSpecFromConversation({
      ...input,
      messages: buildFallbackMessagesWithVisualContext(input.messages),
    }),
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
      input: buildOpenAIInput(input),
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
  const spec = normalizeBundleAgentSpecForRendering(applyVisualReferenceConstraints(
    bundleAgentSpecSchema.parse(parsed),
    input.messages,
  ));

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
    contents: buildGeminiContents(input) as any,
    config: {
      temperature: Math.min(0.7, Math.max(0.1, settings.temperature || 0.4)),
      responseMimeType: "application/json",
    },
  });

  const parsed = JSON.parse(extractJsonObject(result.text || ""));
  const spec = normalizeBundleAgentSpecForRendering(applyVisualReferenceConstraints(
    bundleAgentSpecSchema.parse(parsed),
    input.messages,
  ));

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
