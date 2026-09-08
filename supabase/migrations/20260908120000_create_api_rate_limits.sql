CREATE TABLE IF NOT EXISTS public.api_rate_limits (
  rate_key text PRIMARY KEY,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.api_rate_limits ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.consume_api_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
RETURNS TABLE (allowed boolean, remaining integer, reset_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  current_count integer;
  current_window timestamptz;
  current_time timestamptz := clock_timestamp();
BEGIN
  IF length(p_rate_key) < 1 OR length(p_rate_key) > 300 THEN
    RAISE EXCEPTION 'Invalid rate limit key';
  END IF;
  IF p_limit < 1 OR p_window_seconds < 1 THEN
    RAISE EXCEPTION 'Invalid rate limit policy';
  END IF;

  INSERT INTO public.api_rate_limits AS limits (
    rate_key,
    window_started_at,
    request_count,
    updated_at
  )
  VALUES (p_rate_key, current_time, 1, current_time)
  ON CONFLICT (rate_key) DO UPDATE
  SET
    window_started_at = CASE
      WHEN limits.window_started_at <= current_time - make_interval(secs => p_window_seconds)
        THEN current_time
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at <= current_time - make_interval(secs => p_window_seconds)
        THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = current_time
  RETURNING limits.request_count, limits.window_started_at
  INTO current_count, current_window;

  RETURN QUERY SELECT
    current_count <= p_limit,
    greatest(p_limit - current_count, 0),
    current_window + make_interval(secs => p_window_seconds);
END;
$$;

REVOKE ALL ON TABLE public.api_rate_limits FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.consume_api_rate_limit(text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_api_rate_limit(text, integer, integer) TO service_role;

CREATE INDEX IF NOT EXISTS idx_api_rate_limits_updated_at
  ON public.api_rate_limits (updated_at);
