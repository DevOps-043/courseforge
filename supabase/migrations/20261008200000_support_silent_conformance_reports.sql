-- PREPARED ONLY. Stop workers and validate on PostgreSQL before enabling host V2 opt-in.
-- V1 audible reports retain their exact evidence join. No rows or grants are broadened.
CREATE FUNCTION private.verify_hyperframes_silent_audio_report(p_report jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  v_timing jsonb := $timing${"status":"NOT_REQUESTED","method":"STEREO_ENERGY_ENVELOPE_STREAM_V3","policy":{"id":"stereo-envelope-v3","sampleRate":8000,"channels":2,"binMilliseconds":5,"maximumDurationSeconds":600,"maximumFileBytes":2147483648,"searchMilliseconds":500,"toleranceMilliseconds":20,"minimumCorrelation":0.95,"minimumPeakSeparation":0.02,"peakExclusionMilliseconds":40,"minimumDurationMilliseconds":2000,"lagUncertaintyMilliseconds":5,"silenceRms":0.0001},"lagMilliseconds":null,"lagQuantizationBoundsMilliseconds":null,"correlation":null,"reason":null,"referenceSha256":null,"effectiveToleranceMilliseconds":20,"rms":{"status":"NOT_REQUESTED","policy":{"id":"stereo-rms-window-v1","windowMilliseconds":20,"maximumDeltaDb":0.5,"sampleRate":8000,"silenceRms":0.0001,"maximumRecordedFailures":8,"alignment":"SAME_TIMELINE_NO_GAIN_NORMALIZATION"},"reason":null,"comparedChannelWindows":0,"silentChannelWindows":0,"failedChannelWindows":0,"maximumObservedDeltaDb":null,"failures":[]},"alignment":null}$timing$::jsonb;
  v_selection jsonb := p_report->'referenceSelection';
  v_binding jsonb := p_report#>'{renderEvidence,binding}';
BEGIN
  IF p_report->>'reportVersion' IS DISTINCT FROM '2'
    OR p_report->>'status' IS NULL OR p_report->>'status' NOT IN ('FAIL','INCOMPLETE')
    OR p_report#>>'{audioExpectation,policy}' IS DISTINCT FROM 'FROZEN_NO_AUDIO_TRACK_V1'
    OR coalesce(p_report#>>'{audioExpectation,contractSha256}', '') !~ '^[a-f0-9]{64}$'
    OR p_report#>>'{audioExpectation,contractSha256}' IS DISTINCT FROM v_binding->>'contractSha256'
    OR p_report#>>'{audioExpectation,contractSha256}' IS DISTINCT FROM v_selection->>'contractSha256'
    OR p_report#>>'{renderEvidence,scope}' IS DISTINCT FROM 'CONSUMED_SUPERVISOR_ISSUER_OUTPUT_NOT_ISOLATION_OR_CONFORMANCE'
    OR v_selection->>'scope' IS DISTINCT FROM 'HOST_AUTHORIZED_EXACT_REFERENCE_SELECTION_NOT_DURABLE_ATTESTATION'
    OR (p_report->'references') ? 'audioChecksum'
    OR (p_report->'comparison') ? 'audioPlayback'
    OR p_report#>'{comparison,video,hasAudio}' IS DISTINCT FROM 'false'::jsonb
    OR p_report#>>'{comparison,audioStatus}' IS DISTINCT FROM 'NOT_REQUIRED'
    OR p_report#>>'{comparison,audioLoudness,status}' IS DISTINCT FROM 'NOT_APPLICABLE'
    OR p_report#>'{comparison,audioLoudness,measurement}' IS DISTINCT FROM 'null'::jsonb
    OR p_report#>'{comparison,audioTiming}' IS DISTINCT FROM v_timing
    OR jsonb_typeof(v_selection->'references') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(v_selection->'references') = 0
    OR v_selection#>>'{references,0,visualChecksum}' IS DISTINCT FROM p_report#>>'{references,visualChecksum}'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_selection->'references') WITH ORDINALITY AS r(value, position)
      WHERE jsonb_typeof(r.value) IS DISTINCT FROM 'object' OR r.value ? 'audioChecksum'
        OR r.value->'batchIndex' IS DISTINCT FROM to_jsonb(r.position - 1)
        OR coalesce(r.value->>'visualChecksum', '') !~ '^[a-f0-9]{64}$')
    OR v_selection->>'organizationId' IS DISTINCT FROM p_report->>'organizationId'
    OR v_selection->>'revisionId' IS DISTINCT FROM p_report->>'revisionId'
    OR v_selection->>'executionId' IS DISTINCT FROM v_binding->>'executionId'
    OR v_selection->>'documentHash' IS DISTINCT FROM p_report#>>'{integrity,documentHash}'
    OR v_selection->>'projectHash' IS DISTINCT FROM v_binding->>'projectHash'
    OR v_binding->>'organizationId' IS DISTINCT FROM p_report->>'organizationId'
    OR v_binding->>'requestId' IS DISTINCT FROM p_report->>'requestId'
    OR v_binding->>'revisionId' IS DISTINCT FROM p_report->>'revisionId'
    OR v_binding->>'documentHash' IS DISTINCT FROM p_report#>>'{integrity,documentHash}'
    OR v_binding->>'videoSha256' IS DISTINCT FROM p_report#>>'{integrity,checksum}'
    OR v_binding->'sizeBytes' IS DISTINCT FROM p_report#>'{integrity,sizeBytes}' THEN RETURN false; END IF;
  RETURN true;
EXCEPTION WHEN data_exception THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION private.verify_hyperframes_silent_audio_report(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- Patch only the original private finisher; outer event, controlled-render and attempt gates remain.
-- Every source fragment must occur exactly once. Unexpected installed definitions abort atomically.
DO $$
DECLARE
  v_definition text;
  v_before text;
  v_after text;
  v_patch record;
BEGIN
  v_definition := pg_get_functiondef('private.finish_hyperframes_conformance_job_before_events(uuid,uuid,jsonb,text,boolean)'::regprocedure);
  FOR v_patch IN SELECT * FROM (VALUES
    ($source$OR (p_report->>'reportVersion') IS DISTINCT FROM '1'$source$,
     $target$OR (p_report->>'reportVersion') IS NULL OR p_report->>'reportVersion' NOT IN ('1','2')
      OR (p_report->>'reportVersion' = '1' AND (p_report ? 'audioExpectation' OR p_report#>>'{comparison,audioTiming,status}' = 'NOT_REQUESTED'))
      OR (p_report->>'reportVersion' = '2' AND NOT private.verify_hyperframes_silent_audio_report(p_report))$target$),
    ($source$OR (p_report->>'status' = 'PASS' AND (p_report #>> '{comparison,audioTiming,status}') IS DISTINCT FROM 'PASS')$source$,
     $target$OR (p_report->>'reportVersion' = '1' AND p_report->>'status' = 'PASS' AND (p_report #>> '{comparison,audioTiming,status}') IS DISTINCT FROM 'PASS')$target$),
    ($source$OR (p_report->>'status' = 'PASS' AND (p_report #>> '{comparison,audioTiming,rms,status}') IS DISTINCT FROM 'PASS')$source$,
     $target$OR (p_report->>'reportVersion' = '1' AND p_report->>'status' = 'PASS' AND (p_report #>> '{comparison,audioTiming,rms,status}') IS DISTINCT FROM 'PASS')$target$),
    ($source$NOT IN ('PASS','FAIL','INCOMPLETE','MEASUREMENT_FAILED') THEN$source$,
     $target$NOT IN ('NOT_REQUESTED','PASS','FAIL','INCOMPLETE','MEASUREMENT_FAILED') THEN$target$),
    ($source$JOIN private.hyperframes_audio_conformance_evidence audio ON audio.revision_id = v.id AND audio.organization_id = v.organization_id AND audio.visual_checksum = visual.bundle_sha256$source$,
     $target$LEFT JOIN private.hyperframes_audio_conformance_evidence audio ON p_report->>'reportVersion' = '1' AND audio.revision_id = v.id AND audio.organization_id = v.organization_id AND audio.visual_checksum = visual.bundle_sha256$target$),
    ($source$AND audio.bundle_sha256 = p_report #>> '{references,audioChecksum}'
        AND visual.project_hash = v.project_hash AND visual.document_hash = p_report #>> '{integrity,documentHash}'$source$,
     $target$AND visual.project_hash = v.project_hash AND visual.document_hash = p_report #>> '{integrity,documentHash}'
        AND ((p_report->>'reportVersion' = '2' AND v.manifest#>'{conformance_contract,audio,required}' = 'false'::jsonb
          AND v.manifest#>>'{conformance_contract,schemaVersion}' = '4'
          AND v.manifest#>'{conformance_contract,renderExecution}' IS NOT NULL)
        OR (p_report->>'reportVersion' = '1' AND audio.bundle_sha256 = p_report #>> '{references,audioChecksum}'$target$),
    ($source$AND p_report #>> '{comparison,video,sha256}' = a.checksum$source$,
     $target$))
        AND p_report #>> '{comparison,video,sha256}' = a.checksum$target$)
  ) AS patches(before_text, after_text) LOOP
    v_before := v_patch.before_text; v_after := v_patch.after_text;
    IF strpos(v_definition, v_before) = 0
      OR strpos(substr(v_definition, strpos(v_definition, v_before) + length(v_before)), v_before) > 0 THEN
      RAISE EXCEPTION 'CONFORMANCE_SILENT_MIGRATION_PRECONDITION_INVALID';
    END IF;
    v_definition := replace(v_definition, v_before, v_after);
  END LOOP;
  EXECUTE v_definition;
END;
$$;
-- Rollback: stop V2 workers, restore the original private finisher definition from
-- 20260930160000 under its current private name, then drop this private verifier.
-- Keep outer wrappers and all persisted V1/V2 reports; do not delete evidence or reset leases.
