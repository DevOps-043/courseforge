-- Copia narrativa jerárquica: mismo grafo y delta en SQL y TypeScript.
BEGIN;
CREATE FUNCTION private.composition_group_depth(p_document jsonb,p_group text)
RETURNS integer LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE current_id text := p_group; parent_id text; depth integer := 1;
BEGIN
  LOOP
    SELECT g->>'id' INTO parent_id FROM jsonb_array_elements(coalesce(p_document->'groups','[]')) g WHERE coalesce(g->'childGroupIds','[]') ? current_id;
    EXIT WHEN parent_id IS NULL;
    depth := depth+1; IF depth>8 THEN RAISE EXCEPTION 'COMPOSITION_GROUP_DEPTH_OR_CYCLE'; END IF;
    current_id := parent_id;
  END LOOP;
  RETURN depth;
END $$;
REVOKE ALL ON FUNCTION private.composition_group_depth(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION private.narrative_fragment_selected_clips(p_document jsonb,p_plan jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  candidates jsonb; ordered_candidates jsonb; clip jsonb; track jsonb; anchor jsonb; group_entry jsonb;
  avatar jsonb; voice jsonb; avatars jsonb; voices jsonb; interval_start numeric; interval_end numeric;
  tolerance CONSTANT numeric := 0.000001;
BEGIN
  PERFORM private.assert_composition_group_graph(p_document);
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
    IF EXISTS(SELECT 1 FROM unnest(private.composition_group_leaves(p_document,group_entry->>'id')) AS m(value) WHERE p_plan->'candidateClipIds' ? m.value)
      AND EXISTS(SELECT 1 FROM unnest(private.composition_group_leaves(p_document,group_entry->>'id')) AS m(value) WHERE NOT (p_plan->'candidateClipIds' ? m.value))
      THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_GROUP_INCOMPLETE'; END IF;
  END LOOP;
  RETURN ordered_candidates;
END $$;
REVOKE ALL ON FUNCTION private.narrative_fragment_selected_clips(jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION private.narrative_fragment_document_delta(p_original jsonb,p_plan jsonb,p_proposed jsonb,p_command uuid)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  candidates jsonb; retained jsonb := '[]'::jsonb; added jsonb := '[]'::jsonb; expected jsonb;
  copies jsonb := '[]'::jsonb; groups jsonb; group_copy jsonb; members jsonb;
  candidate record; original_clip jsonb; copied_clip jsonb; mapping jsonb; source_group jsonb; track jsonb;
  scene_map jsonb := '{}'::jsonb; linked_scene text; role text; asset_duration bigint;
  start_seconds numeric; end_seconds numeric; destination numeric; destination_end numeric;
  group_ids jsonb; copied_children jsonb; source_ordinal integer; copied_count integer := 0; group_ordinal integer := 0; group_order integer; pair_avatar_count integer; pair_voice_count integer;
BEGIN
  candidates := private.narrative_fragment_selected_clips(p_original,p_plan);
  start_seconds := (p_plan->>'sourceStartSeconds')::numeric; end_seconds := (p_plan->>'sourceEndSeconds')::numeric;
  destination := (p_original#>>'{canvas,durationSeconds}')::numeric; destination_end := (p_plan->>'destinationEndSeconds')::numeric;
  IF p_command IS NULL OR p_proposed IS NULL OR destination IS NULL OR destination_end IS NULL
    OR (p_plan->>'destinationStartSeconds')::numeric IS DISTINCT FROM destination
    OR abs(destination_end-destination-(end_seconds-start_seconds))>0.000001
    OR jsonb_typeof(p_plan->'copies') IS DISTINCT FROM 'array' OR jsonb_array_length(p_plan->'copies') NOT BETWEEN 2 AND 48
    OR jsonb_typeof(p_proposed->'clips') IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_proposed->'clips')<>(SELECT count(DISTINCT c->>'id') FROM jsonb_array_elements(p_proposed->'clips') c)
    OR jsonb_array_length(p_proposed->'clips')<>(SELECT count(DISTINCT c->>'hfId') FROM jsonb_array_elements(p_proposed->'clips') c)
    THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_DOCUMENT_INVALID'; END IF;
  FOR candidate IN SELECT value,ordinality FROM jsonb_array_elements(candidates) WITH ORDINALITY LOOP
    original_clip := candidate.value;
    SELECT m INTO mapping FROM jsonb_array_elements(p_plan->'copies') m WHERE m->>'sourceClipId'=original_clip->>'id';
    SELECT c INTO copied_clip FROM jsonb_array_elements(p_proposed->'clips') c WHERE c->>'id'=mapping->>'newClipId';
    IF mapping IS NULL THEN
      IF original_clip#>>'{source,type}'='NATIVE_CAPTIONS' AND private.validate_narrative_fragment_caption(original_clip->'source',NULL,
        greatest(start_seconds,(original_clip->>'startSeconds')::numeric)-(original_clip->>'startSeconds')::numeric,
        least(end_seconds,(original_clip->>'startSeconds')::numeric+(original_clip->>'durationSeconds')::numeric)-(original_clip->>'startSeconds')::numeric,
        p_command,(candidate.ordinality-1)::integer) THEN CONTINUE; END IF;
      RAISE EXCEPTION 'NARRATIVE_FRAGMENT_COPY_MISSING';
    END IF;
    IF copied_clip IS NULL OR mapping IS DISTINCT FROM jsonb_build_object('sourceClipId',original_clip->>'id',
      'newClipId',copied_clip->>'id','newHfId',copied_clip->>'hfId')
      OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_original->'clips') c
        WHERE c->>'id'=copied_clip->>'id' OR c->>'hfId'=copied_clip->>'hfId')
      THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_COPY_IDENTITY_INVALID'; END IF;
    linked_scene := NULL;
    SELECT t INTO track FROM jsonb_array_elements(p_original->'tracks') t WHERE t->>'id'=original_clip->>'trackId';
    role := track->>'semanticRole';
    IF original_clip->>'sceneId' IS NOT NULL AND (role='AVATAR' OR (role='VOICE' AND original_clip->>'kind'='AUDIO')) THEN
      SELECT count(*) FILTER(WHERE t->>'semanticRole'='AVATAR'),count(*) FILTER(WHERE t->>'semanticRole'='VOICE' AND c->>'kind'='AUDIO')
        INTO pair_avatar_count,pair_voice_count FROM jsonb_array_elements(p_original->'clips') c
        JOIN jsonb_array_elements(p_original->'tracks') t ON t->>'id'=c->>'trackId' WHERE c->>'sceneId'=original_clip->>'sceneId';
      IF pair_avatar_count=1 AND pair_voice_count=1 THEN
        linked_scene := scene_map->>(original_clip->>'sceneId');
        IF linked_scene IS NULL THEN
          linked_scene := 'fragment-scene-'||p_command::text||'-'||(SELECT count(*) FROM jsonb_object_keys(scene_map))::text;
          scene_map := scene_map||jsonb_build_object(original_clip->>'sceneId',linked_scene);
        END IF;
        IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_original->'clips') c WHERE c->>'sceneId'=linked_scene)
          OR EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(p_original->'narrativeScenes','[]'::jsonb)) s WHERE s->>'id'=linked_scene)
          THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_SCENE_COLLISION'; END IF;
      END IF;
    END IF;
    SELECT (a->>'durationMilliseconds')::bigint INTO asset_duration FROM jsonb_array_elements(p_plan->'assets') a
      WHERE a->>'assetId'=original_clip#>>'{source,productionAssetId}';
    IF NOT private.validate_narrative_fragment_clip(original_clip,copied_clip,start_seconds,end_seconds,destination,p_command,
      (candidate.ordinality-1)::integer,original_clip->>'id'=p_plan#>>'{anchor,sourceClipId}',asset_duration,linked_scene)
      THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_COPY_DELTA_INVALID'; END IF;
    retained := retained||jsonb_build_array(original_clip); added := added||jsonb_build_array(copied_clip); copies := copies||jsonb_build_array(mapping);
  END LOOP;
  IF copies IS DISTINCT FROM p_plan->'copies' THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_COPY_SET_INVALID'; END IF;
  expected := jsonb_set(jsonb_set(jsonb_set(p_original,'{canvas,durationSeconds}',to_jsonb(destination_end)),
    '{canvas,durationMode}','"USER_EDITED"'::jsonb),'{clips}',(p_original->'clips')||added);
  SELECT coalesce(jsonb_agg(jsonb_set(g,'{order}',to_jsonb((ordinality-1)::integer)) ORDER BY ordinality),'[]') INTO groups
    FROM (SELECT g,row_number() OVER (ORDER BY (g->>'order')::integer,g->>'id') ordinality FROM jsonb_array_elements(coalesce(p_original->'groups','[]')) g) ordered;
  SELECT coalesce(jsonb_object_agg(id,'fragment-group-'||p_command::text||'-'||ordinal::text),'{}') INTO group_ids
    FROM (SELECT g->>'id' id,row_number() OVER(ORDER BY (g->>'order')::integer,g->>'id')-1 ordinal
      FROM jsonb_array_elements(groups) g WHERE private.composition_group_leaves(p_original,g->>'id') && ARRAY(SELECT jsonb_array_elements_text(p_plan->'candidateClipIds'))) selected;
  group_order := jsonb_array_length(groups)-1;
  FOR source_group IN SELECT g FROM jsonb_array_elements(groups) g WHERE group_ids ? (g->>'id')
    ORDER BY private.composition_group_depth(p_original,g->>'id') DESC,(g->>'order')::integer,g->>'id' LOOP
    SELECT coalesce(jsonb_agg(to_jsonb(c->>'newClipId') ORDER BY member.ordinality),'[]') INTO members
      FROM jsonb_array_elements_text(source_group->'clipIds') WITH ORDINALITY member(value,ordinality)
      JOIN jsonb_array_elements(copies) c ON c->>'sourceClipId'=member.value;
    IF jsonb_array_length(members)<>jsonb_array_length(source_group->'clipIds') THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_GROUP_COPY_INCOMPLETE'; END IF;
    SELECT coalesce(jsonb_agg(group_ids->member.value ORDER BY member.ordinality),'[]') INTO copied_children
      FROM jsonb_array_elements_text(coalesce(source_group->'childGroupIds','[]')) WITH ORDINALITY member(value,ordinality);
    group_order := group_order+1;
    group_copy := jsonb_build_object('id',group_ids->>(source_group->>'id'),'clipIds',members,'order',group_order,
      'label',CASE WHEN coalesce(source_group->>'label','')<>'' THEN left(source_group->>'label',50)||' · fragmento' ELSE 'Fragmento extraído' END);
    IF jsonb_array_length(copied_children)>0 THEN group_copy := group_copy||jsonb_build_object('childGroupIds',copied_children); END IF;
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(groups) g WHERE g->>'id'=group_copy->>'id') THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_GROUP_COLLISION'; END IF;
    groups := groups||jsonb_build_array(group_copy); copied_count := copied_count+1;
  END LOOP;
  IF copied_count>0 THEN expected := jsonb_set(expected,'{groups}',groups); END IF;
  PERFORM private.assert_composition_group_graph(expected);
  -- Exact full-document equality forbids dropping originals or retargeting any HTML/narrative reference.
  IF p_proposed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_APPEND_DELTA_INVALID'; END IF;
  RETURN retained;
END $$;
REVOKE ALL ON FUNCTION private.narrative_fragment_document_delta(jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;

CREATE FUNCTION public.composition_grouping_capabilities()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('groupingVersion',2,'maxDepth',8,'contract','nested-composition-groups-v2')
$$;
REVOKE ALL ON FUNCTION public.composition_grouping_capabilities() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.composition_grouping_capabilities() TO service_role;
COMMIT;
