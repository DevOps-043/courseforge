import { z } from "zod";
import { parseModelJsonResponse } from "../../../shared/ai/model-json-response";

export const brollPromptItemSchema = z.object({
  generated_prompt: z.string().trim().min(1),
  original_description: z.string().trim().min(1),
  scene_index: z.number().int().min(0),
}).strict();

export const brollPromptResponseSchema = z.object({
  prompts: z.array(brollPromptItemSchema).min(1),
}).strict();

// El prompt editorial puede variar por organización; el contrato de salida no.
export const brollPromptOutputFormat = {
  type: "json_schema" as const,
  name: "broll_prompts",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["prompts"],
    properties: { prompts: { type: "array", minItems: 1, items: {
      type: "object", additionalProperties: false,
      required: ["scene_index", "original_description", "generated_prompt"],
      properties: {
        scene_index: { type: "integer", minimum: 0 },
        original_description: { type: "string", minLength: 1 },
        generated_prompt: { type: "string", minLength: 1 },
      },
    } } },
  },
};

export type BrollPromptItem = z.infer<typeof brollPromptItemSchema>;
export type BrollPromptResponse = z.infer<typeof brollPromptResponseSchema>;

export function parseBrollPromptResponse(rawJson: unknown): BrollPromptResponse {
  return brollPromptResponseSchema.parse(rawJson);
}

export function parseCompletedBrollResponse(response: { status?: string; output_text?: string }) {
  if (response.status !== "completed") throw new Error("BROLL_INCOMPLETE_OUTPUT: El proveedor no completó los prompts; no se guardaron resultados parciales.");
  const parsed = brollPromptResponseSchema.safeParse(parseModelJsonResponse({ responseText: response.output_text }));
  if (!parsed.success) {
    const fields = parsed.error.issues.map(issue => issue.path.join(".") || "respuesta").join(", ");
    throw new Error(`BROLL_INVALID_OUTPUT: La respuesta no cumple el contrato de prompts (${fields}). No se guardaron prompts inválidos.`);
  }
  return parsed.data;
}

export function formatBrollPromptsForAssets(items: BrollPromptItem[]) {
  return items
    .map(
      (promptItem) =>
        `[Escena ${promptItem.scene_index}] ${promptItem.generated_prompt}`,
    )
    .join("\n\n");
}
