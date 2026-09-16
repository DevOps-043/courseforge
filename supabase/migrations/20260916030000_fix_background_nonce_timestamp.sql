-- CURRENT_TIME is a SQL keyword returning timetz, even when a PL/pgSQL
-- variable has that name. The old comparison raised 42883 before any job ran.
-- Replace the function in place so existing execute privileges are preserved.
CREATE OR REPLACE FUNCTION public.consume_background_request_nonce(
  p_nonce text,
  p_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  inserted_count integer;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF p_nonce IS NULL OR p_expires_at IS NULL
    OR length(p_nonce) < 16 OR length(p_nonce) > 100
    OR p_expires_at <= v_now THEN
    RETURN false;
  END IF;

  DELETE FROM public.background_request_nonces
  WHERE expires_at < v_now;

  INSERT INTO public.background_request_nonces (nonce, expires_at, consumed_at)
  VALUES (p_nonce, p_expires_at, v_now)
  ON CONFLICT (nonce) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;
