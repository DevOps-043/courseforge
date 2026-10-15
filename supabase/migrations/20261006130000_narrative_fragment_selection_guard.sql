-- PREPARED ONLY. Internal membership/dependency validation; not the commit RPC.
BEGIN;
CREATE FUNCTION private.narrative_fragment_selected_clips(p_document jsonb,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  candidates jsonb; ordered_candidates jsonb; clip jsonb; track jsonb; anchor jsonb; group_entry jsonb;
  avatar jsonb; voice jsonb; avatars jsonb; voices jsonb; interval_start numeric; interval_end numeric;
  tolerance CONSTANT numeric := 0.000001;
BEGIN
  IF p_document IS NULL OR p_plan IS NULL OR jsonb_typeof(p_plan->'selectedTrackIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'selectedTrackIds') NOT BETWEEN 2 AND 20
    OR jsonb_typeof(p_plan->'candidateClipIds') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_plan->'candidateClipIds') NOT BETWEEN 2 AND 48
    OR jsonb_array_length(p_plan->'selectedTrackIds')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_plan->'selectedTrackIds'))
    OR jsonb_array_length(p_plan->'candidateClipIds')<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_plan->'candidateClipIds'))
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_SELECTION_INVALID'; END IF;
  interval_start := (p_plan->>'sourceStartSeconds')::numeric;
  interval_end := (p_plan->>'sourceEndSeconds')::numeric;
  IF interval_start IS NULL OR interval_end IS NULL OR interval_start<0 OR interval_end<=interval_start
    OR interval_end-interval_start>120 THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_INTERVAL_INVALID'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_plan->'selectedTrackIds') selected
    WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_document->'tracks') t WHERE t->>'id'=selected.value
      AND NOT coalesce((t->>'locked')::boolean,false) AND NOT coalesce((t->>'hidden')::boolean,false)))
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_TRACK_UNAVAILABLE'; END IF;
  SELECT coalesce(jsonb_agg(c),'[]'::jsonb) INTO candidates FROM jsonb_array_elements(p_document->'clips') c
    WHERE p_plan->'selectedTrackIds' ? (c->>'trackId') AND NOT coalesce((c->>'hidden')::boolean,false)
      AND (c->>'startSeconds')::numeric<interval_end
      AND (c->>'startSeconds')::numeric+(c->>'durationSeconds')::numeric>interval_start;
  IF jsonb_array_length(candidates)<>jsonb_array_length(p_plan->'candidateClipIds')
    OR EXISTS(SELECT c->>'id' FROM jsonb_array_elements(candidates) c EXCEPT
      SELECT value FROM jsonb_array_elements_text(p_plan->'candidateClipIds'))
    OR EXISTS(SELECT value FROM jsonb_array_elements_text(p_plan->'candidateClipIds') EXCEPT
      SELECT c->>'id' FROM jsonb_array_elements(candidates) c)
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_MEMBERSHIP_INVALID'; END IF;
  -- The server planner supplies its explicit order: never assume PostgreSQL collation matches Intl localeCompare.
  -- This order determines copy/caption ordinals, including caption candidates later omitted for empty intersection.
  SELECT jsonb_agg(c ORDER BY selected.ordinality) INTO ordered_candidates
    FROM jsonb_array_elements_text(p_plan->'candidateClipIds') WITH ORDINALITY selected(value,ordinality)
    JOIN jsonb_array_elements(candidates) c ON c->>'id'=selected.value;
  SELECT c INTO anchor FROM jsonb_array_elements(candidates) c WHERE c->>'id'=p_plan#>>'{anchor,sourceClipId}';
  SELECT t INTO track FROM jsonb_array_elements(p_document->'tracks') t WHERE t->>'id'=anchor->>'trackId';
  IF anchor IS NULL OR track->>'semanticRole' IS DISTINCT FROM 'VOICE' OR anchor->>'kind' IS DISTINCT FROM 'AUDIO'
    OR anchor#>>'{source,type}' IS DISTINCT FROM 'PRODUCTION_ASSET'
    OR interval_start<(anchor->>'startSeconds')::numeric
    OR interval_end>(anchor->>'startSeconds')::numeric+(anchor->>'durationSeconds')::numeric
    OR p_plan#>>'{anchor,sourceStartSeconds}' IS NULL OR p_plan#>>'{anchor,sourceEndSeconds}' IS NULL
    OR abs((p_plan#>>'{anchor,sourceStartSeconds}')::numeric-(coalesce((anchor->>'sourceOffsetSeconds')::numeric,0)+interval_start-(anchor->>'startSeconds')::numeric))>tolerance
    OR abs((p_plan#>>'{anchor,sourceEndSeconds}')::numeric-(coalesce((anchor->>'sourceOffsetSeconds')::numeric,0)+interval_end-(anchor->>'startSeconds')::numeric))>tolerance
    OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(candidates) c WHERE c->>'kind' IN ('VIDEO','IMAGE','TEXT'))
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_ANCHOR_OR_VISUAL_INVALID'; END IF;
  FOR clip IN SELECT c FROM jsonb_array_elements(candidates) c LOOP
    IF coalesce((clip->>'playbackRate')::numeric,1)<>1 OR coalesce((clip->>'freezeTailSeconds')::numeric,0)<>0
      OR coalesce((clip->>'fadeInSeconds')::numeric,0)>0 OR coalesce((clip->>'fadeOutSeconds')::numeric,0)>0
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_document#>'{motion,animations}','[]'::jsonb)) a WHERE a#>>'{target,clipId}'=clip->>'id')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_document#>'{transitions,items}','[]'::jsonb)) t
        WHERE t->>'fromClipId'=clip->>'id' OR t->>'toClipId'=clip->>'id')
      THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_EFFECT_UNSUPPORTED'; END IF;
    SELECT t INTO track FROM jsonb_array_elements(p_document->'tracks') t WHERE t->>'id'=clip->>'trackId';
    IF clip->>'sceneId' IS NOT NULL AND (track->>'semanticRole'='AVATAR' OR (track->>'semanticRole'='VOICE' AND clip->>'kind'='AUDIO')) THEN
      SELECT coalesce(jsonb_agg(c),'[]'::jsonb) INTO avatars FROM jsonb_array_elements(p_document->'clips') c
        JOIN jsonb_array_elements(p_document->'tracks') t ON t->>'id'=c->>'trackId'
        WHERE c->>'sceneId'=clip->>'sceneId' AND t->>'semanticRole'='AVATAR';
      SELECT coalesce(jsonb_agg(c),'[]'::jsonb) INTO voices FROM jsonb_array_elements(p_document->'clips') c
        JOIN jsonb_array_elements(p_document->'tracks') t ON t->>'id'=c->>'trackId'
        WHERE c->>'sceneId'=clip->>'sceneId' AND t->>'semanticRole'='VOICE' AND c->>'kind'='AUDIO';
      IF jsonb_array_length(avatars)>1 OR jsonb_array_length(voices)>1 THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_LINK_AMBIGUOUS'; END IF;
      IF jsonb_array_length(avatars)=1 AND jsonb_array_length(voices)=1 THEN
        avatar := avatars->0; voice := voices->0;
        IF NOT (p_plan->'candidateClipIds' ? (avatar->>'id')) OR NOT (p_plan->'candidateClipIds' ? (voice->>'id'))
          OR abs((avatar->>'startSeconds')::numeric-(voice->>'startSeconds')::numeric)>tolerance
          OR abs((avatar->>'durationSeconds')::numeric-(voice->>'durationSeconds')::numeric)>tolerance
          OR abs(coalesce((avatar->>'sourceOffsetSeconds')::numeric,0)-coalesce((voice->>'sourceOffsetSeconds')::numeric,0))>tolerance
          THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_LINK_INCOMPLETE'; END IF;
      END IF;
    END IF;
  END LOOP;
  FOR group_entry IN SELECT g FROM jsonb_array_elements(coalesce(p_document->'groups','[]'::jsonb)) g LOOP
    IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(group_entry->'clipIds') m WHERE p_plan->'candidateClipIds' ? m.value)
      AND EXISTS(SELECT 1 FROM jsonb_array_elements_text(group_entry->'clipIds') m WHERE NOT (p_plan->'candidateClipIds' ? m.value))
      THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_GROUP_INCOMPLETE'; END IF;
  END LOOP;
  RETURN ordered_candidates;
END $$;
REVOKE ALL ON FUNCTION private.narrative_fragment_selected_clips(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
