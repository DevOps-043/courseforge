import { z } from "zod";

const objectiveSchema = z.string().trim().min(1).max(1_000);

export const syllabusGenerationRequestSchema = z.object({
  artifactId: z.string().uuid(),
  ideaCentral: z.string().trim().min(1).max(20_000),
  iterationInstructions: z.string().trim().min(1).max(10_000).optional(),
  objetivos: z.array(objectiveSchema).min(1).max(20),
  route: z.enum(["A_WITH_SOURCE", "B_NO_SOURCE"]),
}).strict();

export const syllabusGenerationBackgroundRequestSchema =
  syllabusGenerationRequestSchema.extend({
    iterationNumber: z.number().int().min(1).optional(),
  });

export type SyllabusGenerationRequest = z.infer<
  typeof syllabusGenerationRequestSchema
>;

