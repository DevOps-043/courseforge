import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getGeminiApiKey,
  getOptionalOpenAIApiKey,
} from "../../../lib/server/env";
import { getPipelineModelSettings } from "../../../lib/server/model-settings";
import { createOperationalLogger } from "../../../lib/server/operational-logger";
import { getTextModelProvider } from "../../../shared/ai/text-model-provider";
import {
  generateSyllabusJson,
  type SyllabusModelClients,
} from "../lib/syllabus-model-provider";
import { applyGeneratedLessonDurationEstimates } from "../lib/lesson-duration-estimator";
import { resolveArtifactVideoDurationPolicy } from "../../video-duration/video-duration-policy";
import { validateSyllabusForMode } from "../validators/syllabus-validation-policy";
import {
  acceptExpansions,
  applyEnrichment,
  verifyExtractedOutline,
} from "./syllabus-fidelity";
import {
  buildEnrichmentPrompt,
  buildExpansionPrompt,
  buildImportPrompt,
} from "./syllabus-import.prompts";
import {
  extractedOutlineSchema,
  enrichmentSchema,
  expansionSchema,
  importOutlineSchema,
  SYLLABUS_IMPORT_POLICY,
} from "./syllabus-import.schema";
import { SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS } from "../syllabus-source-documents";
import {
  SyllabusImportRepository,
  SyllabusImportError,
} from "./syllabus-import.repository";

function parseModelJson(text: string): unknown {
  return JSON.parse(
    text
      .replace(/^\s*```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim(),
  );
}

/** Local and signed background execution share all mutation and fidelity rules. */
export async function executeSyllabusImport(
  admin: SupabaseClient,
  artifactId: string,
  importId: string,
  revision: number,
) {
  const repository = new SyllabusImportRepository(admin, artifactId);
  const entry = await repository.get(importId);
  if (
    !entry ||
    entry.revision !== revision ||
    !entry.lease_expires_at ||
    !entry.operation
  )
    return;
  const logger = createOperationalLogger("syllabus.import", {
    artifactId,
    importId,
    revision,
  });
  try {
    const { data: artifact, error } = await admin
      .from("artifacts")
      .select("organization_id,objetivos,generation_metadata")
      .eq("id", artifactId)
      .single();
    if (error) throw error;
    let usedModelName = "deterministic";
    const generate = async (prompt: string) => {
      const settings = await getPipelineModelSettings(
        "SYLLABUS",
        artifact.organization_id,
      );
      usedModelName = settings.model_name;
      const clients: SyllabusModelClients = {};
      const provider = getTextModelProvider(settings.model_name);
      if (provider === "gemini")
        clients.gemini = new GoogleGenAI({
          apiKey: getGeminiApiKey(),
          httpOptions: {
            timeout: SYLLABUS_IMPORT_POLICY.modelRequestTimeoutMs,
          },
        });
      if (provider === "openai") {
        const apiKey = getOptionalOpenAIApiKey();
        if (!apiKey) throw new Error("Missing model configuration");
        clients.openai = new OpenAI({
          apiKey,
          timeout: SYLLABUS_IMPORT_POLICY.modelRequestTimeoutMs,
          maxRetries: 0,
        });
      }
      return parseModelJson(
        await generateSyllabusJson({
          clients,
          model: settings.model_name,
          temperature: 0.1,
          prompt,
          telemetry: {
            supabase: admin,
            context: {
              artifactId,
              organizationId: artifact.organization_id,
              pipelineStep: "SYLLABUS",
              operation: `syllabus_import_${entry.operation}`,
              attempt: entry.attempt_count,
            },
          },
        }),
      );
    };
    if (entry.operation === "parse") {
      const [primary] = await repository.documents([entry.primary_document_id]);
      const parsed = extractedOutlineSchema.parse(
        await generate(buildImportPrompt(primary.extracted_text)),
      );
      const outline = importOutlineSchema.parse(
        parsed.modules.map((module) => ({
          ...module,
          id: crypto.randomUUID(),
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            id: crypto.randomUUID(),
          })),
        })),
      );
      await repository.transition(entry, "parsed", {
        outline,
        issues: [
          ...parsed.issues,
          ...verifyExtractedOutline(outline, primary.extracted_text),
        ].slice(0, 50),
        unassignedTopics: parsed.unassignedTopics,
      });
    } else if (entry.operation === "propose") {
      const outline = importOutlineSchema.parse(entry.confirmed_outline);
      const suggestions = expansionSchema.parse(
        await generate(buildExpansionPrompt(outline)),
      );
      const proposals = suggestions.proposals.map((proposal) => ({
        ...proposal,
        id: crypto.randomUUID(),
      }));
      // Validate every proposed anchor before displaying it for a decision.
      for (const proposal of proposals)
        acceptExpansions(outline, [proposal], [proposal.id]);
      await repository.transition(entry, "proposed", { proposals });
    } else {
      const outline = importOutlineSchema.parse(entry.confirmed_outline);
      const needsEnrichment = outline.some(
        (module) =>
          !module.objective_general_ref ||
          module.lessons.some((lesson) => !lesson.objective_specific),
      );
      const support =
        needsEnrichment && entry.support_document_ids.length
          ? await repository.documents(entry.support_document_ids)
          : [];
      // Support text is bounded once per enrichment, never repeated per lesson.
      const supportText = support
        .map((document) => document.extracted_text)
        .join("\n\n");
      if (supportText.length > SYLLABUS_SOURCE_DOCUMENT_MAX_TOTAL_CHARACTERS)
        throw new Error("Support text too large");
      const patches = needsEnrichment
        ? enrichmentSchema.parse(
            await generate(
              buildEnrichmentPrompt(
                outline,
                artifact.objetivos || [],
                supportText,
              ),
            ),
          )
        : { modules: [], lessons: [] };
      const modules = applyGeneratedLessonDurationEstimates(
        applyEnrichment(outline, patches),
        resolveArtifactVideoDurationPolicy(artifact.generation_metadata),
      );
      const validation = validateSyllabusForMode(
        modules,
        artifact.objetivos || [],
        "PROVIDED_SYLLABUS",
        outline,
      );
      const technicalFailures = validation.checks.filter(
        (check) => !check.pass && check.code !== "[V06]",
      );
      if (technicalFailures.length)
        throw new SyllabusImportError(
          technicalFailures.map((check) => check.message).join(" "),
          422,
        );
      await repository.transition(entry, "enriched", {
        modules,
        validation: {
          automatic_pass: validation.passed,
          checks: validation.checks,
        },
        metadata: {
          import_baseline: outline.map((module) => ({
            ...module,
            sourceQuote: "",
            lessons: module.lessons.map((lesson) => ({
              ...lesson,
              sourceQuote: "",
            })),
          })),
          import_id: entry.id,
          import_revision: entry.confirmed_revision,
          generated_at: new Date().toISOString(),
          models_used: {
            architect: usedModelName,
          },
        },
      });
    }
    logger.info("syllabus.import.completed", { operation: entry.operation });
  } catch (error) {
    // Operational logger must not receive document/model response contents.
    logger.warn("syllabus.import.failed", {
      operation: entry.operation,
      errorType: error instanceof Error ? error.name : "unknown",
    });
    try {
      await repository.transition(
        entry,
        "failed",
        error instanceof SyllabusImportError ? { message: error.message } : {},
      );
    } catch {
      /* A newer revision owns recovery. */
    }
    throw error;
  }
}
