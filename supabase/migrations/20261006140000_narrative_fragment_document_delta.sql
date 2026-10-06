-- PREPARED ONLY. Full append-only document delta; no persistence or public RPC.
BEGIN;
CREATE FUNCTION private.narrative_fragment_document_delta(p_original jsonb,p_plan jsonb,p_proposed jsonb,p_command uuid)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE
  candidates jsonb; retained jsonb := '[]'::jsonb; added jsonb := '[]'::jsonb; expected jsonb;
  copies jsonb := '[]'::jsonb; groups jsonb; group_copy jsonb; members jsonb;
  candidate record; original_clip jsonb; copied_clip jsonb; mapping jsonb; source_group jsonb; track jsonb;
  scene_map jsonb := '{}'::jsonb; linked_scene text; role text; asset_duration bigint;
  start_seconds numeric; end_seconds numeric; destination numeric; destination_end numeric;
  group_ordinal integer := 0; group_order integer; pair_avatar_count integer; pair_voice_count integer;
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
  groups := coalesce(p_original->'groups','[]'::jsonb);
  SELECT coalesce(max((g->>'order')::integer),-1) INTO group_order FROM jsonb_array_elements(groups) g;
  FOR source_group IN SELECT g FROM jsonb_array_elements(groups) g LOOP
    IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(source_group->'clipIds') m WHERE p_plan->'candidateClipIds' ? m.value) THEN CONTINUE; END IF;
    SELECT coalesce(jsonb_agg(to_jsonb(c->>'newClipId') ORDER BY member.ordinality),'[]'::jsonb) INTO members
      FROM jsonb_array_elements_text(source_group->'clipIds') WITH ORDINALITY member(value,ordinality)
      JOIN jsonb_array_elements(copies) c ON c->>'sourceClipId'=member.value;
    IF jsonb_array_length(members)<>jsonb_array_length(source_group->'clipIds') THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_GROUP_COPY_INCOMPLETE'; END IF;
    group_order := group_order+1;
    group_copy := jsonb_build_object('id','fragment-group-'||p_command::text||'-'||group_ordinal::text,
      'clipIds',members,'order',group_order,'label',CASE WHEN coalesce(source_group->>'label','')<>''
        THEN left(source_group->>'label',50)||' · fragmento' ELSE 'Fragmento extraído' END);
    IF EXISTS(SELECT 1 FROM jsonb_array_elements(groups) g WHERE g->>'id'=group_copy->>'id') THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_GROUP_COLLISION'; END IF;
    groups := groups||jsonb_build_array(group_copy); group_ordinal := group_ordinal+1;
  END LOOP;
  IF group_ordinal>0 THEN expected := jsonb_set(expected,'{groups}',groups); END IF;
  -- Exact full-document equality forbids dropping originals or retargeting any HTML/narrative reference.
  IF p_proposed IS DISTINCT FROM expected THEN RAISE EXCEPTION 'NARRATIVE_FRAGMENT_APPEND_DELTA_INVALID'; END IF;
  RETURN retained;
END $$;
REVOKE ALL ON FUNCTION private.narrative_fragment_document_delta(jsonb,jsonb,jsonb,uuid) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
