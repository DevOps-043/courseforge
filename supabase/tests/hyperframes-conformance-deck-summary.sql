-- Run only against an isolated database after the prepared conformance migrations.
-- Exercises the pure deck predicate without inserting jobs or touching production data.
DO $$
DECLARE
  v_hash text := repeat('a', 64);
  v_contract jsonb;
  v_report jsonb;
BEGIN
  v_contract := jsonb_build_object(
    'schemaVersion', 4,
    'checkpoints', jsonb_build_array(jsonb_build_object('timeSeconds', 0.5), jsonb_build_object('timeSeconds', 2)),
    'deckTextPlan', jsonb_build_object('policy', 'SOURCE_HTML_TEXT_NODE_PATHS_V1', 'documentHash', v_hash,
      'clips', jsonb_build_array(jsonb_build_object('window', jsonb_build_object('startSeconds', 0, 'endSeconds', 1, 'excluded', false),
        'entries', jsonb_build_array(jsonb_build_object('nodePath', jsonb_build_array(0)), jsonb_build_object('nodePath', jsonb_build_array(1)))))));
  v_report := jsonb_build_object('status', 'INCOMPLETE', 'comparison', jsonb_build_object('visual', jsonb_build_object(
    'status', 'INCOMPLETE', 'incompletenessReasons', jsonb_build_array('DECK_TEXT_EVIDENCE_INCOMPLETE'),
    'deckText', jsonb_build_object('policy', 'SOURCE_HTML_TEXT_NODE_PATHS_V1',
      'scope', 'DECK_SOURCE_TEXT_REGIONS_NOT_RENDER_FONT_ATTESTATION', 'status', 'INCOMPLETE',
      'requiredCheckpointCount', 2, 'checkedCheckpointCount', 1, 'checkedRegionCount', 2, 'expectedRegionCount', 2))));
  IF NOT private.verify_hyperframes_deck_summary(v_contract, v_hash, v_report) THEN RAISE EXCEPTION 'valid deck summary rejected'; END IF;
  IF private.verify_hyperframes_deck_summary(v_contract, repeat('b', 64), v_report) THEN RAISE EXCEPTION 'foreign document accepted'; END IF;
  IF private.verify_hyperframes_deck_summary(v_contract, v_hash,
    jsonb_set(v_report, '{comparison,visual,deckText,expectedRegionCount}', '3'::jsonb)) THEN
    RAISE EXCEPTION 'wrong region count accepted'; END IF;
  IF private.verify_hyperframes_deck_summary(v_contract, v_hash, jsonb_set(v_report, '{status}', '"PASS"'::jsonb)) THEN
    RAISE EXCEPTION 'premature global PASS accepted'; END IF;
  IF private.verify_hyperframes_deck_summary(v_contract, v_hash,
    jsonb_set(v_report, '{comparison,visual,incompletenessReasons}', '[]'::jsonb)) THEN
    RAISE EXCEPTION 'missing deck incompleteness accepted'; END IF;
  IF private.verify_hyperframes_deck_summary(v_contract - 'deckTextPlan', v_hash, v_report) THEN
    RAISE EXCEPTION 'unauthorized deck summary accepted'; END IF;
  IF NOT private.verify_hyperframes_deck_summary(v_contract - 'deckTextPlan', v_hash,
    jsonb_set(v_report, '{comparison,visual}', (v_report#>'{comparison,visual}') - 'deckText')) THEN
    RAISE EXCEPTION 'non-deck report rejected'; END IF;
END;
$$;
