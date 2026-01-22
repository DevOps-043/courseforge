
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { processUnifiedCuration } from './unified-curation-logic';

/**
 * PROXY FOR VALIDATION
 * Since we unified Search + Curation in a single step, this function 
 * (triggered by "Validate" button in UI) will now act as a "Regenerate/Recover" 
 * for the artifact's latest curation.
 */
const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { artifactId, userToken } = JSON.parse(event.body || '{}');

    if (!artifactId) throw new Error('Missing artifactId');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''; // Use service key for backend operations
    const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

    if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
        throw new Error('Missing environment configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Find the active curation for this artifact
    // We assume the "Validation" button is clicked on an existing curation context.
    // If multiple exist, we take the latest.
    const { data: latestCuration, error: curationError } = await supabase
        .from('curation')
        .select('id, state')
        .eq('artifact_id', artifactId)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    if (curationError || !latestCuration) {
        return { statusCode: 404, body: JSON.stringify({ error: 'No active curation found for this artifact' }) };
    }

    const curationId = latestCuration.id;

    console.log(`[Validation Proxy] Triggering re-run for Curation: ${curationId} (Artifact: ${artifactId})`);

    // 2. Trigger Unified Logic
    // Note: This will generate NEW rows. A "Cleanup" might be needed if we want to replace old ones.
    // For now, based on "Unified" requirement, we assume adding new validated rows is acceptable behavior
    // or the previous rows were deleted/failed.
    
    // Optional: Delete previous rows for this curation if we want a clean slate?
    // Depending on user intent (Retry failed vs full regen).
    // Let's keep it additive for safety, or maybe the logic inside unified-curation-logic handles dedup?
    // My logic uses .insert().
    
    // Let's delete old rows to avoid duplicates since this is a "Validation" pass which implies "Make it right".
    await supabase.from('curation_rows').delete().eq('curation_id', curationId);
    console.log(`[Validation Proxy] Cleared old rows for execution.`);

    // 3. Process
    const processed = await processUnifiedCuration({
        artifactId,
        curationId,
        customPrompt: undefined, // UI doesn't pass customPrompt here yet
        supabaseUrl,
        supabaseKey,
        geminiApiKey
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, processed, mode: 'unified-proxy' }) };

  } catch (error: any) {
    console.error('[Validation Proxy] Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

export { handler };
