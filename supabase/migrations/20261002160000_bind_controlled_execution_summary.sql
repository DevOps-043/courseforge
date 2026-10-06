-- Prepared only: no backend activation. Local file/CDP matching cannot approve an isolated renderer.
DO $$
BEGIN
  IF to_regprocedure('private.finish_hyperframes_conformance_job_before_controlled(uuid,uuid,jsonb,text,boolean)') IS NULL THEN
    ALTER FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) SET SCHEMA private;
    ALTER FUNCTION private.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean)
      RENAME TO finish_hyperframes_conformance_job_before_controlled;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION private.finish_hyperframes_conformance_job_before_controlled(uuid, uuid, jsonb, text, boolean)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.finish_hyperframes_conformance_job(
  p_job_id uuid, p_lease_token uuid, p_report jsonb DEFAULT NULL,
  p_error_code text DEFAULT NULL, p_retryable boolean DEFAULT false
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  v_job private.hyperframes_conformance_jobs%ROWTYPE;
  v_expected jsonb;
  v_document_hash text;
  v_execution jsonb;
  v_seek jsonb;
  v_contract jsonb;
  v_font_usage jsonb;
  v_font_witness jsonb;
BEGIN
  SELECT * INTO v_job FROM private.hyperframes_conformance_jobs
    WHERE id = p_job_id AND lease_token = p_lease_token AND status = 'RUNNING' AND lease_expires_at > now() FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF p_report IS NOT NULL THEN
    SELECT manifest#>'{conformance_contract,renderExecution}', manifest->>'draft_document_hash', manifest->'conformance_contract'
      INTO v_expected, v_document_hash, v_contract FROM public.video_composition_revisions
      WHERE id = v_job.revision_id AND organization_id = v_job.organization_id FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CONFORMANCE_JOB_REVISION_MISSING'; END IF;
    v_execution := p_report#>'{comparison,visual,renderExecution}';
    v_seek := p_report#>'{comparison,visual,seekRepeatability}';
    v_font_usage := p_report#>'{comparison,visual,fontUsage}';
    v_font_witness := v_font_usage->'observedWitness';
    IF v_font_witness IS NOT NULL THEN
      IF v_expected IS NULL OR jsonb_typeof(v_contract#>'{fontUsageContract,bindings}') IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_FONT_WITNESS_UNAUTHORIZED';
      END IF;
      IF jsonb_typeof(v_font_witness) IS DISTINCT FROM 'object'
        OR v_font_witness->>'policy' IS DISTINCT FROM 'CONTROLLED_SESSION_CUSTOM_NATIVE_FONT_USAGE_V1'
        OR v_font_witness->>'scope' IS DISTINCT FROM 'LOCAL_CDP_CUSTOM_NATIVE_GLYPHS_NOT_RENDERER_ATTESTATION'
        OR v_font_witness->>'status' IS DISTINCT FROM 'OBSERVED_UNATTESTED'
        OR v_font_witness->>'documentHash' IS DISTINCT FROM v_document_hash
        OR v_font_witness->>'videoSha256' IS DISTINCT FROM p_report#>>'{integrity,checksum}'
        OR v_font_witness->>'manifestSha256' IS DISTINCT FROM v_contract#>>'{fontUsageContract,manifestSha256}'
        OR v_font_usage->>'manifestSha256' IS DISTINCT FROM v_font_witness->>'manifestSha256'
        OR v_font_usage->>'status' IS DISTINCT FROM 'INCOMPLETE'
        OR v_font_usage->>'reason' IS DISTINCT FROM 'RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE'
        OR coalesce(v_font_witness->>'contractSha256', '') !~ '^[a-f0-9]{64}$'
        OR coalesce(v_font_witness->>'evidenceSha256', '') !~ '^[a-f0-9]{64}$'
        OR coalesce(v_font_witness->>'textEvidenceSha256', '') !~ '^[a-f0-9]{64}$'
        OR p_report->>'status' = 'PASS' OR p_report#>>'{comparison,visual,status}' = 'PASS'
        OR NOT coalesce((p_report#>'{comparison,visual,incompletenessReasons}') ? 'RENDERER_FONT_USAGE_UNAVAILABLE', false) THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_FONT_WITNESS_INVALID';
      END IF;
      -- Canonical full-contract SHA is checked by Node, not inferred from JSONB serialization.
      IF jsonb_array_length(v_contract#>'{fontUsageContract,bindings}') = 0
        OR v_font_witness->'bindingCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(v_contract#>'{fontUsageContract,bindings}'))
        OR v_font_usage->'requiredBindingCount' IS DISTINCT FROM v_font_witness->'bindingCount'
        OR v_font_witness->'checkpointCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(v_contract#>'{textParity,checkpoints}'))
        OR v_font_witness->'elementCount' IS DISTINCT FROM to_jsonb((SELECT count(*)::integer
          FROM jsonb_array_elements(v_contract#>'{textParity,checkpoints}') AS point(value)
          CROSS JOIN LATERAL jsonb_array_elements(point.value->'expectedTexts') AS expected(value)
          WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_contract#>'{fontUsageContract,bindings}') AS binding(value)
            WHERE binding.value->>'elementId' = expected.value->>'elementId'))) THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_FONT_WITNESS_BINDING_INVALID';
      END IF;
    END IF;
    IF v_expected->>'seekRepeatabilityPolicy' IS NOT NULL THEN
      IF v_expected->>'seekRepeatabilityPolicy' IS DISTINCT FROM 'EXACT_RGBA_FORWARD_REVERSE_V1' THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_SEEK_POLICY_INVALID';
      END IF;
      IF v_seek IS NULL THEN
        IF NOT coalesce((p_report#>'{comparison,visual,incompletenessReasons}') ? 'RENDER_SEEK_REPEATABILITY_UNAVAILABLE', false) THEN
          RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_SEEK_REQUIRED';
        END IF;
      ELSE
        IF jsonb_typeof(v_seek) IS DISTINCT FROM 'object'
          OR v_seek->>'policy' IS DISTINCT FROM 'EXACT_RGBA_FORWARD_REVERSE_V1'
          OR v_seek->>'scope' IS DISTINCT FROM 'SDK_SESSION_CHECKPOINTS_NOT_PREVIEW_PARITY_OR_JOB_ATTESTATION'
          OR v_seek->>'status' IS DISTINCT FROM 'PASS' OR v_seek->>'documentHash' IS DISTINCT FROM v_document_hash
          OR coalesce(v_seek->>'contractSha256', '') !~ '^[a-f0-9]{64}$'
          OR jsonb_typeof(v_seek->'samples') IS DISTINCT FROM 'array' THEN
          RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_SEEK_SUMMARY_INVALID';
        END IF;
        -- Full canonical contract hash binding remains checked independently by the Node finalizer.
        IF jsonb_array_length(v_seek->'samples') IS DISTINCT FROM jsonb_array_length(v_contract->'checkpoints')
          OR v_seek->'checkpointCount' IS DISTINCT FROM to_jsonb(jsonb_array_length(v_contract->'checkpoints'))
          OR (SELECT count(DISTINCT value->'frameIndex') FROM jsonb_array_elements(v_seek->'samples'))
            IS DISTINCT FROM jsonb_array_length(v_seek->'samples')::bigint
          OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_seek->'samples') AS sample(value)
            WHERE coalesce(value->>'rgbaSha256', '') !~ '^[a-f0-9]{64}$'
              OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_contract->'checkpoints') AS point(value)
                WHERE point.value->'frameIndex' = sample.value->'frameIndex'
                  AND point.value->'timeSeconds' = sample.value->'timeSeconds')) THEN
          RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_SEEK_BINDING_INVALID';
        END IF;
      END IF;
    ELSIF v_seek IS NOT NULL THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_SEEK_UNAUTHORIZED';
    END IF;
    IF v_expected IS NOT NULL THEN
      IF jsonb_typeof(v_expected) IS DISTINCT FROM 'object'
        OR v_expected->>'policy' IS DISTINCT FROM 'CONTROLLED_FILES_AND_BROWSER_SESSION_V1'
        OR v_expected->>'backend' IS DISTINCT FROM 'CONTROLLED'
        OR v_expected->>'sdkVersion' IS DISTINCT FROM '0.7.106'
        OR jsonb_typeof(v_execution) IS DISTINCT FROM 'object'
        OR v_execution->>'policy' IS DISTINCT FROM v_expected->>'policy'
        OR v_execution->>'scope' IS DISTINCT FROM 'FILE_AND_CDP_MATCH_NOT_ISOLATION_OR_JOB_ATTESTATION'
        OR v_execution->>'reason' IS DISTINCT FROM 'RENDER_EXECUTION_ATTESTATION_PENDING'
        OR v_execution->>'status' IS NULL OR v_execution->>'status' NOT IN ('MATCH', 'MISSING', 'MISMATCH')
        OR v_execution->>'documentHash' IS DISTINCT FROM v_document_hash
        OR v_execution->>'videoSha256' IS DISTINCT FROM p_report#>>'{integrity,checksum}'
        OR p_report#>>'{integrity,checksum}' IS NULL
        OR p_report->>'status' = 'PASS' OR p_report#>>'{comparison,visual,status}' = 'PASS'
        OR NOT coalesce((p_report#>'{comparison,visual,incompletenessReasons}') ? 'RENDER_EXECUTION_ATTESTATION_PENDING', false)
        OR jsonb_typeof(v_execution->'mismatches') IS DISTINCT FROM 'array'
        OR (v_execution->>'status' = 'MISMATCH' AND
          (p_report->>'status' IS DISTINCT FROM 'FAIL' OR p_report#>>'{comparison,visual,status}' IS DISTINCT FROM 'FAIL')) THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_EXECUTION_ATTESTATION_INVALID';
      END IF;
      IF jsonb_array_length(v_execution->'mismatches') > 14
        OR (v_execution->>'status' = 'MISMATCH') IS DISTINCT FROM (jsonb_array_length(v_execution->'mismatches') > 0)
        OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_execution->'mismatches') AS mismatch(value)
          WHERE jsonb_typeof(value) IS DISTINCT FROM 'string' OR value#>>'{}' NOT IN
            ('DOCUMENT', 'VIDEO', 'NODE', 'PRODUCER', 'ENGINE', 'RUNTIME', 'BROWSER_FILE', 'ENCODER', 'DECODER', 'BROWSER_SESSION', 'PIXEL_DECODER', 'PROBE', 'SDR_CONVERSION', 'SDR_AUDIO_MUX'))
        OR (SELECT count(*) FROM jsonb_array_elements(v_execution->'mismatches')) IS DISTINCT FROM
          (SELECT count(DISTINCT value) FROM jsonb_array_elements(v_execution->'mismatches') AS mismatch(value)) THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_EXECUTION_SUMMARY_INVALID';
      END IF;
      IF v_expected->'comparisonTools' IS NULL AND
        ((v_execution->'mismatches') ? 'PIXEL_DECODER' OR (v_execution->'mismatches') ? 'PROBE') THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_COMPARISON_TOOLS_UNAUTHORIZED';
      END IF;
      IF v_expected->'comparisonTools' IS NOT NULL AND
        (jsonb_typeof(v_expected->'comparisonTools') IS DISTINCT FROM 'object'
          OR v_expected#>>'{comparisonTools,policy}' IS DISTINCT FROM 'EXPLICIT_PIXEL_DECODER_AND_PROBE_V1') THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_COMPARISON_TOOLS_POLICY_INVALID';
      END IF;
      IF v_expected->>'sdrConversionPolicy' IS NULL AND (v_execution->'mismatches') ? 'SDR_CONVERSION' THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_SDR_CONVERSION_UNAUTHORIZED';
      END IF;
      IF v_expected->>'sdrConversionPolicy' IS NOT NULL AND
        (v_expected->>'sdrConversionPolicy' IS DISTINCT FROM 'DECLARED_SRGB_PNG_TO_REC709_LIMITED_V1'
          OR v_expected->'comparisonTools' IS NULL
          OR v_contract->>'colorTagPolicy' IS DISTINCT FROM 'sdr-rec709-tags-v1') THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_SDR_CONVERSION_POLICY_INVALID';
      END IF;
      IF v_expected->>'sdrAudioMuxPolicy' IS NULL AND ((v_execution->'mismatches') ? 'SDR_AUDIO_MUX') THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_SDR_AUDIO_MUX_UNAUTHORIZED';
      END IF;
      IF v_expected->>'sdrAudioMuxPolicy' IS NOT NULL AND
        (v_expected->>'sdrAudioMuxPolicy' IS DISTINCT FROM 'COPIED_H264_REC709_AAC_MUX_V1'
          OR v_expected->>'sdrConversionPolicy' IS DISTINCT FROM 'DECLARED_SRGB_PNG_TO_REC709_LIMITED_V1') THEN
        RAISE EXCEPTION 'CONFORMANCE_JOB_SDR_AUDIO_MUX_POLICY_INVALID';
      END IF;
    ELSIF v_execution IS NOT NULL THEN
      RAISE EXCEPTION 'CONFORMANCE_JOB_RENDER_EXECUTION_UNAUTHORIZED';
    END IF;
  END IF;
  RETURN private.finish_hyperframes_conformance_job_before_controlled(p_job_id, p_lease_token, p_report, p_error_code, p_retryable);
END;
$$;
REVOKE ALL ON FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finish_hyperframes_conformance_job(uuid, uuid, jsonb, text, boolean) TO service_role;
