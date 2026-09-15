
import { Handler } from '@netlify/functions';
import { generationFailureMessage } from '../../src/lib/pipeline-generation-policy';
import { processUnifiedCuration } from './unified-curation-logic';
import {
  createServiceRoleClient,
  getOptionalOpenAiApiKey,
  getSupabaseServiceKey,
  getSupabaseUrl,
} from './shared/bootstrap';
import { getErrorMessage } from './shared/errors';
import { methodNotAllowedResponse, parseVerifiedBackgroundBody, unauthorizedBackgroundResponse } from './shared/http';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowedResponse();

  let curationId: string | undefined;
  let payload: {
    artifactId?: string;
    curationId?: string;
    customPrompt?: string;
    resume?: boolean;
    attemptNumber?: number;
  };
  try {
    payload = await parseVerifiedBackgroundBody(event);
  } catch {
    return unauthorizedBackgroundResponse();
  }

  try {
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
    const { data: current, error: lookupError } = await supabase.from('curation')
      .select('id, state, attempt_number').eq('id', curationId).eq('artifact_id', artifactId).maybeSingle();
    if (lookupError) throw lookupError;
    if (!current || current.state !== 'PHASE2_GENERATING' || current.attempt_number !== payload.attemptNumber) {
      return { statusCode: 200, body: JSON.stringify({ superseded: true }) };
    }

    // Call shared logic
    const processed = await processUnifiedCuration({
      artifactId,
      curationId,
      customPrompt,
      supabaseUrl,
      supabaseKey,
      openAiApiKey,
      resume,
      attemptNumber: current.attempt_number,
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
              notes: generationFailureMessage(error),
              reviewed_by: 'system',
              reviewed_at: new Date().toISOString(),
            },
            updated_at: new Date().toISOString(),
          })
          .eq('id', curationId).eq('state', 'PHASE2_GENERATING')
          .eq('attempt_number', payload.attemptNumber ?? -1);
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
