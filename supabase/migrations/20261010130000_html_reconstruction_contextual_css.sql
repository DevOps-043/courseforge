-- PREPARED ONLY. Apply after reconstruction candidates/creation/opening.
-- V3 shared host compiler validates/scopes contextual static CSS in BOTH targets.
-- SQL keeps all existing identity/resource/review checks; it does not parse CSS.
-- Existing migrations remain immutable for already-applied environments.
BEGIN;
CREATE OR REPLACE FUNCTION private.validate_html_reconstruction_candidate(p_org uuid,p_actor uuid,p_staging jsonb,p_candidate jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog,public,private AS $$
DECLARE content jsonb; proposed jsonb; document jsonb; manifest jsonb; archive jsonb; locator jsonb;
  initial jsonb; revision jsonb; binding jsonb; pointer jsonb; clip jsonb; grants jsonb; bindings jsonb;
BEGIN
  PERFORM private.assert_html_reconstruction_staging(p_org,p_actor,p_staging,true);
  IF jsonb_typeof(p_candidate) IS DISTINCT FROM 'object' OR octet_length(p_candidate::text) > 16777216
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_INVALID'; END IF;
  content := p_candidate->'content'; proposed := content->'candidate'; document := proposed->'document';
  manifest := p_candidate#>'{registration,manifest}'; archive := p_candidate#>'{registration,archive}'; locator := p_staging#>'{review,locator}';
  IF p_candidate->>'scope' IS DISTINCT FROM 'RECONSTRUCTION_CANDIDATE_NOT_CREATED_OR_PUBLISHED'
    OR p_candidate->'review' IS DISTINCT FROM p_staging->'review'
    OR p_candidate->>'candidateSha256' IS DISTINCT FROM p_staging->>'candidateSha256'
    OR content->>'scope' IS DISTINCT FROM 'PREPARED_RECONSTRUCTED_ARCHIVE_NOT_APPROVED_CREATED_OR_PUBLISHED'
    OR proposed->>'scope' IS DISTINCT FROM 'PREPARED_NEW_CONTENT_NOT_HISTORICAL_REPUBLICATION_OR_APPROVAL'
    OR proposed->'origin' IS DISTINCT FROM p_staging#>'{review,origin}'
    OR proposed->'requiredReviews' IS DISTINCT FROM p_staging#>'{review,approval,completedReviews}'
    OR proposed#>>'{target,compositionId}' IS DISTINCT FROM locator->>'targetCompositionId'
    OR proposed#>>'{target,documentId}' IS DISTINCT FROM locator->>'targetDocumentId'
    OR proposed#>>'{target,revisionId}' IS DISTINCT FROM locator->>'targetRevisionId'
    OR document->>'format' IS DISTINCT FROM 'courseforge-composition-v4'
    OR (document->'deckStyles' IS DISTINCT FROM 'null'::jsonb AND (
      jsonb_typeof(document->'deckStyles') IS DISTINCT FROM 'object'
      OR jsonb_typeof(document#>'{deckStyles,css}') IS DISTINCT FROM 'string'
      OR octet_length(document#>>'{deckStyles,css}') > 256000
      OR document#>'{deckStyles,fontUrls}' IS DISTINCT FROM '[]'::jsonb))
    OR coalesce(proposed->>'documentHash','') !~ '^[a-f0-9]{64}$'
    OR content#>>'{prepared,documentHash}' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest->>'draft_document_hash' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest->>'draft_document_id' IS DISTINCT FROM locator->>'targetDocumentId'
    OR manifest->'snapshot' IS DISTINCT FROM 'true'::jsonb
    OR manifest->'conformance_contract_version' IS DISTINCT FROM '4'::jsonb
    OR manifest#>>'{conformance_contract,schemaVersion}' IS DISTINCT FROM '4'
    OR manifest#>>'{conformance_contract,documentHash}' IS DISTINCT FROM proposed->>'documentHash'
    OR manifest#>>'{conformance_contract,renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR content#>>'{prepared,projectHash}' IS DISTINCT FROM locator->>'projectHash'
    OR archive->>'projectHash' IS DISTINCT FROM locator->>'projectHash'
    OR archive->>'sizeBytes' IS DISTINCT FROM p_staging->>'archiveSizeBytes'
    OR archive->>'storageBucket' IS DISTINCT FROM 'production-assets'
    OR archive->>'storagePath' IS DISTINCT FROM 'composition-snapshots/'||p_org::text||'/'||
      (locator->>'targetCompositionId')||'/'||(locator->>'projectHash')||'.zip'
    OR manifest->'asset_manifest' IS DISTINCT FROM content#>'{prepared,assets}'
    OR manifest->'font_manifest' IS DISTINCT FROM content#>'{prepared,fontManifest}'
    OR manifest->'conformance_contract' IS DISTINCT FROM content#>'{prepared,contract}'
    OR manifest->'conformance_reference' IS DISTINCT FROM content#>'{prepared,metadata}'
    OR manifest->'html_editing_snapshot' IS DISTINCT FROM content#>'{prepared,metadata,htmlEditingSnapshot}'
    OR manifest#>>'{html_editing_snapshot,sha256}' IS DISTINCT FROM content#>>'{prepared,bundle,sha256}'
    OR manifest#>>'{html_editing_snapshot,path}' IS DISTINCT FROM 'html-editing-revisions.json'
    OR jsonb_typeof(document->'clips') IS DISTINCT FROM 'array'
    OR jsonb_typeof(document#>'{htmlEditing,items}') IS DISTINCT FROM 'array'
    OR jsonb_typeof(proposed->'initialRevisions') IS DISTINCT FROM 'array'
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_CANDIDATE_INVALID'; END IF;
  IF jsonb_array_length(proposed->'initialRevisions') NOT BETWEEN 1 AND 200
    OR jsonb_array_length(proposed->'initialRevisions') <> jsonb_array_length(document#>'{htmlEditing,items}')
    OR jsonb_array_length(proposed->'initialRevisions') <> (SELECT count(DISTINCT e->>'clipId') FROM jsonb_array_elements(proposed->'initialRevisions') e)
    OR jsonb_array_length(proposed->'initialRevisions') <> (SELECT count(*) FROM jsonb_array_elements(document->'clips') c WHERE c#>>'{source,type}' = 'DECK_SLIDE')
    THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_POINTERS_INVALID'; END IF;
  bindings := private.html_snapshot_resource_bindings(p_org,(locator->>'sourceDraftId')::uuid,manifest->'asset_manifest',manifest->'font_manifest');
  FOR initial IN SELECT e FROM jsonb_array_elements(proposed->'initialRevisions') e LOOP
    revision := initial->'revision'; binding := revision#>'{manifest,binding}';
    SELECT e INTO pointer FROM jsonb_array_elements(document#>'{htmlEditing,items}') e WHERE e->>'clipId' = initial->>'clipId';
    SELECT e INTO clip FROM jsonb_array_elements(document->'clips') e WHERE e->>'id' = initial->>'clipId';
    IF pointer IS NULL OR clip IS NULL OR clip->>'kind' IS DISTINCT FROM 'DECK_SLIDE'
      OR clip#>>'{source,html}' IS DISTINCT FROM revision->>'sourceHtml'
      OR revision->>'format' IS DISTINCT FROM 'courseforge-html-editable-revision-v1'
      OR revision->'version' IS DISTINCT FROM '1'::jsonb OR revision#>'{state,overrides}' IS DISTINCT FROM '[]'::jsonb
      OR revision#>'{state,binding}' IS DISTINCT FROM binding OR octet_length(revision::text) > 1048576
      OR binding->>'organizationId' IS DISTINCT FROM p_org::text
      OR binding->>'documentId' IS DISTINCT FROM locator->>'targetDocumentId'
      OR binding->>'revisionId' IS DISTINCT FROM locator->>'targetRevisionId'
      OR binding->>'clipId' IS DISTINCT FROM initial->>'clipId'
      OR pointer->>'revisionSha256' IS DISTINCT FROM initial->>'revisionSha256'
      OR pointer->'revisionVersion' IS DISTINCT FROM '1'::jsonb
      OR pointer->>'templateId' IS DISTINCT FROM binding->>'templateId'
      OR pointer->'templateVersion' IS DISTINCT FROM binding->'templateVersion'
      OR pointer->>'sourceSha256' IS DISTINCT FROM binding->>'sourceSha256'
      OR pointer->>'manifestSha256' IS DISTINCT FROM binding->>'manifestSha256'
      OR jsonb_typeof(initial->'usedAssetIds') IS DISTINCT FROM 'array'
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_POINTERS_INVALID'; END IF;
    grants := private.html_editing_grants(p_org,(locator->>'sourceDraftId')::uuid,revision);
    IF EXISTS (SELECT 1 FROM jsonb_array_elements_text(initial->'usedAssetIds') used(id) WHERE NOT (grants ? used.id)
      OR NOT EXISTS (SELECT 1 FROM jsonb_array_elements(bindings) b WHERE b->>'productionAssetId' = used.id
        AND b->>'origin' = 'PRODUCTION' AND b->>'mimeType' IN ('image/png','image/jpeg','image/webp')))
      THEN RAISE EXCEPTION 'HTML_RECONSTRUCTION_HTML_GRANT_REVOKED'; END IF;
  END LOOP;
  RETURN bindings;
END $$;
REVOKE ALL ON FUNCTION private.validate_html_reconstruction_candidate(uuid,uuid,jsonb,jsonb) FROM PUBLIC,anon,authenticated,service_role;
COMMIT;

