  -- Anidación editorial: conserva el grafo y los contratos de extracción narrativa.
  BEGIN;
  CREATE OR REPLACE FUNCTION private.assert_composition_group_graph(p_document jsonb)
  RETURNS void LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
  DECLARE
    groups jsonb := coalesce(p_document->'groups','[]');
    g jsonb; member jsonb; id text; child text; child_ids text[] := '{}';
    claimed_clips text[] := '{}'; group_ids text[] := '{}'; orders integer[] := '{}';
    clip_ids text[]; current_id text; path text[]; parent_id text; group_order integer;
  BEGIN
    IF p_document ? 'groupingVersion' AND p_document->'groupingVersion' IS DISTINCT FROM '2'::jsonb THEN
      RAISE EXCEPTION 'COMPOSITION_GROUP_VERSION_INVALID' USING ERRCODE='22023';
    END IF;
    IF jsonb_typeof(groups) IS DISTINCT FROM 'array' OR jsonb_array_length(groups)>250
      OR jsonb_typeof(p_document->'clips') IS DISTINCT FROM 'array' OR jsonb_array_length(p_document->'clips')>500 THEN
      RAISE EXCEPTION 'COMPOSITION_GROUP_GRAPH_INVALID' USING ERRCODE='22023';
    END IF;
    SELECT coalesce(array_agg(c->>'id'),'{}') INTO clip_ids FROM jsonb_array_elements(p_document->'clips') c;
    FOR g IN SELECT value FROM jsonb_array_elements(groups) LOOP
      id := g->>'id';
      IF jsonb_typeof(g) IS DISTINCT FROM 'object' OR id IS NULL OR id !~* '^[a-z][a-z0-9-]{0,127}$'
        OR id=ANY(group_ids) OR jsonb_typeof(g->'clipIds') IS DISTINCT FROM 'array'
        OR (g ? 'childGroupIds' AND (p_document->'groupingVersion' IS DISTINCT FROM '2'::jsonb OR jsonb_typeof(g->'childGroupIds') IS DISTINCT FROM 'array'))
        OR (SELECT count(*) FROM jsonb_object_keys(g) k WHERE k NOT IN ('id','clipIds','childGroupIds','label','order','timelineMode'))>0 THEN
        RAISE EXCEPTION 'COMPOSITION_GROUP_GRAPH_INVALID' USING ERRCODE='22023';
      END IF;
      IF g ? 'timelineMode' AND (g->'timelineMode' IS DISTINCT FROM '"NESTED"'::jsonb OR p_document->'groupingVersion' IS DISTINCT FROM '2'::jsonb) THEN
        RAISE EXCEPTION 'COMPOSITION_TIMELINE_MODE_INVALID' USING ERRCODE='22023';
      END IF;
      IF jsonb_typeof(g->'order') IS DISTINCT FROM 'number' OR (g->>'order') !~ '^\d+$' THEN
        RAISE EXCEPTION 'COMPOSITION_GROUP_ORDER_INVALID' USING ERRCODE='22023';
      END IF;
      group_order := (g->>'order')::integer;
      IF group_order<0 OR group_order>499 OR group_order=ANY(orders)
        OR jsonb_array_length(g->'clipIds')+jsonb_array_length(coalesce(g->'childGroupIds','[]')) NOT BETWEEN 2 AND 500
        OR jsonb_array_length(coalesce(g->'childGroupIds','[]'))>250
        OR (g ? 'label' AND (jsonb_typeof(g->'label') IS DISTINCT FROM 'string' OR length(btrim(g->>'label')) NOT BETWEEN 1 AND 120)) THEN
        RAISE EXCEPTION 'COMPOSITION_GROUP_GRAPH_INVALID' USING ERRCODE='22023';
      END IF;
      group_ids := array_append(group_ids,id); orders := array_append(orders,group_order);
      FOR member IN SELECT value FROM jsonb_array_elements(g->'clipIds') LOOP
        child := member#>>'{}';
        IF jsonb_typeof(member) IS DISTINCT FROM 'string' OR NOT child=ANY(clip_ids) OR child=ANY(claimed_clips) THEN
          RAISE EXCEPTION 'COMPOSITION_GROUP_MEMBERSHIP_INVALID' USING ERRCODE='22023';
        END IF;
        claimed_clips := array_append(claimed_clips,child);
      END LOOP;
      FOR member IN SELECT value FROM jsonb_array_elements(coalesce(g->'childGroupIds','[]')) LOOP
        child := member#>>'{}';
        IF jsonb_typeof(member) IS DISTINCT FROM 'string' OR child=ANY(child_ids) THEN
          RAISE EXCEPTION 'COMPOSITION_GROUP_PARENT_INVALID' USING ERRCODE='22023';
        END IF;
        child_ids := array_append(child_ids,child);
      END LOOP;
    END LOOP;
    IF NOT child_ids <@ group_ids THEN RAISE EXCEPTION 'COMPOSITION_GROUP_MISSING' USING ERRCODE='22023'; END IF;
    FOREACH id IN ARRAY group_ids LOOP
      current_id := id; path := ARRAY[id];
      LOOP
        SELECT candidate->>'id' INTO parent_id FROM jsonb_array_elements(groups) candidate
          WHERE coalesce(candidate->'childGroupIds','[]') ? current_id;
        EXIT WHEN parent_id IS NULL;
        IF parent_id=ANY(path) OR cardinality(path)>=8 THEN
          RAISE EXCEPTION 'COMPOSITION_GROUP_DEPTH_OR_CYCLE' USING ERRCODE='22023';
        END IF;
        path := array_append(path,parent_id); current_id := parent_id;
      END LOOP;
    END LOOP;
  END $$;

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
      IF source_group ? 'timelineMode' THEN group_copy := group_copy||jsonb_build_object('timelineMode',source_group->'timelineMode'); END IF;
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

  CREATE OR REPLACE FUNCTION public.composition_grouping_capabilities()
  RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('groupingVersion',2,'maxDepth',8,'contract','nested-composition-groups-v2','timelineNesting',true)
  $$;
  COMMIT;
