import { Handler } from '@netlify/functions';
import {
    createGeminiClient,
    createServiceRoleClient,
} from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';
import {
    jsonResponse,
    methodNotAllowedResponse,
    parseJsonBody,
} from './shared/http';
import { resolveSinglePrompt } from '../../src/shared/config/prompts/prompt-resolver.service';
import { VIDEO_BROLL_PROMPT_CODE } from '../../src/shared/config/prompts/materials-generation.prompts.modular';

// --------------------------------------------------------------------------
// Types
// --------------------------------------------------------------------------

interface VideoPromptResultItem {
    generated_prompt: string;
    original_description: string;
    scene_index: number;
}

interface VideoPromptResponsePayload {
    prompts: VideoPromptResultItem[];
}

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

/**
 * Derives the organization_id from a component ID by traversing
 * material_components → material_lessons → materials → artifacts.
 *
 * Returns null if the chain cannot be resolved (safe fallback to global prompt).
 */
async function resolveOrganizationId(
    supabase: ReturnType<typeof createServiceRoleClient>,
    componentId: string,
): Promise<string | null> {
    const { data } = await supabase
        .from('material_components')
        .select(`
            material_lessons (
                materials (
                    artifacts ( organization_id )
                )
            )
        `)
        .eq('id', componentId)
        .single();

    if (!data?.material_lessons) return null;

    const lesson = Array.isArray(data.material_lessons)
        ? data.material_lessons[0]
        : data.material_lessons;
    if (!lesson?.materials) return null;

    const material = Array.isArray(lesson.materials)
        ? lesson.materials[0]
        : lesson.materials;
    if (!material?.artifacts) return null;

    const artifact = Array.isArray(material.artifacts)
        ? material.artifacts[0]
        : material.artifacts;

    return (artifact?.organization_id as string) || null;
}

// --------------------------------------------------------------------------
// Handler
// --------------------------------------------------------------------------

export const handler: Handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return methodNotAllowedResponse();
    }

    try {
        const body = parseJsonBody<{
            componentId?: string;
            storyboard?: unknown;
            userToken?: string;
        }>(event);
        const { componentId, storyboard } = body;

        if (!componentId || !storyboard) {
            return { statusCode: 400, body: 'Missing required fields' };
        }

        const supabase = createServiceRoleClient();
        const genAI = createGeminiClient();
        console.log(`[Video Prompts] Generating for component: ${componentId}`);

        // 1. Resolve organization for prompt personalization
        const organizationId = await resolveOrganizationId(supabase, componentId);
        console.log(`[Video Prompts] Organization: ${organizationId ?? 'global (no org)'}`);

        // 2. Resolve prompt from DB (org → global → hardcoded default)
        const systemPrompt = await resolveSinglePrompt(
            supabase,
            VIDEO_BROLL_PROMPT_CODE,
            organizationId,
        );

        // 3. Prepare Input for Gemini
        const inputContext = JSON.stringify(storyboard, null, 2);
        const fullPrompt = `${systemPrompt}\n\nSTORYBOARD INPUT:\n${inputContext}`;

        // 4. Call Gemini
        const model = 'gemini-2.0-flash';
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

        const result = JSON.parse(jsonMatch[0]) as VideoPromptResponsePayload;

        // 5. Update Component Assets
        const { data: component } = await supabase
            .from('material_components')
            .select('assets')
            .eq('id', componentId)
            .single();

        const currentAssets = component?.assets || {};

        const promptsText = result.prompts.map((promptItem) =>
            `[Escena ${promptItem.scene_index}] ${promptItem.generated_prompt}`
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

        return jsonResponse({ success: true, prompts: promptsText });

    } catch (error: unknown) {
        console.error('[Video Prompts] Error:', error);
        return jsonResponse({ success: false, error: getErrorMessage(error) }, 500);
    }
};
