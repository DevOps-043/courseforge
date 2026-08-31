import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "../../../../lib/server/env";
import type { SlideSourcePack } from "../content/slide-source-pack.service";
import { containsProductionMetadataLeak } from "../content/slide-visible-content.service";
import {
  copyBudgetForSlideType,
  hasUnexpectedVisibleLanguage,
  limitSlideCopy,
} from "../content/slide-copy-policy.service";
import type { CourseDeckSpec } from "../specs/course-deck.schema";
import type {
  SlideAgentModelSettingRecord,
  SlideAgentPromptRecord,
} from "./slide-agent-prompt-codes";

const synthesisResponseSchema = z.object({
  slides: z.array(z.unknown()).max(24),
});

type SynthesisProvider = "gemini" | "openai" | "deterministic_fallback";

export interface VisibleCopySynthesisTrace {
  appliedSlideCount: number;
  model: string;
  provider: SynthesisProvider;
  warning: string | null;
}

interface SynthesizeVisibleCopyParams {
  deckSpec: CourseDeckSpec;
  languageRepair?: boolean;
  model?: SlideAgentModelSettingRecord;
  prompt?: SlideAgentPromptRecord;
  sourcePack?: SlideSourcePack;
}

function providerForModel(model: string | null | undefined): Exclude<SynthesisProvider, "deterministic_fallback"> | null {
  if (typeof model !== "string") return null;
  if (/^gemini(?:-|$)/i.test(model.trim())) return "gemini";
  if (/^(?:gpt-|o\d)/i.test(model.trim())) return "openai";
  return null;
}

function isRetiredGeminiModel(model: string | null | undefined) {
  return typeof model === "string" && /^gemini-2\.0-/i.test(model.trim());
}

function resolveModel(params: SynthesizeVisibleCopyParams, provider: Exclude<SynthesisProvider, "deterministic_fallback">) {
  const candidates = [params.model?.modelName, params.model?.fallbackModel];
  const matching = candidates.find((candidate) =>
    providerForModel(candidate) === provider && !(provider === "gemini" && isRetiredGeminiModel(candidate)),
  );
  return matching || (provider === "gemini" ? "gemini-2.5-flash" : "gpt-4.1-mini");
}

function temperatureFor(params: SynthesizeVisibleCopyParams) {
  const temperature = params.model?.temperature;
  return typeof temperature === "number" && Number.isFinite(temperature)
    ? Math.min(0.7, Math.max(0.1, temperature))
    : 0.3;
}

function supportsOpenAITemperature(model: string) {
  return !/^(?:gpt-5|o\d)/i.test(model.trim());
}

function compactText(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function textItems(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(compactText).filter(Boolean);
  }
  const text = compactText(value);
  return text ? text.split(/\n|\s*[-•]\s+/).map((item) => item.trim()).filter(Boolean) : [];
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) return trimmed;

  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  throw new Error("El proveedor no devolvio un objeto JSON de copy visible.");
}

function sourceEvidenceForPrompt(sourcePack?: SlideSourcePack) {
  const insights = sourcePack?.insights || [];
  return insights.slice(0, 18).map((insight) => ({
    sourceRef: insight.sourceRef,
    title: insight.title,
    type: insight.type,
    claims: insight.bodyItems.slice(0, 3),
  }));
}

function deckDraftForPrompt(deckSpec: CourseDeckSpec) {
  return deckSpec.slides.map((slide) => ({
    draftBullets: slide.bodyBlocks.flatMap((block) => block.kind === "bullets"
      ? block.items || []
      : block.text ? [block.text] : []),
    id: slide.id,
    sourceRefs: slide.validationHints.sourceRefs,
    title: slide.title,
    type: slide.type,
  }));
}

function buildSynthesisPrompt(params: SynthesizeVisibleCopyParams) {
  const localeName = params.deckSpec.locale === "es" ? "espanol neutro" : "ingles";
  const configuredPrompt = compactText(params.prompt?.content);

  return `${configuredPrompt || "Redacta copy visible breve y respaldado por evidencia para diapositivas educativas."}

CONTRATO OBLIGATORIO:
- Devuelve exclusivamente JSON valido con la forma {"slides":[{"id":"...","title":"...","subtitle":"...","bullets":["..."]}]}.
- El idioma obligatorio del contenido visible es ${localeName}.
- Si la evidencia esta en otro idioma, traduce su significado al idioma obligatorio. No copies prosa del idioma de la fuente.
- Una diapositiva es apoyo visual de una narracion: no transcribas fuentes, guion ni notas del avatar.
- Conserva la idea pedagogica, pero usa frases nuevas, concretas y breves.
- Para cada slide: titulo maximo 58 caracteres; hasta 3 bullets; cada bullet maximo 68 caracteres. Portadas: un solo mensaje breve.
- Usa solo claims respaldados por la evidencia proporcionada. No inventes cifras, ejemplos ni recomendaciones.
- No menciones guion, storyboard, B-roll, avatar, timecode ni instrucciones de produccion.
- Si una slide no tiene evidencia suficiente, conserva su idea borrador de forma concisa; no agregues contenido nuevo.
- Devuelve una entrada por cada id de slide proporcionado.
- Cada elemento de slides debe usar exactamente id, title, subtitle opcional y bullets. No anides esos campos ni uses heading, points o content.
${params.languageRepair ? "- CORRECCION OBLIGATORIA: el intento anterior contenia prosa en el idioma equivocado. Reescribe todas las slides en el idioma obligatorio antes de responder." : ""}

EVIDENCIA CURADA:
${JSON.stringify(sourceEvidenceForPrompt(params.sourcePack))}

BORRADOR DEL DECK:
${JSON.stringify(deckDraftForPrompt(params.deckSpec))}`;
}

function slideVisibleText(slide: CourseDeckSpec["slides"][number]) {
  return [
    slide.title,
    slide.subtitle || "",
    ...slide.bodyBlocks.flatMap((block) => block.kind === "bullets"
      ? block.items || []
      : block.text ? [block.text] : []),
  ].join(" ");
}

function hasDeckLocaleMismatch(deckSpec: CourseDeckSpec) {
  return deckSpec.slides.some((slide) =>
    hasUnexpectedVisibleLanguage(slideVisibleText(slide), deckSpec.locale),
  );
}

function hasDeckProductionMetadataLeak(deckSpec: CourseDeckSpec) {
  return deckSpec.slides.some((slide) => containsProductionMetadataLeak(slideVisibleText(slide)));
}

function normalizeSynthesis(params: {
  deckSpec: CourseDeckSpec;
  response: unknown;
}) {
  const parsed = synthesisResponseSchema.parse(params.response);
  const byId = new Map(params.deckSpec.slides.map((slide, index) => {
    const raw = asRecord(parsed.slides[index]);
    const nestedSlide = asRecord(raw.slide);
    const nestedContent = asRecord(raw.content);
    const candidate = Object.keys(nestedSlide).length > 0
      ? nestedSlide
      : Object.keys(nestedContent).length > 0 ? nestedContent : raw;
    const id = compactText(candidate.id) || slide.id;
    return [id, {
      bullets: textItems(candidate.bullets ?? candidate.bullet_points ?? candidate.points ?? candidate.items ?? candidate.content),
      id,
      subtitle: compactText(candidate.subtitle ?? candidate.subheading),
      title: compactText(candidate.title ?? candidate.title_text ?? candidate.copy_title ?? candidate.heading ?? candidate.headline) || slide.title,
    }];
  }));

  return {
    ...params.deckSpec,
    slides: params.deckSpec.slides.map((slide) => {
      const proposed = byId.get(slide.id);
      if (!proposed) return slide;

      const budget = copyBudgetForSlideType(slide.type);
      const bullets = (proposed.bullets || [])
        .map((item) => limitSlideCopy(item, budget.maxBodyItemCharacters))
        .filter(Boolean)
        .slice(0, budget.maxBodyItems);
      const currentItems = slide.bodyBlocks.flatMap((block) => block.kind === "bullets"
        ? block.items || []
        : block.text ? [block.text] : []);

      return {
        ...slide,
        bodyBlocks: [{
          items: bullets.length > 0
            ? bullets
            : currentItems.slice(0, budget.maxBodyItems).map((item) => limitSlideCopy(item, budget.maxBodyItemCharacters)),
          kind: "bullets" as const,
        }],
        subtitle: limitSlideCopy(proposed.subtitle, budget.maxSubtitleCharacters) || undefined,
        title: limitSlideCopy(proposed.title, budget.maxTitleCharacters),
      };
    }),
  } satisfies CourseDeckSpec;
}

async function synthesizeWithOpenAI(params: SynthesizeVisibleCopyParams, apiKey: string) {
  const model = resolveModel(params, "openai");
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      input: buildSynthesisPrompt(params),
      model,
      ...(supportsOpenAITemperature(model) ? { temperature: temperatureFor(params) } : {}),
      text: { format: { type: "json_object" } },
    }),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`OpenAI visible-copy synthesis failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const payload = await response.json() as {
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  };
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || [])
    .find((content) => typeof content.text === "string")?.text || "";

  return { model, response: JSON.parse(extractJsonObject(text)), provider: "openai" as const };
}

async function synthesizeWithGemini(params: SynthesizeVisibleCopyParams, apiKey: string) {
  const model = resolveModel(params, "gemini");
  const client = new GoogleGenAI({ apiKey });
  const result = await client.models.generateContent({
    config: {
      responseMimeType: "application/json",
      temperature: temperatureFor(params),
    },
    contents: buildSynthesisPrompt(params),
    model,
  });

  return {
    model,
    response: JSON.parse(extractJsonObject(result.text || "")),
    provider: "gemini" as const,
  };
}

/** Uses the configured visible-copy model, with a deterministic deck as a safe fallback. */
export async function synthesizeDeckVisibleCopy(params: SynthesizeVisibleCopyParams): Promise<{
  deckSpec: CourseDeckSpec;
  trace: VisibleCopySynthesisTrace;
}> {
  const openAiKey = getOptionalOpenAIApiKey();
  const geminiKey = getOptionalGeminiApiKey();
  const configuredProviders = [
    providerForModel(params.model?.modelName),
    providerForModel(params.model?.fallbackModel),
    "gemini" as const,
    "openai" as const,
  ].filter((provider, index, providers): provider is Exclude<SynthesisProvider, "deterministic_fallback"> =>
    Boolean(provider) && providers.indexOf(provider) === index,
  );
  const warnings: string[] = [];

  for (const provider of configuredProviders) {
    try {
      const result = provider === "gemini"
        ? geminiKey ? await synthesizeWithGemini(params, geminiKey) : null
        : openAiKey ? await synthesizeWithOpenAI(params, openAiKey) : null;
      if (!result) continue;

      let deckSpec = normalizeSynthesis({ deckSpec: params.deckSpec, response: result.response });
      if (hasDeckLocaleMismatch(deckSpec)) {
        const repaired = provider === "gemini"
          ? geminiKey ? await synthesizeWithGemini({ ...params, languageRepair: true }, geminiKey) : null
          : openAiKey ? await synthesizeWithOpenAI({ ...params, languageRepair: true }, openAiKey) : null;
        if (!repaired) {
          throw new Error("No se pudo ejecutar la correccion obligatoria de idioma.");
        }
        deckSpec = normalizeSynthesis({ deckSpec: params.deckSpec, response: repaired.response });
      }
      if (hasDeckLocaleMismatch(deckSpec)) {
        throw new Error(`El proveedor no genero copy en el idioma solicitado (${params.deckSpec.locale}).`);
      }
      if (hasDeckProductionMetadataLeak(deckSpec)) {
        throw new Error("El proveedor incluyo metadatos internos de produccion en el copy visible.");
      }
      return {
        deckSpec,
        trace: {
          appliedSlideCount: deckSpec.slides.length,
          model: result.model,
          provider: result.provider,
          warning: warnings.length > 0 ? warnings.join(" | ") : null,
        },
      };
    } catch (error) {
      warnings.push(error instanceof Error ? `${provider}: ${error.message}` : `${provider}: error desconocido`);
    }
  }

  if (hasDeckLocaleMismatch(params.deckSpec)) {
    throw new Error(
      `No se pudo sintetizar el deck en ${params.deckSpec.locale}. ${warnings.join(" | ") || "No hay proveedor de IA configurado para traducir las fuentes."}`,
    );
  }

  return {
    deckSpec: params.deckSpec,
    trace: {
      appliedSlideCount: 0,
      model: "soflia-engine-deterministic-fallback",
      provider: "deterministic_fallback",
      warning: warnings.length > 0 ? warnings.join(" | ") : "No hay proveedor de IA configurado para sintetizar copy visible.",
    },
  };
}
