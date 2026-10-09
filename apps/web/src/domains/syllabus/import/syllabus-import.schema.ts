import { z } from "zod";

export const SYLLABUS_IMPORT_POLICY = {
  maxModules: 20,
  maxLessonsPerModule: 20,
  maxTotalLessons: 200,
  maxTopicsPerLesson: 20,
  leaseMinutes: 10,
  maxAttempts: 3,
  maxStoredDocuments: 50,
  maxDailyImports: 10,
  modelRequestTimeoutMs: 90_000,
} as const;

export const syllabusInputModeSchema = z.enum([
  "IDEA",
  "DOCUMENT_BASED",
  "PROVIDED_SYLLABUS",
]);
export type SyllabusInputMode = z.infer<typeof syllabusInputModeSchema>;
export function resolveSyllabusInputMode(
  mode?: SyllabusInputMode | null,
  route?: string | null,
): SyllabusInputMode {
  return mode ?? (route === "A_WITH_SOURCE" ? "DOCUMENT_BASED" : "IDEA");
}

const title = z.string().trim().min(1).max(500);
const objective = z.string().trim().max(2_000);
const topics = z
  .array(z.string().trim().min(1).max(1_000))
  .max(SYLLABUS_IMPORT_POLICY.maxTopicsPerLesson);
const sourceQuote = z.string().trim().max(4_000);
export const importLessonSchema = z
  .object({
    id: z.string().uuid(),
    title,
    objective_specific: objective,
    topics,
    sourceQuote,
  })
  .strict();
export const importModuleSchema = z
  .object({
    id: z.string().uuid(),
    title,
    objective_general_ref: objective,
    sourceQuote,
    lessons: z
      .array(importLessonSchema)
      .max(SYLLABUS_IMPORT_POLICY.maxLessonsPerModule),
  })
  .strict();
export const importOutlineSchema = z
  .array(importModuleSchema)
  .max(SYLLABUS_IMPORT_POLICY.maxModules)
  .superRefine((modules, context) => {
    const ids = modules.flatMap((module) => [
      module.id,
      ...module.lessons.map((lesson) => lesson.id),
    ]);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: "custom",
        message: "Los identificadores deben ser únicos.",
      });
    if (
      modules.reduce((count, module) => count + module.lessons.length, 0) >
      SYLLABUS_IMPORT_POLICY.maxTotalLessons
    ) {
      context.addIssue({
        code: "custom",
        message: "El temario excede el límite operativo de lecciones.",
      });
    }
  });
export type ImportOutline = z.infer<typeof importOutlineSchema>;

// The model never owns pipeline IDs. Server assigns them after validating extraction.
export const extractedOutlineSchema = z
  .object({
    modules: z
      .array(
        importModuleSchema.omit({ id: true }).extend({
          lessons: z
            .array(importLessonSchema.omit({ id: true }))
            .max(SYLLABUS_IMPORT_POLICY.maxLessonsPerModule),
        }),
      )
      .max(SYLLABUS_IMPORT_POLICY.maxModules),
    issues: z.array(z.string().trim().min(1).max(2_000)).max(50),
    unassignedTopics: z.array(z.string().trim().min(1).max(2_000)).max(100),
  })
  .strict();

export const enrichmentSchema = z
  .object({
    modules: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            objective_general_ref: objective.min(1),
          })
          .strict(),
      )
      .max(20),
    lessons: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            objective_specific: objective.min(1),
          })
          .strict(),
      )
      .max(200),
  })
  .strict();
export type Enrichment = z.infer<typeof enrichmentSchema>;

export const expansionSchema = z
  .object({
    proposals: z
      .array(
        z
          .object({
            moduleId: z.string().uuid(),
            afterLessonId: z.string().uuid().nullable(),
            title,
            objective_specific: objective.min(1),
            topics,
            reason: z.string().trim().min(1).max(2_000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();
export type ExpansionProposal = z.infer<
  typeof expansionSchema
>["proposals"][number] & { id: string };

export const importCommandSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("start"),
      artifactId: z.string().uuid(),
      primaryDocumentId: z.string().uuid(),
      supportDocumentIds: z.array(z.string().uuid()).max(7),
      idempotencyKey: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      action: z.literal("revise"),
      artifactId: z.string().uuid(),
      importId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      outline: importOutlineSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("confirm"),
      artifactId: z.string().uuid(),
      importId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      acknowledgeIssues: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("enrich"),
      artifactId: z.string().uuid(),
      importId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("propose"),
      artifactId: z.string().uuid(),
      importId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      action: z.literal("decide"),
      artifactId: z.string().uuid(),
      importId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
      acceptedIds: z.array(z.string().uuid()).max(20),
    })
    .strict(),
  z
    .object({
      action: z.literal("retry"),
      artifactId: z.string().uuid(),
      importId: z.string().uuid(),
      expectedRevision: z.number().int().positive(),
    })
    .strict(),
]);
export type ImportCommand = z.infer<typeof importCommandSchema>;
export interface SyllabusImportRecord {
  id: string;
  artifact_id: string;
  primary_document_id: string;
  support_document_ids: string[];
  status: "PARSING" | "REVIEW_REQUIRED" | "CONFIRMED" | "ENRICHING" | "FAILED";
  revision: number;
  candidate_outline: ImportOutline;
  extracted_outline: ImportOutline | null;
  confirmed_outline: ImportOutline | null;
  confirmed_revision: number | null;
  issues: string[];
  unassigned_topics: string[];
  proposals: ExpansionProposal[];
  operation: "parse" | "enrich" | "propose" | null;
  lease_expires_at: string | null;
  attempt_count: number;
  error_message: string | null;
  source_syllabus_version: number;
}
