import { GoogleGenAI } from '@google/genai';

export interface EnrichmentResult {
  objectives: string[];
  targetAudience: string;
  level: 'beginner' | 'intermediate' | 'advanced';
  description: string;
  suggestedTitle?: string;
}

export class ScormEnrichmentService {
  private genAI: GoogleGenAI;

  constructor() {
    this.genAI = new GoogleGenAI({ apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || '' });
  }

  async enrichCourseMetadata(
    courseTitle: string,
    modulesTitles: string[],
    rawManifestSummary: string
  ): Promise<EnrichmentResult> {

    if (!process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
      return {
        objectives: ['Comprender los conceptos básicos', 'Aplicar conocimientos'],
        targetAudience: 'General',
        level: 'beginner',
        description: `Curso importado: ${courseTitle}`,
        suggestedTitle: courseTitle
      };
    }

    const modelArg = { model: 'gemini-2.0-flash' };

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

    try {
      const result = await this.genAI.models.generateContent({
        model: 'gemini-2.0-flash',
        contents: prompt
      });
      
      const text = result.text || '';
      const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
      return JSON.parse(jsonStr);

    } catch (error) {
      console.error('Enrichment error:', error);
      throw error;
    }
  }
}
