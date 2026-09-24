-- Immutable audit trail for tenant-scoped exports and binary downloads.
CREATE TABLE IF NOT EXISTS public.asset_access_audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('DOWNLOAD', 'EXPORT_JSON', 'EXPORT_ZIP')),
  resource_type text NOT NULL CHECK (resource_type IN ('MATERIAL_COMPONENT', 'PRODUCTION_ASSET', 'SOUND_EFFECT')),
  resource_id text NOT NULL CHECK (char_length(resource_id) BETWEEN 1 AND 128),
  request_id text NOT NULL CHECK (char_length(request_id) BETWEEN 1 AND 128),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_asset_access_audit_events_org_created
  ON public.asset_access_audit_events (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_asset_access_audit_events_resource
  ON public.asset_access_audit_events (organization_id, resource_type, resource_id, created_at DESC);

ALTER TABLE public.asset_access_audit_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_asset_access_audit_events"
  ON public.asset_access_audit_events FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_asset_access_audit_events"
  ON public.asset_access_audit_events FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.asset_access_audit_events IS
  'Append-only record of authorized Courseforge material exports and asset downloads. Metadata must not contain signed URLs, file paths, secrets, or PII.';
