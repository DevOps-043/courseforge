-- PREPARED ONLY: no backend selection, key provisioning, migration application or renderer activation.
-- service_role is the trusted host verifier. No browser/child renderer receives these credentials.
CREATE TABLE private.composition_render_supervisor_keys (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  supervisor_id text NOT NULL CHECK (supervisor_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  key_id text NOT NULL CHECK (key_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  public_key_spki_base64 text NOT NULL CHECK (length(public_key_spki_base64) BETWEEN 1 AND 1024
    AND public_key_spki_base64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  not_before_ms bigint NOT NULL CHECK (not_before_ms >= 0),
  not_after_ms bigint NOT NULL CHECK (not_after_ms > not_before_ms AND not_after_ms <= 9007199254740991),
  revoked boolean NOT NULL DEFAULT false,
  PRIMARY KEY (organization_id, supervisor_id, key_id)
);
ALTER TABLE private.composition_render_supervisor_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_render_supervisor_keys FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.guard_render_supervisor_key_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, private AS $$
BEGIN
  IF (NEW.organization_id,NEW.supervisor_id,NEW.key_id,NEW.public_key_spki_base64,NEW.not_before_ms,NEW.not_after_ms)
      IS DISTINCT FROM (OLD.organization_id,OLD.supervisor_id,OLD.key_id,OLD.public_key_spki_base64,OLD.not_before_ms,OLD.not_after_ms)
    OR (OLD.revoked AND NOT NEW.revoked) THEN
    RAISE EXCEPTION 'RENDER_AUTHORITY_KEY_IMMUTABLE';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.guard_render_supervisor_key_identity() FROM PUBLIC,anon,authenticated,service_role;
CREATE TRIGGER immutable_render_supervisor_key BEFORE UPDATE ON private.composition_render_supervisor_keys
  FOR EACH ROW EXECUTE FUNCTION private.guard_render_supervisor_key_identity();

CREATE TABLE private.composition_render_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES public.hyperframes_render_requests(id) ON DELETE CASCADE,
  revision_id uuid NOT NULL REFERENCES public.video_composition_revisions(id) ON DELETE RESTRICT,
  production_job_id uuid NOT NULL REFERENCES public.production_jobs(id) ON DELETE CASCADE,
  issuance_id uuid NOT NULL,
  supervisor_id text NOT NULL, key_id text NOT NULL,
  attempt integer NOT NULL CHECK (attempt BETWEEN 1 AND 5),
  lease_token uuid NOT NULL DEFAULT gen_random_uuid(),
  challenge_sha256 text NOT NULL UNIQUE CHECK (challenge_sha256 ~ '^[a-f0-9]{64}$'),
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  project_hash text NOT NULL CHECK (project_hash ~ '^[a-f0-9]{64}$'),
  contract_sha256 text NOT NULL CHECK (contract_sha256 ~ '^[a-f0-9]{64}$'),
  contract jsonb NOT NULL CHECK (jsonb_typeof(contract) = 'object' AND octet_length(contract::text) <= 1048576),
  artifact_kind text NOT NULL CHECK (artifact_kind IN ('SINGLE_CONTRACT','EVENT_BATCH_SET')),
  issued_at_ms bigint NOT NULL CHECK (issued_at_ms >= 0),
  expires_at_ms bigint NOT NULL CHECK (expires_at_ms > issued_at_ms AND expires_at_ms - issued_at_ms <= 600000),
  status text NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING','CONSUMED','EXPIRED','CANCELLED')),
  receipt jsonb, receipt_sha256 text CHECK (receipt_sha256 ~ '^[a-f0-9]{64}$'), consumed_at_ms bigint,
  FOREIGN KEY (organization_id, supervisor_id, key_id)
    REFERENCES private.composition_render_supervisor_keys(organization_id, supervisor_id, key_id),
  UNIQUE (organization_id, request_id, issuance_id), UNIQUE (request_id, attempt),
  CHECK ((status = 'CONSUMED' AND receipt IS NOT NULL AND receipt_sha256 IS NOT NULL AND consumed_at_ms IS NOT NULL)
    OR (status <> 'CONSUMED' AND receipt IS NULL AND receipt_sha256 IS NULL AND consumed_at_ms IS NULL)),
  CHECK (receipt IS NULL OR (jsonb_typeof(receipt) = 'object' AND octet_length(receipt::text) <= 8192))
);
ALTER TABLE private.composition_render_executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.composition_render_executions FROM PUBLIC, anon, authenticated, service_role;
CREATE UNIQUE INDEX composition_render_one_active ON private.composition_render_executions(request_id) WHERE status = 'RUNNING';

CREATE FUNCTION private.composition_render_execution_context(e private.composition_render_executions)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
  SELECT jsonb_build_object('organizationId', e.organization_id, 'requestId', e.request_id,
    'revisionId', e.revision_id, 'productionJobId', e.production_job_id, 'executionId', e.id,
    'attempt', e.attempt, 'leaseToken', e.lease_token, 'challengeSha256', e.challenge_sha256,
    'documentHash', e.document_hash, 'projectHash', e.project_hash, 'contractSha256', e.contract_sha256,
    'artifactKind', e.artifact_kind, 'supervisorId', e.supervisor_id, 'keyId', e.key_id,
    'issuedAtMilliseconds', e.issued_at_ms, 'expiresAtMilliseconds', e.expires_at_ms, 'contract', e.contract,
    'key', jsonb_build_object('publicKeySpkiBase64', k.public_key_spki_base64,
      'notBeforeMilliseconds', k.not_before_ms, 'notAfterMilliseconds', k.not_after_ms, 'revoked', k.revoked))
  FROM private.composition_render_supervisor_keys k WHERE k.organization_id = e.organization_id
    AND k.supervisor_id = e.supervisor_id AND k.key_id = e.key_id;
$$;
REVOKE ALL ON FUNCTION private.composition_render_execution_context(private.composition_render_executions)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.issue_composition_render_execution(p_organization_id uuid, p_request_id uuid,
  p_issuance_id uuid, p_supervisor_id text, p_key_id text, p_contract jsonb, p_contract_sha256 text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  r public.hyperframes_render_requests%ROWTYPE;
  v public.video_composition_revisions%ROWTYPE;
  k private.composition_render_supervisor_keys%ROWTYPE;
  e private.composition_render_executions%ROWTYPE;
  current_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  next_attempt integer;
BEGIN
  IF p_issuance_id IS NULL OR p_contract_sha256 IS NULL OR p_contract_sha256 !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION 'RENDER_AUTHORITY_INPUT_INVALID';
  END IF;
  SELECT * INTO r FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id FOR UPDATE;
  current_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR r.provider_render_id IS NOT NULL OR r.provider_status <> 'PENDING' THEN
    RAISE EXCEPTION 'RENDER_AUTHORITY_REQUEST_UNAVAILABLE';
  END IF;
  PERFORM 1 FROM public.production_jobs j WHERE j.id = r.production_job_id AND j.organization_id = p_organization_id
    AND j.input_snapshot->>'render_backend' = 'CONTROLLED'
    AND j.status IN ('PENDING','QUEUED','RUNNING') FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RENDER_AUTHORITY_CONTROLLED_JOB_REQUIRED'; END IF;
  SELECT * INTO v FROM public.video_composition_revisions WHERE id = r.composition_revision_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND OR v.manifest->'conformance_contract' IS DISTINCT FROM p_contract
    OR p_contract->>'schemaVersion' IS DISTINCT FROM '4'
    OR p_contract#>>'{renderExecution,backend}' IS DISTINCT FROM 'CONTROLLED'
    OR v.manifest->>'draft_document_hash' IS DISTINCT FROM p_contract->>'documentHash' THEN
    RAISE EXCEPTION 'RENDER_AUTHORITY_REVISION_INVALID';
  END IF;
  PERFORM 1 FROM public.production_jobs j WHERE j.id = r.production_job_id AND j.organization_id = p_organization_id
    AND j.input_snapshot->>'revision_id' = v.id::text AND j.input_snapshot->>'project_hash' = v.project_hash FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'RENDER_AUTHORITY_JOB_REVISION_MISMATCH'; END IF;
  SELECT * INTO k FROM private.composition_render_supervisor_keys WHERE organization_id = p_organization_id
    AND supervisor_id = p_supervisor_id AND key_id = p_key_id FOR SHARE;
  current_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR k.revoked OR k.not_before_ms > current_ms OR k.not_after_ms <= current_ms THEN
    RAISE EXCEPTION 'RENDER_AUTHORITY_ISSUER_UNAUTHORIZED';
  END IF;
  SELECT * INTO e FROM private.composition_render_executions WHERE organization_id = p_organization_id
    AND request_id = p_request_id AND issuance_id = p_issuance_id FOR UPDATE;
  IF FOUND THEN
    IF e.status NOT IN ('RUNNING','CONSUMED') OR e.expires_at_ms <= current_ms
      OR e.supervisor_id <> p_supervisor_id OR e.key_id <> p_key_id OR e.contract_sha256 <> p_contract_sha256 THEN
      RAISE EXCEPTION 'RENDER_AUTHORITY_ISSUANCE_CONFLICT';
    END IF;
    RETURN private.composition_render_execution_context(e);
  END IF;
  UPDATE private.composition_render_executions SET status = 'EXPIRED'
    WHERE request_id = p_request_id AND status = 'RUNNING' AND expires_at_ms <= current_ms;
  IF EXISTS (SELECT 1 FROM private.composition_render_executions WHERE request_id = p_request_id AND status IN ('RUNNING','CONSUMED')) THEN
    RAISE EXCEPTION 'RENDER_AUTHORITY_EXECUTION_EXISTS';
  END IF;
  SELECT coalesce(max(attempt),0) + 1 INTO next_attempt FROM private.composition_render_executions WHERE request_id = p_request_id;
  IF next_attempt > 5 THEN RAISE EXCEPTION 'RENDER_AUTHORITY_ATTEMPTS_EXHAUSTED'; END IF;
  INSERT INTO private.composition_render_executions(organization_id, request_id, revision_id, production_job_id,
    issuance_id, supervisor_id, key_id, attempt, challenge_sha256, document_hash, project_hash, contract_sha256,
    contract, artifact_kind, issued_at_ms, expires_at_ms)
  VALUES (p_organization_id, p_request_id, v.id, r.production_job_id, p_issuance_id, p_supervisor_id, p_key_id, next_attempt,
    encode(sha256(convert_to('RENDER_EXECUTION_CHALLENGE_V1:' || gen_random_uuid()::text || ':' || gen_random_uuid()::text, 'UTF8')), 'hex'),
    p_contract->>'documentHash', v.project_hash, p_contract_sha256, p_contract,
    CASE WHEN p_contract ? 'checkpointBatch' THEN 'EVENT_BATCH_SET' ELSE 'SINGLE_CONTRACT' END,
    current_ms, least(current_ms + 600000, k.not_after_ms)) RETURNING * INTO e;
  RETURN private.composition_render_execution_context(e);
END $$;

CREATE FUNCTION public.read_composition_render_execution(p_organization_id uuid, p_request_id uuid,
  p_execution_id uuid, p_lease_token uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE e private.composition_render_executions%ROWTYPE;
BEGIN
  SELECT * INTO e FROM private.composition_render_executions WHERE id = p_execution_id
    AND organization_id = p_organization_id AND request_id = p_request_id AND lease_token = p_lease_token
    AND status IN ('RUNNING','CONSUMED') AND expires_at_ms > floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND THEN RETURN NULL; END IF;
  RETURN private.composition_render_execution_context(e);
END $$;

CREATE FUNCTION public.consume_composition_render_execution(p_organization_id uuid, p_request_id uuid,
  p_execution_id uuid, p_lease_token uuid, p_receipt jsonb, p_receipt_sha256 text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
DECLARE
  e private.composition_render_executions%ROWTYPE;
  k private.composition_render_supervisor_keys%ROWTYPE;
  binding jsonb; required jsonb; payload jsonb;
  current_ms bigint := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
BEGIN
  -- Same request-first lock order as issuance; avoid request/execution inversion under concurrency.
  PERFORM 1 FROM public.hyperframes_render_requests WHERE id = p_request_id AND organization_id = p_organization_id FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO e FROM private.composition_render_executions WHERE id = p_execution_id
    AND organization_id = p_organization_id AND request_id = p_request_id AND lease_token = p_lease_token FOR UPDATE;
  IF NOT FOUND OR e.status NOT IN ('RUNNING','CONSUMED') THEN RETURN false; END IF;
  SELECT * INTO k FROM private.composition_render_supervisor_keys WHERE organization_id = e.organization_id
    AND supervisor_id = e.supervisor_id AND key_id = e.key_id FOR SHARE;
  current_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;
  IF NOT FOUND OR k.revoked OR k.not_before_ms > current_ms OR k.not_after_ms <= current_ms THEN RETURN false; END IF;
  IF e.status = 'CONSUMED' THEN
    RETURN e.receipt_sha256 = p_receipt_sha256 AND e.receipt = p_receipt;
  END IF;
  IF e.expires_at_ms <= current_ms THEN RETURN false; END IF;
  PERFORM 1 FROM public.hyperframes_render_requests r JOIN public.production_jobs j ON j.id = r.production_job_id
    JOIN public.video_composition_revisions v ON v.id = r.composition_revision_id
    WHERE r.id = e.request_id AND r.organization_id = e.organization_id AND j.organization_id = e.organization_id
      AND v.organization_id = e.organization_id AND r.production_job_id = e.production_job_id AND v.id = e.revision_id
      AND j.input_snapshot->>'render_backend' = 'CONTROLLED' AND j.status IN ('PENDING','QUEUED','RUNNING')
      AND j.input_snapshot->>'revision_id' = e.revision_id::text AND j.input_snapshot->>'project_hash' = e.project_hash
      AND r.provider_render_id IS NULL AND r.provider_status = 'PENDING'
      AND v.project_hash = e.project_hash AND v.manifest->'conformance_contract' = e.contract
      AND v.manifest->>'draft_document_hash' = e.document_hash FOR SHARE OF r,j,v;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Signature/Ed25519 and canonical receipt SHA are checked by the trusted Node verifier, not JSONB.
  IF p_receipt_sha256 IS NULL OR p_receipt_sha256 !~ '^[a-f0-9]{64}$' OR p_receipt IS NULL
    OR octet_length(p_receipt::text) > 8192 THEN RETURN false; END IF;
  payload := p_receipt->'payload'; binding := payload->'binding';
  IF jsonb_typeof(p_receipt) IS DISTINCT FROM 'object' OR jsonb_typeof(payload) IS DISTINCT FROM 'object'
    OR jsonb_typeof(binding) IS DISTINCT FROM 'object' OR jsonb_typeof(p_receipt->'signature') IS DISTINCT FROM 'string' THEN
    RETURN false;
  END IF;
  required := jsonb_build_object('organizationId', e.organization_id, 'requestId', e.request_id,
    'revisionId', e.revision_id, 'productionJobId', e.production_job_id, 'executionId', e.id,
    'attempt', e.attempt, 'challengeSha256', e.challenge_sha256, 'artifactKind', e.artifact_kind,
    'documentHash', e.document_hash, 'projectHash', e.project_hash, 'contractSha256', e.contract_sha256);
  IF (binding - ARRAY['observationSha256','comparisonReceiptSha256','videoSha256','sizeBytes']) IS DISTINCT FROM required
    OR payload->>'policy' IS DISTINCT FROM 'SUPERVISOR_SIGNED_RENDER_OUTPUT_V1'
    OR payload->>'scope' IS DISTINCT FROM 'SIGNED_ISSUER_AND_OUTPUT_BINDING_NOT_ISOLATION_OR_CONFORMANCE'
    OR payload->>'supervisorId' IS DISTINCT FROM e.supervisor_id OR payload->>'keyId' IS DISTINCT FROM e.key_id
    OR coalesce(p_receipt->>'signature','') !~ '^[A-Za-z0-9_-]{86}$'
    OR coalesce(binding->>'observationSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(binding->>'comparisonReceiptSha256','') !~ '^[a-f0-9]{64}$'
    OR coalesce(binding->>'videoSha256','') !~ '^[a-f0-9]{64}$'
    OR jsonb_typeof(binding->'sizeBytes') IS DISTINCT FROM 'number'
    OR coalesce(binding->>'sizeBytes','') !~ '^[0-9]{1,10}$'
    OR coalesce(payload->>'issuedAtMilliseconds','') !~ '^[0-9]{1,16}$'
    OR coalesce(payload->>'expiresAtMilliseconds','') !~ '^[0-9]{1,16}$' THEN RETURN false; END IF;
  IF (binding->>'sizeBytes')::bigint NOT BETWEEN 1 AND 2147483648
    OR (payload->>'issuedAtMilliseconds')::bigint < greatest(e.issued_at_ms,k.not_before_ms)
    OR (payload->>'issuedAtMilliseconds')::bigint > current_ms + 30000
    OR (payload->>'expiresAtMilliseconds')::bigint > least(e.expires_at_ms,k.not_after_ms)
    OR (payload->>'expiresAtMilliseconds')::bigint <= current_ms
    OR (payload->>'expiresAtMilliseconds')::bigint <= (payload->>'issuedAtMilliseconds')::bigint THEN RETURN false; END IF;
  UPDATE private.composition_render_executions SET status = 'CONSUMED', receipt = p_receipt,
    receipt_sha256 = p_receipt_sha256, consumed_at_ms = current_ms WHERE id = e.id;
  RETURN true;
END $$;

CREATE FUNCTION public.cancel_composition_render_execution(p_organization_id uuid, p_request_id uuid,
  p_execution_id uuid, p_lease_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, private AS $$
BEGIN
  UPDATE private.composition_render_executions SET status = 'CANCELLED' WHERE id = p_execution_id
    AND organization_id = p_organization_id AND request_id = p_request_id AND lease_token = p_lease_token AND status = 'RUNNING';
  RETURN FOUND;
END $$;

REVOKE ALL ON FUNCTION public.issue_composition_render_execution(uuid,uuid,uuid,text,text,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.read_composition_render_execution(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.consume_composition_render_execution(uuid,uuid,uuid,uuid,jsonb,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.cancel_composition_render_execution(uuid,uuid,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.issue_composition_render_execution(uuid,uuid,uuid,text,text,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.read_composition_render_execution(uuid,uuid,uuid,uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_composition_render_execution(uuid,uuid,uuid,uuid,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cancel_composition_render_execution(uuid,uuid,uuid,uuid) TO service_role;
-- Rollback: stop the controlled authority consumer first, revoke its four RPCs, preserve ledger/key rows.
-- Do not drop consumed evidence or migrate Cloud requests into this authority.
