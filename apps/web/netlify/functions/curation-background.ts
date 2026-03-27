
import { Handler } from '@netlify/functions';
import { processUnifiedCuration } from './unified-curation-logic';
import {
  createServiceRoleClient,
  getGeminiApiKey,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from './shared/bootstrap';
import { methodNotAllowedResponse, parseJsonBody } from './shared/http';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowedResponse();

  try {
    const { artifactId, curationId, customPrompt, resume } = parseJsonBody<{
      artifactId?: string;
      curationId?: string;
      customPrompt?: string;
      resume?: boolean;
    }>(event);
    if (!artifactId || !curationId) throw new Error('Missing artifactId or curationId');

    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = getSupabaseServiceKey();
    const geminiApiKey = getGeminiApiKey();

    // Clear existing rows ONLY if not resuming
    const supabase = createServiceRoleClient();

    if (!resume) {
      await supabase.from('curation_rows').delete().eq('curation_id', curationId);
      console.log(`[Curation Background] Cleared old rows for curation: ${curationId}`);
    } else {
      console.log(`[Curation Background] RESUME requested. Keeping existing rows for curation: ${curationId}`);
    }

    // Call shared logic
    const processed = await processUnifiedCuration({
      artifactId,
      curationId,
      customPrompt,
      supabaseUrl,
      supabaseKey,
      geminiApiKey,
      resume
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, processed }) };

  } catch (error: unknown) {
    console.error('[Curation Background] Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

export { handler };
