import { z } from "zod";

const syllabusLessonSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    title: z
      .string()
      .trim()
      .min(1, "Escribe el título de la lección.")
      .max(500),
    objective_specific: z
      .string()
      .trim()
      .min(1, "Completa el objetivo específico de la lección.")
      .max(2_000),
    estimated_minutes: z
      .number({ error: "Escribe una duración válida en minutos." })
      .int()
      .min(1)
      .max(720)
      .optional(),
  })
  .strict();

const syllabusModuleSchema = z
  .object({
    id: z.string().trim().min(1).max(100).optional(),
    objective_general_ref: z
      .string()
      .trim()
      .min(1, "Completa el objetivo general del módulo.")
      .max(2_000),
    title: z.string().trim().min(1, "Escribe el título del módulo.").max(500),
    lessons: z.array(syllabusLessonSchema).min(1).max(20),
  })
  .strict();

export const syllabusModulesSchema = z
  .array(syllabusModuleSchema)
  .min(1, "El temario debe conservar al menos un módulo.")
  .max(20);

const syllabusStateSchema = z.enum([
  "STEP_DRAFT",
  "STEP_GENERATING",
  "STEP_VALIDATING",
  "STEP_REVIEW",
  "STEP_READY_FOR_QA",
  "STEP_APPROVED",
  "STEP_REJECTED",
  "STEP_ESCALATED",
]);

export const syllabusManagementRequestSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("status"),
      artifactId: z.string().uuid(),
      notes: z.string().trim().max(10_000).optional(),
      state: syllabusStateSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("modules"),
      artifactId: z.string().uuid(),
      modules: syllabusModulesSchema,
    })
    .strict(),
]);
