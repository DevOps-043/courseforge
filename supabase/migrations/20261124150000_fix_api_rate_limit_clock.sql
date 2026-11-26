-- Instancia: SofLIA Engine (emsjctbdevufloxntjll).
-- Precondición: api_rate_limits y consume_api_rate_limit ya existen.
-- Corrige la colisión con CURRENT_TIME (timetz); conserva firma, límites y grants.
-- Reejecutable y atómica; no borra ni reinicia contadores existentes.
BEGIN;

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
  v_now timestamptz := clock_timestamp();
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
  VALUES (p_rate_key, v_now, 1, v_now)
  ON CONFLICT (rate_key) DO UPDATE
  SET
    window_started_at = CASE
      WHEN limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        THEN v_now
      ELSE limits.window_started_at
    END,
    request_count = CASE
      WHEN limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
        THEN 1
      ELSE limits.request_count + 1
    END,
    updated_at = v_now
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

COMMIT;
