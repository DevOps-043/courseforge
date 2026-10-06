-- PREPARED ONLY. Pure internal caption-delta validation; no writes or public RPC.
BEGIN;
CREATE FUNCTION private.validate_narrative_fragment_caption(p_source jsonb,p_copy jsonb,
  p_start numeric,p_end numeric,p_command uuid,p_clip_ordinal integer)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  cue_record record; word_record record; cue jsonb; copied_cue jsonb; copied_word jsonb;
  cue_start numeric; cue_end numeric; word_start numeric; word_end numeric;
  cue_count integer := 0; word_count integer; prefix text;
  time_tolerance CONSTANT numeric := 0.000001;
BEGIN
  IF p_source IS NULL OR p_source->>'type' IS DISTINCT FROM 'NATIVE_CAPTIONS'
    OR jsonb_typeof(p_source->'cues') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_source->'cues') NOT BETWEEN 1 AND 2000
    OR p_start IS NULL OR p_end IS NULL OR p_start<0 OR p_end<=p_start OR p_end-p_start>120
    OR p_command IS NULL OR p_clip_ordinal IS NULL OR p_clip_ordinal NOT BETWEEN 0 AND 47
    THEN RETURN false; END IF;
  IF p_copy IS NOT NULL AND (p_copy-'cues' IS DISTINCT FROM p_source-'cues'
    OR jsonb_typeof(p_copy->'cues') IS DISTINCT FROM 'array') THEN RETURN false; END IF;
  FOR cue_record IN SELECT value,ordinality FROM jsonb_array_elements(p_source->'cues') WITH ORDINALITY LOOP
    cue := cue_record.value;
    IF jsonb_typeof(cue->'startSeconds') IS DISTINCT FROM 'number'
      OR jsonb_typeof(cue->'endSeconds') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
    cue_start := greatest(p_start,(cue->>'startSeconds')::numeric);
    cue_end := least(p_end,(cue->>'endSeconds')::numeric);
    IF cue_end<=cue_start THEN CONTINUE; END IF;
    IF p_copy IS NULL THEN RETURN false; END IF;
    copied_cue := p_copy->'cues'->cue_count;
    prefix := 'caption-'||p_command::text||'-'||p_clip_ordinal::text||'-'||(cue_record.ordinality-1)::text;
    -- Preserve every authored field, including text; never regenerate captions from retained words.
    IF copied_cue IS NULL OR copied_cue->>'id' IS DISTINCT FROM prefix
      OR (copied_cue-ARRAY['id','startSeconds','endSeconds','words']) IS DISTINCT FROM (cue-ARRAY['id','startSeconds','endSeconds','words'])
      OR jsonb_typeof(copied_cue->'startSeconds') IS DISTINCT FROM 'number'
      OR jsonb_typeof(copied_cue->'endSeconds') IS DISTINCT FROM 'number'
      OR (copied_cue->>'startSeconds')::numeric<0
      OR (copied_cue->>'endSeconds')::numeric<=(copied_cue->>'startSeconds')::numeric
      OR abs((copied_cue->>'startSeconds')::numeric-(cue_start-p_start))>time_tolerance
      OR abs((copied_cue->>'endSeconds')::numeric-(cue_end-p_start))>time_tolerance
      THEN RETURN false; END IF;
    IF cue ? 'words' THEN
      IF jsonb_typeof(cue->'words') IS DISTINCT FROM 'array' OR jsonb_array_length(cue->'words')>20
        OR jsonb_typeof(copied_cue->'words') IS DISTINCT FROM 'array' THEN RETURN false; END IF;
      word_count := 0;
      FOR word_record IN SELECT value,ordinality FROM jsonb_array_elements(cue->'words') WITH ORDINALITY LOOP
        IF jsonb_typeof(word_record.value->'startSeconds') IS DISTINCT FROM 'number'
          OR jsonb_typeof(word_record.value->'endSeconds') IS DISTINCT FROM 'number' THEN RETURN false; END IF;
        word_start := greatest(cue_start,(word_record.value->>'startSeconds')::numeric);
        word_end := least(cue_end,(word_record.value->>'endSeconds')::numeric);
        IF word_end<=word_start THEN CONTINUE; END IF;
        copied_word := copied_cue->'words'->word_count;
        IF copied_word IS NULL OR copied_word->>'id' IS DISTINCT FROM prefix||'-word-'||(word_record.ordinality-1)::text
          OR (copied_word-ARRAY['id','startSeconds','endSeconds']) IS DISTINCT FROM (word_record.value-ARRAY['id','startSeconds','endSeconds'])
          OR jsonb_typeof(copied_word->'startSeconds') IS DISTINCT FROM 'number'
          OR jsonb_typeof(copied_word->'endSeconds') IS DISTINCT FROM 'number'
          OR (copied_word->>'startSeconds')::numeric<0
          OR (copied_word->>'endSeconds')::numeric<=(copied_word->>'startSeconds')::numeric
          OR abs((copied_word->>'startSeconds')::numeric-(word_start-p_start))>time_tolerance
          OR abs((copied_word->>'endSeconds')::numeric-(word_end-p_start))>time_tolerance
          THEN RETURN false; END IF;
        word_count := word_count+1;
      END LOOP;
      IF jsonb_array_length(copied_cue->'words')<>word_count THEN RETURN false; END IF;
    ELSIF copied_cue ? 'words' THEN RETURN false;
    END IF;
    cue_count := cue_count+1;
  END LOOP;
  -- A caption layer with no intersecting cue must be omitted, not copied with invented content.
  IF cue_count=0 THEN RETURN p_copy IS NULL; END IF;
  RETURN jsonb_array_length(p_copy->'cues')=cue_count;
END $$;
REVOKE ALL ON FUNCTION private.validate_narrative_fragment_caption(jsonb,jsonb,numeric,numeric,uuid,integer)
  FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
