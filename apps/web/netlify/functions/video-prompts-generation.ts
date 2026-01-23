import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const VIDEO_PROMPT_SYSTEM = `
Eres un experto Director de Fotografía y Prompt Engineer para herramientas de generación de video con IA (como Flow, Runway Gen-3, Sora, VEO).
Tu tarea es tomar descripciones visuales de un Storyboard educativo y convertirlas en PROMPTS TÉCNICOS optimizados para generar videos de alta calidad (B-roll).

Para cada escena, genera un prompt que incluya:
- Sujeto/Acción principal (claro y directo)
- Estilo visual (ej. Cinematic, Photorealistic, 4k, Soft lighting)
- Movimiento de cámara (ej. Slow pan, Static, Drone shot)
- Ambiente/Atmósfera (ej. Corporate, Educational, Warm, Bright)

FORMATO DE SALIDA:
Devuelve un JSON con la siguiente estructura:
{
  "prompts": [
    {
      "scene_index": number,
      "original_description": string,
      "generated_prompt": string
    }
  ]
}
`;

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    let body;
    try {
        body = JSON.parse(event.body || '{}');
    } catch {
        return { statusCode: 400, body: 'Bad Request: Invalid JSON' };
    }

    const { componentId, storyboard, userToken } = body;

    if (!componentId || !storyboard) {
        return { statusCode: 400, body: 'Missing required fields' };
    }

    const supabase = createClient(supabaseUrl, supabaseKey);
    const genAI = new GoogleGenAI({
        apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY || '',
    });

    try {
        console.log(`[Video Prompts] Generating for component: ${componentId}`);

        // 1. Prepare Input for Gemini
        const inputContext = JSON.stringify(storyboard, null, 2);
        const fullPrompt = `${VIDEO_PROMPT_SYSTEM}\n\nSTORYBOARD INPUT:\n${inputContext}`;

        // 2. Call Gemini
        const model = 'gemini-2.0-flash'; // Fast and capable enough for prompts
        const response = await genAI.models.generateContent({
            model: model,
            contents: fullPrompt,
            config: {
                temperature: 0.7,
                responseModalities: ['TEXT'],
            },
        });

        const responseText = response.text || '';
        const jsonMatch = responseText.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
            throw new Error('No valid JSON in response');
        }

        const result = JSON.parse(jsonMatch[0]);

        // 3. Update Component Assets
        // Fetch existing assets first
        const { data: component } = await supabase
            .from('material_components')
            .select('assets')
            .eq('id', componentId)
            .single();

        const currentAssets = component?.assets || {};

        // Format prompts as a readable string for the text area
        const promptsText = result.prompts.map((p: any) =>
            `[Escena ${p.scene_index}] ${p.generated_prompt}`
        ).join('\n\n');

        const newAssets = {
            ...currentAssets,
            b_roll_prompts: promptsText
        };

        const { error: updateError } = await supabase
            .from('material_components')
            .update({ assets: newAssets })
            .eq('id', componentId);

        if (updateError) throw updateError;

        console.log(`[Video Prompts] Assets updated for ${componentId}`);

        return {
            statusCode: 200,
            body: JSON.stringify({ success: true, prompts: promptsText }),
        };

    } catch (error: any) {
        console.error('[Video Prompts] Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ success: false, error: error.message }),
        };
    }
};
