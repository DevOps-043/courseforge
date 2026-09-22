import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import {
  fetchWithDeadline,
  readJsonResponseWithLimit,
  readResponseTextWithLimit,
} from "../../../../lib/server/outbound-http";
import { getOptionalGeminiApiKey, getOptionalOpenAIApiKey } from "../../../../lib/server/env";
import { buildSourceInsights, type SlideSourcePack } from "../content/slide-source-pack.service";
import { validateCourseDeckVisibleCopy } from "../validation/course-deck-qa.service";
import {
  copyBudgetForSlideType,
  limitSlideCopy,
  normalizedVisibleText,
} from "../content/slide-copy-policy.service";
import type { CourseDeckSpec } from "../specs/course-deck.schema";
import type {
  SlideAgentModelSettingRecord,
  SlideAgentPromptRecord,
} from "./slide-agent-prompt-codes";

const SYNTHESIS_TIMEOUT_MS = 60_000;
const SYNTHESIS_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;
const SYNTHESIS_ERROR_MAX_BYTES = 32 * 1024;
const SYNTHESIS_BATCH_SIZE = 4;
const SYNTHESIS_TOTAL_BUDGET_MS = 7 * 60_000;

const synthesisResponseSchema = z.object({
  slides: z.array(z.unknown()).max(24),
});

type SynthesisProvider = "gemini" | "openai" | "deterministic_fallback";

export interface VisibleCopySlideAudit {
  slideId: string;
  sourceRefs: string[];
  /** References assigned in planning, not proof of claims used by the model. */
  sourceReferenceKind?: "PLANNED";
  status?: "GENERATED" | "VALIDATED_FALLBACK" | "REJECTED";
  findingCodes?: string[];
}

export interface VisibleCopySynthesisBatchAudit {
  applied: boolean;
  attempts: number;
  batchNumber: number;
  model: string;
  provider: SynthesisProvider;
  slides: VisibleCopySlideAudit[];
  warning: string | null;
}

export interface VisibleCopySynthesisTrace {
  appliedSlideCount: number;
  batches: VisibleCopySynthesisBatchAudit[];
  model: string;
  provider: SynthesisProvider;
  warning: string | null;
}

interface SynthesizeVisibleCopyParams {
  deckSpec: CourseDeckSpec;
  acceptedSlides?: CourseDeckSpec["slides"];
  deadlineAt?: number;
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

function sourceEvidenceForPrompt(params: SynthesizeVisibleCopyParams) {
  const insights = params.sourcePack?.insights?.length
    ? params.sourcePack.insights : buildSourceInsights(params.sourcePack?.items || []);
  // Retrieve per slide before applying the request budget, so later evidence is
  // not silently excluded from every batch.
  const selected = new Set<typeof insights[number]>();
  for (const slide of params.deckSpec.slides) {
    const tokens = new Set(normalizedVisibleText(slideVisibleText(slide) + " " + (slide.speakerNotes || "")).split(" ").filter((token) => token.length > 3));
    const score = (insight: typeof insights[number]) => {
      const words = new Set(normalizedVisibleText(insight.title + " " + insight.bodyItems.join(" ")).split(" "));
      return [...tokens].filter((token) => words.has(token)).length
        + Number(slide.validationHints.sourceRefs.includes(insight.sourceRef));
    };
    [...insights].sort((a, b) => score(b) - score(a)).slice(0, 3).forEach((insight) => selected.add(insight));
  }
  return [...selected].map((insight) => ({
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
- Para cada slide de contenido: titulo maximo 58 caracteres; desarrolla 2 o 3 bullets concretos de hasta 68 caracteres cada uno, al menos 60 caracteres de explicacion en total. Explica como, por que, un criterio o una consecuencia; no entregues solo etiquetas ni reformules el titulo. Portadas y transiciones: un solo mensaje breve. Graficas: explica su lectura.
- Usa solo claims respaldados por la evidencia proporcionada. No inventes cifras, ejemplos ni recomendaciones.
- No menciones guion, storyboard, B-roll, avatar, timecode ni instrucciones de produccion.
- El borrador puede contener texto de plantilla como "Idea 18", "Texto de resumen claro" o "Mensaje final motivador": sustituyelo por contenido educativo, nunca lo conserves.
- Desarrolla la idea usando la evidencia curada y el contexto pedagogico de sectionNarrative. Si ambos son insuficientes, omite esa slide de la respuesta para reportarla como incompleta; nunca inventes contenido para cumplir una cuota.
- Devuelve una entrada por cada id de slide proporcionado.
- Cada diapositiva debe desarrollar una idea distinta de su seccion. No repitas titulo y bullets entre slides ni cambies solo el numero para ocultar duplicados.
- sectionNarrative es contexto pedagogico de esa seccion: sintetiza su idea sin transcribirlo ni mostrar instrucciones de produccion.
- Cada elemento de slides debe usar exactamente id, title, subtitle opcional y bullets. No anides esos campos ni uses heading, points o content.
${params.repairFeedback?.length ? `CORRECCIONES OBLIGATORIAS DEL INTENTO ANTERIOR:\n${JSON.stringify(params.repairFeedback)}` : ""}

EVIDENCIA CURADA:
${JSON.stringify(sourceEvidenceForPrompt(params))}

SLIDES YA APROBADAS (no las devuelvas ni repitas sus ideas):
${JSON.stringify((params.acceptedSlides || []).map((slide) => ({ id: slide.id, copy: slideVisibleText(slide) })))}

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
      return {
        ...slide,
        bodyBlocks: [{
          items: bullets,
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
async function synthesizeDeckVisibleCopyBatch(params: SynthesizeVisibleCopyParams): Promise<{
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
  let attemptCount = 0;
  const accepted = new Map<string, CourseDeckSpec["slides"][number]>();
  let repairFeedback: string[] | undefined;

  for (const provider of configuredProviders) {
    try {
      const apiKey = provider === "gemini" ? geminiKey : openAiKey;
      if (!apiKey) continue;
      // One bounded repair per provider, using the same rules as final QA.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (params.deadlineAt && Date.now() + SYNTHESIS_TIMEOUT_MS > params.deadlineAt) {
          warnings.push("synthesis_deadline_exceeded");
          break;
        }
        attemptCount += 1;
        const pending = params.deckSpec.slides.filter((slide) => !accepted.has(slide.id));
        const request = { ...params, repairFeedback,
          acceptedSlides: [...(params.acceptedSlides || []), ...accepted.values()],
          deckSpec: { ...params.deckSpec, slides: pending },
        };
        let deckSpec: CourseDeckSpec | undefined;
        let result: Awaited<ReturnType<typeof synthesizeWithOpenAI>> | Awaited<ReturnType<typeof synthesizeWithGemini>> | undefined;
        try {
          result = provider === "gemini"
            ? await synthesizeWithGemini(request, apiKey)
            : await synthesizeWithOpenAI(request, apiKey);
          const rawSlides = synthesisResponseSchema.parse(result.response).slides;
          const responseIds = rawSlides.map((value) => {
            const raw = asRecord(value);
            const candidate = Object.keys(asRecord(raw.slide)).length ? asRecord(raw.slide)
              : Object.keys(asRecord(raw.content)).length ? asRecord(raw.content) : raw;
            return compactText(candidate.id);
          });
          if (new Set(responseIds).size !== responseIds.length || responseIds.some((id) => !pending.some((slide) => slide.id === id))) {
            throw new Error("invalid_slide_ids");
          }
          const invalidIds: string[] = [];
          const proposed: CourseDeckSpec = { ...request.deckSpec, slides: pending.flatMap((slide) => {
            const responseIndex = responseIds.indexOf(slide.id);
            try {
              if (responseIndex < 0) throw new Error("missing_slide");
              return normalizeSynthesis({ deckSpec: { ...request.deckSpec, slides: [slide] }, response: { slides: [rawSlides[responseIndex]] } }).slides;
            } catch {
              invalidIds.push(slide.id);
              return [];
            }
          }) };
          const findings = validateCourseDeckVisibleCopy({ ...params.deckSpec,
            slides: [...request.acceptedSlides, ...proposed.slides],
          }).filter((finding) => finding.severity === "error");
          for (const slide of proposed.slides) {
            if (!findings.some((finding) => !finding.slideId || finding.slideId === slide.id)) accepted.set(slide.id, slide);
          }
          repairFeedback = [
            ...findings.map((finding) => `${finding.slideId || "deck"}: ${finding.code}: ${finding.message}`),
            ...invalidIds.map((id) => `${id}: missing_or_invalid_slide: completa todos los campos solicitados.`),
          ];
          deckSpec = { ...params.deckSpec, slides: params.deckSpec.slides.map((slide) => accepted.get(slide.id) || slide) };
        } catch (error) {
          // Do not persist provider response bodies, which can include private data.
          repairFeedback = [error instanceof SyntaxError ? "invalid_json: devuelve JSON completo." : "provider_or_contract_error: respuesta no disponible o contrato invalido."];
          warnings.push(`${provider}: ${repairFeedback[0]}`);
        }
        if (deckSpec && result && accepted.size === params.deckSpec.slides.length && repairFeedback.length === 0) {
          return {
            deckSpec,
            trace: {
              appliedSlideCount: deckSpec.slides.length,
              batches: [{
                applied: true,
                attempts: attemptCount,
                batchNumber: 1,
                model: result.model,
                provider: result.provider,
                slides: slideAuditEntries(deckSpec).map((slide) => ({ ...slide, status: "GENERATED", findingCodes: [] })),
                warning: warnings.length > 0 ? warnings.join(" | ") : null,
              }],
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

  const fallbackDeck = { ...params.deckSpec, slides: params.deckSpec.slides.map((slide) => accepted.get(slide.id) || slide) };
  const fallbackErrors = validateCourseDeckVisibleCopy({ ...fallbackDeck,
    slides: [...(params.acceptedSlides || []), ...fallbackDeck.slides],
  }).filter((finding) => finding.severity === "error");
  if (fallbackErrors.length) warnings.push(`fallback_rejected: ${fallbackErrors.map((finding) => `${finding.slideId}:${finding.code}`).join(", ")}`);

  return {
    deckSpec: fallbackDeck,
    trace: {
      appliedSlideCount: accepted.size,
      batches: [{
        applied: false,
        attempts: attemptCount,
        batchNumber: 1,
        model: "soflia-engine-deterministic-fallback",
        provider: "deterministic_fallback",
        slides: slideAuditEntries(fallbackDeck).map((slide) => ({ ...slide,
          status: fallbackErrors.some((finding) => !finding.slideId || finding.slideId === slide.slideId)
            ? "REJECTED" : accepted.has(slide.slideId) ? "GENERATED" : "VALIDATED_FALLBACK",
          findingCodes: fallbackErrors.filter((finding) => !finding.slideId || finding.slideId === slide.slideId).map((finding) => finding.code),
        })),
        warning: warnings.length > 0 ? warnings.join(" | ") : "No hay proveedor de IA configurado para sintetizar copy visible.",
      }],
      model: "soflia-engine-deterministic-fallback",
      provider: "deterministic_fallback",
      warning: warnings.length > 0 ? warnings.join(" | ") : "No hay proveedor de IA configurado para sintetizar copy visible.",
    },
  };
}

function slideAuditEntries(deckSpec: CourseDeckSpec): VisibleCopySlideAudit[] {
  return deckSpec.slides.map((slide) => ({
    slideId: slide.id,
    sourceRefs: slide.validationHints.sourceRefs,
    sourceReferenceKind: "PLANNED",
  }));
}

/**
 * Keeps each model request bounded. A failed or malformed response can only
 * affect its own batch, and the caller still runs the global quality gate over
 * the assembled deck before any HTML is published.
 */
export async function synthesizeDeckVisibleCopy(params: SynthesizeVisibleCopyParams): Promise<{
  deckSpec: CourseDeckSpec;
  trace: VisibleCopySynthesisTrace;
}> {
  // Reserve worker time for visual assets and persistence after copy generation.
  if (new Set(params.deckSpec.slides.map((slide) => slide.id)).size !== params.deckSpec.slides.length) {
    throw new Error("duplicate_slide_id: no se puede sintetizar un deck con identificadores repetidos.");
  }
  params = { ...params, deadlineAt: params.deadlineAt ?? Date.now() + SYNTHESIS_TOTAL_BUDGET_MS };
  if (params.deckSpec.slides.length <= SYNTHESIS_BATCH_SIZE) {
    return synthesizeDeckVisibleCopyBatch(params);
  }

  const batches: CourseDeckSpec["slides"][] = [];
  for (let index = 0; index < params.deckSpec.slides.length; index += SYNTHESIS_BATCH_SIZE) {
    batches.push(params.deckSpec.slides.slice(index, index + SYNTHESIS_BATCH_SIZE));
  }

  const results: Array<Awaited<ReturnType<typeof synthesizeDeckVisibleCopyBatch>>> = [];
  for (const slides of batches) {
    results.push(await synthesizeDeckVisibleCopyBatch({
      ...params,
      deckSpec: { ...params.deckSpec, slides },
      acceptedSlides: results.flatMap((result) => result.deckSpec.slides)
        .filter((slide) => !validateCourseDeckVisibleCopy({ ...params.deckSpec, slides: [slide] }).some((finding) => finding.severity === "error")),
    }));
  }

  const traces = results.map((result) => result.trace);
  const batchAudits = traces.flatMap((trace, resultIndex) =>
    trace.batches.map((batch) => ({ ...batch, batchNumber: resultIndex + 1 })),
  );
  const warnings = traces.flatMap((trace, index) =>
    trace.warning ? [`lote ${index + 1}: ${trace.warning}`] : [],
  );
  const usesFallback = traces.some((trace) => trace.provider === "deterministic_fallback");

  return {
    deckSpec: {
      ...params.deckSpec,
      slides: results.flatMap((result) => result.deckSpec.slides),
    },
    trace: {
      appliedSlideCount: traces.reduce((total, trace) => total + trace.appliedSlideCount, 0),
      batches: batchAudits,
      model: usesFallback ? "batched-visible-copy-with-fallback" : traces.map((trace) => trace.model).join(","),
      provider: usesFallback ? "deterministic_fallback" : traces[0]?.provider || "deterministic_fallback",
      warning: warnings.length > 0 ? warnings.join(" | ") : null,
    },
  };
}
