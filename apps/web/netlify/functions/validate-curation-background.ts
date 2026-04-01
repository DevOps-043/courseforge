import { Handler } from '@netlify/functions';
import { createServiceRoleClient } from './shared/bootstrap';
import {
  resolveRedirectUrl,
  validateUrlWithContent,
} from './shared/curation-runtime';
import { getErrorMessage } from './shared/errors';
import { methodNotAllowedResponse, parseJsonBody } from './shared/http';

interface ValidationRow {
  id: string;
  source_ref: string;
  apta: boolean | null;
  cobertura_completa: boolean | null;
  forbidden_override: boolean | null;
}

function extractHttpStatusCode(reason: string) {
  const match = reason.match(/HTTP\s+(\d{3})/i);
  return match ? Number.parseInt(match[1], 10) : null;
}

const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowedResponse();

  const supabase = createServiceRoleClient();
  let artifactId: string | undefined;

  try {
    const payload = parseJsonBody<{
      artifactId?: string;
      userToken?: string;
    }>(event);
    artifactId = payload.artifactId;

    if (!artifactId) throw new Error('Missing artifactId');

    const { data: latestCuration, error: curationError } = await supabase
      .from('curation')
      .select('id')
      .eq('artifact_id', artifactId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    if (curationError || !latestCuration) {
      return {
        statusCode: 404,
        body: JSON.stringify({
          error: 'No active curation found for this artifact',
        }),
      };
    }

    const curationId = latestCuration.id;

    const { error: markValidatingError } = await supabase
      .from('curation')
      .update({
        state: 'PHASE2_VALIDATING',
        updated_at: new Date().toISOString(),
      })
      .eq('id', curationId);

    if (markValidatingError) {
      throw new Error(markValidatingError.message);
    }

    const { data: rows, error: rowsError } = await supabase
      .from('curation_rows')
      .select(
        'id, source_ref, apta, cobertura_completa, forbidden_override',
      )
      .eq('curation_id', curationId);

    if (rowsError) {
      throw new Error(rowsError.message);
    }

    const validationRows = (rows as ValidationRow[] | null) || [];

    if (validationRows.length === 0) {
      await supabase
        .from('curation')
        .update({
          state: 'PHASE2_READY_FOR_QA',
          updated_at: new Date().toISOString(),
        })
        .eq('id', curationId);

      return {
        statusCode: 200,
        body: JSON.stringify({
          success: true,
          processed: 0,
          mode: 'row-validation',
        }),
      };
    }

    let processed = 0;

    for (const row of validationRows) {
      const now = new Date().toISOString();
      let resolvedUrl = row.source_ref;

      try {
        if (
          resolvedUrl.includes('vertexaisearch.cloud.google.com') ||
          resolvedUrl.includes('grounding-api-redirect')
        ) {
          resolvedUrl = await resolveRedirectUrl(resolvedUrl);
        }

        const validation = await validateUrlWithContent(resolvedUrl);
        const nextApta = validation.isValid ? row.apta ?? true : false;
        const nextCobertura = validation.isValid
          ? row.cobertura_completa ?? true
          : false;

        const { error: updateError } = await supabase
          .from('curation_rows')
          .update({
            source_ref: resolvedUrl,
            url_status: validation.isValid ? 'OK' : 'BROKEN',
            http_status_code: extractHttpStatusCode(validation.reason),
            last_checked_at: now,
            failure_reason: validation.isValid ? null : validation.reason,
            auto_evaluated: true,
            auto_reason: validation.reason,
            apta: row.forbidden_override ? row.apta : nextApta,
            cobertura_completa: row.forbidden_override
              ? row.cobertura_completa
              : nextCobertura,
            motivo_no_apta: validation.isValid ? null : validation.reason,
            updated_at: now,
          })
          .eq('id', row.id);

        if (updateError) {
          throw new Error(updateError.message);
        }

        processed += 1;
      } catch (rowError: unknown) {
        const reason = getErrorMessage(rowError);

        await supabase
          .from('curation_rows')
          .update({
            source_ref: resolvedUrl,
            url_status: 'BROKEN',
            http_status_code: extractHttpStatusCode(reason),
            last_checked_at: now,
            failure_reason: reason,
            auto_evaluated: true,
            auto_reason: reason,
            apta: row.forbidden_override ? row.apta : false,
            cobertura_completa: row.forbidden_override
              ? row.cobertura_completa
              : false,
            motivo_no_apta: reason,
            updated_at: now,
          })
          .eq('id', row.id);
      }
    }

    await supabase
      .from('curation')
      .update({
        state: 'PHASE2_READY_FOR_QA',
        updated_at: new Date().toISOString(),
      })
      .eq('id', curationId);

    return {
      statusCode: 200,
      body: JSON.stringify({
        success: true,
        processed,
        mode: 'row-validation',
      }),
    };
  } catch (error: unknown) {
    console.error('[Validation Proxy] Error:', error);

    if (artifactId) {
      await supabase
        .from('curation')
        .update({
          state: 'PHASE2_READY_FOR_QA',
          updated_at: new Date().toISOString(),
        })
        .eq('artifact_id', artifactId);
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
