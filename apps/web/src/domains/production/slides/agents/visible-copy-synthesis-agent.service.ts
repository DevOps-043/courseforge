import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  fetchWithDeadline,
  readJsonResponseWithLimit,
  readResponseTextWithLimit,
} from "../../../../lib/server/outbound-http";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "../../../../lib/server/env";
import type { SlideSourcePack } from "../content/slide-source-pack.service";
import { validateCourseDeckVisibleCopy } from "../validation/course-deck-qa.service";
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

const SYNTHESIS_TIMEOUT_MS = 60_000;
const SYNTHESIS_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const SYNTHESIS_ERROR_MAX_BYTES = 32 * 1024;

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
  repairFeedback?: string[];
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
    // Context for distinct educational ideas; never rendered as slide copy directly.
    sectionNarrative: slide.speakerNotes,
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
- Cada diapositiva debe desarrollar una idea distinta de su seccion. No repitas titulo y bullets entre slides ni cambies solo el numero para ocultar duplicados.
- sectionNarrative es contexto pedagogico de esa seccion: sintetiza su idea sin transcribirlo ni mostrar instrucciones de produccion.
- Cada elemento de slides debe usar exactamente id, title, subtitle opcional y bullets. No anides esos campos ni uses heading, points o content.
${params.repairFeedback?.length ? `CORRECCIONES OBLIGATORIAS DEL INTENTO ANTERIOR:\n${JSON.stringify(params.repairFeedback)}` : ""}

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

function normalizeSynthesis(params: {
  deckSpec: CourseDeckSpec;
  response: unknown;
}) {
  const parsed = synthesisResponseSchema.parse(params.response);
  const expectedIds = new Set(params.deckSpec.slides.map((slide) => slide.id));
  if (parsed.slides.length !== expectedIds.size) {
    throw new Error(`Devuelve exactamente ${expectedIds.size} slides, una por cada id solicitado.`);
  }
  const seenIds = new Set<string>();
  const byId = new Map(parsed.slides.map((value) => {
    const raw = asRecord(value);
    const nestedSlide = asRecord(raw.slide);
    const nestedContent = asRecord(raw.content);
    const candidate = Object.keys(nestedSlide).length > 0
      ? nestedSlide
      : Object.keys(nestedContent).length > 0 ? nestedContent : raw;
    const id = compactText(candidate.id);
    if (!expectedIds.has(id) || seenIds.has(id)) {
      throw new Error(`Id de slide desconocido o repetido: ${id || "(vacio)"}. Conserva exactamente los ids solicitados.`);
    }
    seenIds.add(id);
    const title = compactText(candidate.title ?? candidate.title_text ?? candidate.copy_title ?? candidate.heading ?? candidate.headline);
    if (!title) throw new Error(`La slide ${id} necesita un titulo.`);
    return [id, {
      bullets: textItems(candidate.bullets ?? candidate.bullet_points ?? candidate.points ?? candidate.items ?? candidate.content),
      id,
      subtitle: compactText(candidate.subtitle ?? candidate.subheading),
      title,
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
  const response = await fetchWithDeadline("https://api.openai.com/v1/responses", {
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
  }, SYNTHESIS_TIMEOUT_MS);

  if (!response.ok) {
    const detail = (await readResponseTextWithLimit(response, SYNTHESIS_ERROR_MAX_BYTES).catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`OpenAI visible-copy synthesis failed: HTTP ${response.status}${detail ? ` ${detail}` : ""}`);
  }

  const payload = await readJsonResponseWithLimit<{
    output_text?: string;
    output?: Array<{ content?: Array<{ text?: string }> }>;
  }>(response, SYNTHESIS_RESPONSE_MAX_BYTES);
  const text = payload.output_text || payload.output?.flatMap((item) => item.content || [])
    .find((content) => typeof content.text === "string")?.text || "";

  return { model, response: JSON.parse(extractJsonObject(text)), provider: "openai" as const };
}

async function synthesizeWithGemini(params: SynthesizeVisibleCopyParams, apiKey: string) {
  const model = resolveModel(params, "gemini");
  const client = new GoogleGenAI({ apiKey });
  const result = await client.models.generateContent({
    config: {
      abortSignal: AbortSignal.timeout(SYNTHESIS_TIMEOUT_MS),
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
      const apiKey = provider === "gemini" ? geminiKey : openAiKey;
      if (!apiKey) continue;
      let repairFeedback: string[] | undefined;
      // One bounded repair per provider, using the same rules as final QA.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const request = { ...params, repairFeedback };
        const result = provider === "gemini"
          ? await synthesizeWithGemini(request, apiKey)
          : await synthesizeWithOpenAI(request, apiKey);
        let deckSpec: CourseDeckSpec | undefined;
        try {
          deckSpec = normalizeSynthesis({ deckSpec: params.deckSpec, response: result.response });
          repairFeedback = validateCourseDeckVisibleCopy(deckSpec)
            .filter((finding) => finding.severity === "error")
            .map((finding) => `${finding.slideId || "deck"}: ${finding.code}: ${finding.message}`);
        } catch (error) {
          repairFeedback = [error instanceof Error ? error.message : "Respuesta de copy invalida."];
        }
        if (deckSpec && repairFeedback.length === 0) {
          return {
            deckSpec,
            trace: {
              appliedSlideCount: deckSpec.slides.length,
              model: result.model,
              provider: result.provider,
              warning: warnings.length > 0 ? warnings.join(" | ") : null,
            },
          };
        }
      }
      throw new Error(`El copy sigue sin pasar QA tras la correccion: ${repairFeedback?.join("; ")}`);
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
