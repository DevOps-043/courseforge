import { z } from "zod";

export const brollPromptItemSchema = z.object({
  generated_prompt: z.string().trim().min(1),
  original_description: z.string().trim().min(1),
  scene_index: z.number().int().min(0),
});

export const brollPromptResponseSchema = z.object({
  prompts: z.array(brollPromptItemSchema).min(1),
});

export type BrollPromptItem = z.infer<typeof brollPromptItemSchema>;
export type BrollPromptResponse = z.infer<typeof brollPromptResponseSchema>;

export function parseBrollPromptResponse(rawJson: unknown): BrollPromptResponse {
  return brollPromptResponseSchema.parse(rawJson);
}

export function formatBrollPromptsForAssets(items: BrollPromptItem[]) {
  return items
    .map(
      (promptItem) =>
        `[Escena ${promptItem.scene_index}] ${promptItem.generated_prompt}`,
    )
    .join("\n\n");
}
