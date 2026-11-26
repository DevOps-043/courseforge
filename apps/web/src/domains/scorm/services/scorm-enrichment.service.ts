import OpenAI from "openai";
import { z } from "zod";
import { getOptionalOpenAIApiKey } from "@/lib/server/env";
import { COURSE_TEXT_MODELS, withTextModelFallback } from "../../../shared/ai/text-model-provider";

const enrichmentSchema = z.object({
  objectives: z.array(z.string()),
  targetAudience: z.string(),
  level: z.enum(["beginner", "intermediate", "advanced"]),
  description: z.string(),
  suggestedTitle: z.string().optional(),
});

export interface EnrichmentResult {
  objectives: string[];
  targetAudience: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  suggestedTitle?: string;
}

export class ScormEnrichmentService {
  async enrichCourseMetadata(
    courseTitle: string,
    modulesTitles: string[],
    rawManifestSummary: string
  ): Promise<EnrichmentResult> {

    const apiKey = getOptionalOpenAIApiKey();
    if (!apiKey) {
      return {
        objectives: ['Comprender los conceptos básicos', 'Aplicar conocimientos'],
        targetAudience: 'General',
        level: 'beginner',
        description: `Curso importado: ${courseTitle}`,
        suggestedTitle: courseTitle
      };
    }

    const prompt = `
    Analiza la estructura de este curso SCORM:
    
    Título: "${courseTitle}"
    Módulos: ${modulesTitles.join(', ')}
    Resumen: ${rawManifestSummary.slice(0, 1000)}
    
    Genera JSON:
    {
      "objectives": ["obj1", "obj2", "obj3", "obj4", "obj5"],
      "targetAudience": "string",
      "level": "beginner" | "intermediate" | "advanced",
      "description": "string (max 100 words)",
      "suggestedTitle": "string"
    }
    `;

    const client = new OpenAI({ apiKey, timeout: 45_000, maxRetries: 0 });
    return withTextModelFallback(COURSE_TEXT_MODELS.model, COURSE_TEXT_MODELS.fallbackModel, async model => {
      const response = await client.responses.create({
        model, input: prompt, store: false,
        max_output_tokens: 2000, text: { format: { type: "json_object" } },
      });
      return enrichmentSchema.parse(JSON.parse(response.output_text));
    });
  }
}
