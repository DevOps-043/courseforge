CREATE TABLE IF NOT EXISTS public.background_request_nonces (
  nonce text PRIMARY KEY,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

ALTER TABLE public.background_request_nonces ENABLE ROW LEVEL SECURITY;

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
  current_time timestamptz := clock_timestamp();
BEGIN
  IF length(p_nonce) < 16 OR length(p_nonce) > 100 OR p_expires_at <= current_time THEN
    RETURN false;
  END IF;

  DELETE FROM public.background_request_nonces
  WHERE expires_at < current_time;

  INSERT INTO public.background_request_nonces (nonce, expires_at, consumed_at)
  VALUES (p_nonce, p_expires_at, current_time)
  ON CONFLICT (nonce) DO NOTHING;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  RETURN inserted_count = 1;
END;
$$;

REVOKE ALL ON TABLE public.background_request_nonces FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_background_request_nonce(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_background_request_nonce(text, timestamptz)
  TO service_role;

CREATE INDEX IF NOT EXISTS idx_background_request_nonces_expires_at
  ON public.background_request_nonces (expires_at);
