-- Correlates user requests, durable jobs, retries and terminal outcomes without storing PII.

ALTER TABLE public.scorm_imports
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

ALTER TABLE public.publication_requests
  ADD COLUMN IF NOT EXISTS correlation_id uuid;

CREATE INDEX IF NOT EXISTS idx_scorm_imports_correlation_id
  ON public.scorm_imports (correlation_id)
  WHERE correlation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_publication_requests_correlation_id
  ON public.publication_requests (correlation_id)
  WHERE correlation_id IS NOT NULL;

COMMENT ON COLUMN public.scorm_imports.correlation_id
  IS 'Opaque request/job correlation ID. Must not contain user or tenant PII.';
COMMENT ON COLUMN public.publication_requests.correlation_id
  IS 'Opaque request/job correlation ID. Must not contain user or tenant PII.';
