-- Agrupaciones editoriales: validación transversal y contrato de capacidad.
BEGIN;
CREATE SCHEMA IF NOT EXISTS private;

CREATE FUNCTION private.composition_group_leaves(p_document jsonb, p_group text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  WITH RECURSIVE descendants(id,path) AS (
    SELECT p_group, ARRAY[p_group]
    UNION ALL
    SELECT child.value, d.path || child.value
    FROM descendants d
    JOIN jsonb_array_elements(coalesce(p_document->'groups','[]')) g ON g->>'id'=d.id
    CROSS JOIN LATERAL jsonb_array_elements_text(coalesce(g->'childGroupIds','[]')) child
    WHERE NOT child.value=ANY(d.path) AND cardinality(d.path)<8
  )
  SELECT coalesce(array_agg(member.value ORDER BY d.path,member.ordinality),'{}'::text[])
  FROM descendants d
  JOIN jsonb_array_elements(coalesce(p_document->'groups','[]')) g ON g->>'id'=d.id
  CROSS JOIN LATERAL jsonb_array_elements_text(g->'clipIds') WITH ORDINALITY member(value,ordinality)
$$;

CREATE FUNCTION private.assert_composition_group_graph(p_document jsonb)
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
      OR (SELECT count(*) FROM jsonb_object_keys(g) k WHERE k NOT IN ('id','clipIds','childGroupIds','label','order'))>0 THEN
      RAISE EXCEPTION 'COMPOSITION_GROUP_GRAPH_INVALID' USING ERRCODE='22023';
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

CREATE FUNCTION private.guard_composition_group_insert()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public AS $$
DECLARE prior jsonb;
BEGIN
  -- Mismo orden de lock que append; NOWAIT evita colas de escrituras directas.
  PERFORM 1 FROM public.video_composition_drafts WHERE id=NEW.draft_id
    AND organization_id=NEW.organization_id FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'COMPOSITION_DRAFT_NOT_FOUND'; END IF;
  SELECT document INTO prior FROM public.video_composition_draft_documents
    WHERE draft_id=NEW.draft_id AND organization_id=NEW.organization_id ORDER BY version DESC LIMIT 1;
  IF prior->'groupingVersion'='2'::jsonb AND NEW.document->'groupingVersion' IS DISTINCT FROM '2'::jsonb THEN
    RAISE EXCEPTION 'COMPOSITION_GROUPING_DOWNGRADE' USING ERRCODE='22023';
  END IF;
  PERFORM private.assert_composition_group_graph(NEW.document);
  RETURN NEW;
END $$;
CREATE TRIGGER composition_group_insert_guard BEFORE INSERT ON public.video_composition_draft_documents
  FOR EACH ROW EXECUTE FUNCTION private.guard_composition_group_insert();

REVOKE ALL ON FUNCTION private.composition_group_leaves(jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.assert_composition_group_graph(jsonb) FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION private.guard_composition_group_insert() FROM PUBLIC,anon,authenticated,service_role;
COMMIT;
