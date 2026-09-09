import { z } from "zod";

export const ArtifactBaseGenerationSchema = z.object({
  nombres: z
    .array(z.string())
    .length(3)
    .describe("3 opciones de nombres creativos y comerciales para el curso"),
  objetivos: z
    .array(z.string())
    .min(3)
    .max(6)
    .describe(
      "Entre 3 y 6 objetivos de aprendizaje generales iniciando con verbos de la Taxonomía de Bloom",
    ),
  descripcion: z.object({
    texto: z.string().describe("Descripción general del curso"),
    publico_objetivo: z
      .string()
      .describe("Perfil detallado del estudiante ideal"),
    beneficios: z.string().describe("Resultados transformacionales clave"),
    diferenciador: z
      .string()
      .describe("Por qué este curso es único comparado con otros"),
    resumen: z
      .string()
      .nullable()
      .describe("Resumen breve del curso; usa null si no aplica"),
  }),
});

export type GeneratedArtifactBase = z.infer<
  typeof ArtifactBaseGenerationSchema
>;
