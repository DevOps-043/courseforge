import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

// Setup
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const VIDEO_PROMPT_SYSTEM = `
Eres un experto Prompt Engineer para Google VEO (Modelos BO2/BO3) y Director de Fotografía.
Tu tarea es convertir escenas de un storyboard en PROMPTS DE VIDEO perfectos, optimizados para Veo.
IMPORTANTE: Los prompts DEBEN estar en INGLÉS para que Veo capte mejor las indicaciones.

ESTRUCTURA JERÁRQUICA OBLIGATORIA (Bestructura Veo):
Debes seguir este orden estricto, ya que Veo da más peso al inicio del prompt:

1. [Shot Type & Camera Movement]: Define composición y ángulo (e.g., "Extremely close shot, low-angle shot, tracking shot").
2. [Subject & Action]: Personaje principal y qué hace. (e.g., "A young woman stands").
3. [Subject Details]: Vestimenta, rasgos, expresión. (e.g., "wearing a white space suit, blue eyes").
4. [Environment/Context]: Escenario, hora, clima. (e.g., "in a snowy desert, looking at camera").
5. [Mood/Lighting/Visuals]: Atmósfera, luz, estilo. (e.g., "cinematic aspect, blurred background, cold blue tones, 4k").

REGLAS DE ORO (Secretos de Experto):
- SOLO EN INGLÉS: Traduce todo el contenido visual al inglés.
- SOLO LO VISIBLE: Escribe solamente lo que está en el frame. Si es un close-up de la cara, NO describas los zapatos.
- CONSISTENCIA: Mantén los mismos rasgos del personaje si aparecen en múltiples escenas.
- FLUIDEZ: Describe movimiento natural.

EJEMPLO PERFECTO:
Original: "Una persona escribiendo rápido en una oficina oscura."
Prompt Optimizado: "Close-up cinematic shot. Hands typing rapidly on a mechanical keyboard. Fingers illuminated by soft blue monitor glow. In a dimly lit modern office workspace. High contrast, bokeh background, tech atmosphere, 4k resolution."

TU TAREA:
Genera un prompt en INGLÉS optimizado para cada escena del storyboard recibido.

FORMATO DE SALIDA:
Devuelve un JSON válido con la siguiente estructura:
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
