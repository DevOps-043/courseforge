
import { Handler } from '@netlify/functions';
import { processUnifiedCuration } from './unified-curation-logic';
import {
  createServiceRoleClient,
  getOptionalOpenAiApiKey,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';
import { methodNotAllowedResponse, parseJsonBody } from './shared/http';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowedResponse();

  let curationId: string | undefined;
  try {
    const payload = parseJsonBody<{
      artifactId?: string;
      curationId?: string;
      customPrompt?: string;
      resume?: boolean;
    }>(event);
    const { artifactId, customPrompt, resume } = payload;
    curationId = payload.curationId;
    if (!artifactId || !curationId) throw new Error('Missing artifactId or curationId');

    const supabaseUrl = getSupabaseUrl();
    const supabaseKey = getSupabaseServiceKey();
    const openAiApiKey = getOptionalOpenAiApiKey();
    if (!openAiApiKey) {
      throw new Error('OPENAI_API_KEY is required for curation v2');
    }

    const supabase = createServiceRoleClient();

    if (!resume) {
      const { error: clearError } = await supabase
        .from('curation_rows')
        .delete()
        .eq('curation_id', curationId)
        .eq('origin', 'automatic');
      if (clearError) throw new Error(clearError.message);
      console.log(`[Curation V2] Cleared automatic rows for curation: ${curationId}`);
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
      openAiApiKey,
      resume
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, processed }) };

  } catch (error: unknown) {
    console.error('[Curation Background] Error:', error);
    if (curationId) {
      try {
        await createServiceRoleClient()
          .from('curation')
          .update({
            state: 'PHASE2_BLOCKED',
            qa_decision: {
              decision: 'BLOCKED',
              notes: `La busqueda automatica fallo: ${getErrorMessage(error)}`,
              reviewed_by: 'system',
              reviewed_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', curationId);
      } catch (stateError) {
        console.error('[Curation Background] Failed to persist blocked state:', stateError);
      }
    }
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: getErrorMessage(error),
      }),
    };
  }
};

export { handler };
