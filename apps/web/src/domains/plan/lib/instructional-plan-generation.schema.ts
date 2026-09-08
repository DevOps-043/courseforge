import { z } from "zod";

export const InstructionalPlanComponentSchema = z.object({
  type: z
    .enum([
      "DIALOGUE",
      "READING",
      "QUIZ",
      "VIDEO_THEORETICAL",
      "VIDEO_DEMO",
      "VIDEO_GUIDE",
      "EXERCISE",
      "DEMO_GUIDE",
    ])
    .describe(
      "El tipo exacto de componente. Usa VIDEO_THEORETICAL para conceptos abstractos, VIDEO_DEMO para ejemplos reales y VIDEO_GUIDE para tutoriales paso a paso.",
    ),
  summary: z
    .string()
    .describe(
      "Descripcion detallada del componente en dos o tres oraciones y justificacion del formato elegido.",
    ),
});

export const InstructionalPlanBlockerSchema = z.object({
  code: z.string(),
  lesson_id: z.string().nullable(),
  lesson_title: z.string().nullable(),
  requested_duration_seconds: z.number().nullable(),
  missing_elements: z.array(z.string()),
  reason: z.string(),
  required_information: z.string(),
});

export const InstructionalPlanLessonSchema = z.object({
  lesson_id: z.string(),
  lesson_title: z.string(),
  lesson_order: z.number(),
  module_id: z.string(),
  module_title: z.string(),
  module_index: z.number(),
  oa_text: z.string().describe("Objetivo de aprendizaje especifico"),
  oa_bloom_verb: z.string().nullable(),
  measurable_criteria: z.string().nullable(),
  course_type_detected: z.string().nullable(),
  components: z.array(InstructionalPlanComponentSchema),
  alignment_notes: z.string().nullable(),
});

export const GeneratedInstructionalPlanSchema = z.object({
  lesson_plans: z.array(InstructionalPlanLessonSchema),
  blockers: z.array(InstructionalPlanBlockerSchema),
});

export type GeneratedInstructionalPlanBlocker = z.infer<
  typeof InstructionalPlanBlockerSchema
>;
export type GeneratedInstructionalPlanLesson = z.infer<
  typeof InstructionalPlanLessonSchema
>;
