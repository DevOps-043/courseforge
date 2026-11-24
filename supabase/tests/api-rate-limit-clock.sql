-- SofLIA Engine. Ejecutar después de 20261124150000_fix_api_rate_limit_clock.sql.
-- Verifica PostgreSQL real; todos los contadores sintéticos se revierten.
BEGIN;
DO $$
DECLARE
  test_key text := 'regression:rate-clock:' || md5(random()::text || clock_timestamp()::text);
  result record;
BEGIN
  SELECT * INTO result FROM public.consume_api_rate_limit(test_key, 2, 60);
  IF result.allowed IS DISTINCT FROM true OR result.remaining <> 1
    OR result.reset_at <= clock_timestamp() OR result.reset_at > clock_timestamp() + interval '65 seconds'
    THEN RAISE EXCEPTION 'RATE_CLOCK_FIRST_REQUEST_FAILED'; END IF;
  SELECT * INTO result FROM public.consume_api_rate_limit(test_key, 2, 60);
  IF result.allowed IS DISTINCT FROM true OR result.remaining <> 0
    THEN RAISE EXCEPTION 'RATE_CLOCK_SECOND_REQUEST_FAILED'; END IF;
  SELECT * INTO result FROM public.consume_api_rate_limit(test_key, 2, 60);
  IF result.allowed IS DISTINCT FROM false OR result.remaining <> 0
    THEN RAISE EXCEPTION 'RATE_CLOCK_LIMIT_NOT_ENFORCED'; END IF;
  SELECT * INTO result FROM public.consume_api_rate_limit(test_key || ':other', 2, 60);
  IF result.allowed IS DISTINCT FROM true OR result.remaining <> 1
    THEN RAISE EXCEPTION 'RATE_CLOCK_KEYS_NOT_ISOLATED'; END IF;
  UPDATE public.api_rate_limits SET window_started_at = clock_timestamp() - interval '61 seconds', request_count = 99
    WHERE rate_key = test_key;
  SELECT * INTO result FROM public.consume_api_rate_limit(test_key, 2, 60);
  IF result.allowed IS DISTINCT FROM true OR result.remaining <> 1
    THEN RAISE EXCEPTION 'RATE_CLOCK_WINDOW_NOT_RENEWED'; END IF;
  IF has_function_privilege('anon', 'public.consume_api_rate_limit(text,integer,integer)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.consume_api_rate_limit(text,integer,integer)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.consume_api_rate_limit(text,integer,integer)', 'EXECUTE')
    THEN RAISE EXCEPTION 'RATE_CLOCK_PERMISSIONS_CHANGED'; END IF;
END $$;
ROLLBACK;
