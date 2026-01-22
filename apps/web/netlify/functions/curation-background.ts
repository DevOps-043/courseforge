
import { Handler } from '@netlify/functions';
import { createClient } from '@supabase/supabase-js';
import { processUnifiedCuration } from './unified-curation-logic';

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };

  try {
    const { artifactId, curationId, customPrompt } = JSON.parse(event.body || '{}');
    if (!curationId) throw new Error('Missing curationId');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
    const geminiApiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY || '';

    if (!supabaseUrl || !supabaseKey || !geminiApiKey) {
      throw new Error('Missing environment configuration');
    }

    // Clear existing rows to prevent duplicates (same as validate-curation-background.ts)
    const supabase = createClient(supabaseUrl, supabaseKey);
    await supabase.from('curation_rows').delete().eq('curation_id', curationId);
    console.log(`[Curation Background] Cleared old rows for curation: ${curationId}`);

    // Call shared logic
    const processed = await processUnifiedCuration({
      artifactId,
      curationId,
      customPrompt,
      supabaseUrl,
      supabaseKey,
      geminiApiKey
    });

    return { statusCode: 200, body: JSON.stringify({ success: true, processed }) };

  } catch (error: any) {
    console.error('[Curation Background] Error:', error);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};

export { handler };
