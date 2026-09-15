import { z } from "zod";
import { syllabusSourceDocumentsSchema } from "./syllabus-source-documents";

const objectiveSchema = z.string().trim().min(1).max(1_000);

export const syllabusGenerationRequestSchema = z.object({
  artifactId: z.string().uuid(),
  ideaCentral: z.string().trim().min(1).max(20_000),
  iterationInstructions: z.string().trim().min(1).max(10_000).optional(),
  promptOverride: z.string().trim().min(1).max(40_000).optional(),
  objetivos: z.array(objectiveSchema).min(1).max(20),
  route: z.enum(["A_WITH_SOURCE", "B_NO_SOURCE"]),
  sourceDocuments: syllabusSourceDocumentsSchema.optional(),
}).strict().superRefine((request, context) => {
  if (request.route === "A_WITH_SOURCE" && !request.sourceDocuments?.length) {
    context.addIssue({
      code: "custom",
      message: "La generación basada en documentos requiere al menos un documento fuente.",
      path: ["sourceDocuments"],
    });
  }
});

export const syllabusGenerationBackgroundRequestSchema =
  syllabusGenerationRequestSchema.safeExtend({
    iterationNumber: z.number().int().min(1).optional(),
  });

export type SyllabusGenerationRequest = z.infer<
  typeof syllabusGenerationRequestSchema
>;
