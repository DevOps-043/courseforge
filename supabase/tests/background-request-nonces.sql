-- Run after the nonce migrations. All test writes, including expiry cleanup,
-- are rolled back. An assertion failure aborts the transaction.
BEGIN;

DO $$
DECLARE
  v_nonce text := gen_random_uuid()::text;
  v_expired_nonce text := gen_random_uuid()::text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF public.consume_background_request_nonce(v_nonce, v_now - interval '1 minute') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Expired request accepted';
  END IF;
  IF public.consume_background_request_nonce('short', v_now + interval '5 minutes') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Short nonce accepted';
  END IF;
  IF public.consume_background_request_nonce(repeat('x', 101), v_now + interval '5 minutes') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Oversized nonce accepted';
  END IF;
  IF public.consume_background_request_nonce(NULL, v_now + interval '5 minutes') IS DISTINCT FROM false
    OR public.consume_background_request_nonce(v_nonce, NULL) IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Null input accepted';
  END IF;

  INSERT INTO public.background_request_nonces (nonce, expires_at)
  VALUES (v_expired_nonce, v_now - interval '1 minute');

  IF public.consume_background_request_nonce(v_nonce, v_now + interval '5 minutes') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Valid request rejected';
  END IF;
  IF EXISTS (SELECT 1 FROM public.background_request_nonces WHERE nonce = v_expired_nonce) THEN
    RAISE EXCEPTION 'Expired nonce was not cleaned up';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.background_request_nonces
    WHERE nonce = v_nonce AND consumed_at >= v_now AND expires_at > consumed_at
  ) THEN
    RAISE EXCEPTION 'Nonce timestamp was not persisted correctly';
  END IF;
  IF public.consume_background_request_nonce(v_nonce, v_now + interval '5 minutes') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'Replay accepted';
  END IF;

  IF has_function_privilege('anon', 'public.consume_background_request_nonce(text,timestamptz)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.consume_background_request_nonce(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Nonce RPC accessible to an unprivileged role';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.consume_background_request_nonce(text,timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Service role cannot validate jobs';
  END IF;
END;
$$;

ROLLBACK;
