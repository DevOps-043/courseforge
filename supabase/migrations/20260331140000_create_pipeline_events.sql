-- Migration: Create pipeline_events table
-- Tracks pipeline lifecycle events per artifact.
-- Structure derived from logPipelineEventAction() in production.actions.ts

CREATE TABLE IF NOT EXISTS public.pipeline_events (
  id           uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id  uuid NOT NULL,
  event_type   text NOT NULL,
  event_data   jsonb NOT NULL DEFAULT '{}'::jsonb,
  step_id      text,
  entity_id    text,
  entity_type  text,
  created_at   timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT pipeline_events_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_events_artifact_id_fkey
    FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_artifact_id
  ON public.pipeline_events (artifact_id);

CREATE INDEX IF NOT EXISTS idx_pipeline_events_event_type
  ON public.pipeline_events (event_type);

-- RLS
ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own org pipeline events"
  ON public.pipeline_events
  FOR SELECT
  USING (
    artifact_id IN (
      SELECT id FROM public.artifacts
      WHERE organization_id::text = COALESCE(
        current_setting('request.jwt.claims', true)::json->>'active_organization_id',
        (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
      )
    )
  );

CREATE POLICY "Users can insert own org pipeline events"
  ON public.pipeline_events
  FOR INSERT
  WITH CHECK (
    artifact_id IN (
      SELECT id FROM public.artifacts
      WHERE organization_id::text = COALESCE(
        current_setting('request.jwt.claims', true)::json->>'active_organization_id',
        (current_setting('request.jwt.claims', true)::json->'app_metadata'->>'active_organization_id')
      )
    )
  );
