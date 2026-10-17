-- Prepared only; do not apply or activate selected-reference workers without coordinated rollout.
-- Existing identity keys and legacy RPCs remain intact. The optional checksum creates a distinct
-- immutable identity for each exact reference, so changing references cannot resume an old packet.
CREATE FUNCTION public.record_hyperframes_selected_event_batch_measurement(
  p_identity jsonb, p_packet jsonb, p_packet_sha256 text, p_visual_sha256 text
) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  IF jsonb_typeof(p_identity) IS DISTINCT FROM 'object' OR octet_length(p_identity::text) > 2048
    OR p_visual_sha256 IS NULL OR p_visual_sha256 !~ '^[a-f0-9]{64}$'
    OR p_identity->>'visualReferenceSha256' IS DISTINCT FROM p_visual_sha256 THEN
    RAISE EXCEPTION 'CONFORMANCE_EVENT_PACKET_REFERENCE_MISMATCH';
  END IF;
  -- Existing writer performs revision, tenant, lineage, FK and immutable packet checks atomically.
  RETURN public.record_hyperframes_event_batch_measurement(p_identity, p_packet, p_packet_sha256, p_visual_sha256);
END;
$$;
REVOKE ALL ON FUNCTION public.record_hyperframes_selected_event_batch_measurement(jsonb,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_hyperframes_selected_event_batch_measurement(jsonb,jsonb,text,text) TO service_role;

CREATE FUNCTION public.read_hyperframes_selected_event_batch_measurement(p_identity jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  IF jsonb_typeof(p_identity) IS DISTINCT FROM 'object' OR octet_length(p_identity::text) > 2048
    OR p_identity->>'visualReferenceSha256' IS NULL
    OR (p_identity->>'visualReferenceSha256') !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'CONFORMANCE_EVENT_PACKET_REFERENCE_INVALID';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM private.hyperframes_event_batch_measurements e
    WHERE e.identity = p_identity AND e.visual_sha256 = p_identity->>'visualReferenceSha256') THEN
    RETURN NULL;
  END IF;
  -- The legacy scoped reader still authorizes revision, organization, frozen contract and lineage.
  RETURN public.read_hyperframes_event_batch_measurement(p_identity);
END;
$$;
REVOKE ALL ON FUNCTION public.read_hyperframes_selected_event_batch_measurement(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.read_hyperframes_selected_event_batch_measurement(jsonb) TO service_role;

-- Rollback: stop selected-reference workers, then drop only these two new RPCs.
-- Do not delete measurements or Storage objects; legacy identities and readers remain unchanged.

-- Preserve the installed verifier's accumulated gates. Patch its one exact PK construction site,
-- failing closed if the expected definition has changed; never replace it with a weaker verifier.
DO $$
DECLARE v_definition text; v_anchor text := '    -- Exact identity lookup uses the packet primary key, not an unindexed JSON scan.';
  v_insert text := E'    IF v_batch ? ''visualReferenceSha256'' THEN\n'
    || E'      IF v_batch->>''visualReferenceSha256'' IS NULL OR (v_batch->>''visualReferenceSha256'') !~ ''^[a-f0-9]{64}$'' THEN RETURN false; END IF;\n'
    || E'      v_identity := v_identity || jsonb_build_object(''visualReferenceSha256'', v_batch->>''visualReferenceSha256'');\n'
    || E'    END IF;\n';
BEGIN
  v_definition := pg_get_functiondef('private.verify_hyperframes_event_summary(uuid,uuid,text,jsonb)'::regprocedure);
  IF strpos(v_definition, v_anchor) = 0
    OR strpos(substr(v_definition, strpos(v_definition, v_anchor) + length(v_anchor)), v_anchor) > 0
    OR strpos(v_definition, 'visualReferenceSha256') > 0 THEN
    RAISE EXCEPTION 'CONFORMANCE_EVENT_VERIFIER_MIGRATION_PRECONDITION_INVALID';
  END IF;
  EXECUTE replace(v_definition, v_anchor, v_insert || v_anchor);
END;
$$;
-- Rollback also restores the prior event verifier definition from the versioned prerequisite migration.
