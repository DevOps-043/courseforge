-- Per-organization Courseforge roles.
-- profiles.platform_role remains as a legacy/global fallback, but tenant-aware
-- authorization should prefer this table.

CREATE TABLE IF NOT EXISTS public.organization_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  platform_role app_role NOT NULL DEFAULT 'CONSTRUCTOR'::app_role,
  source text NOT NULL DEFAULT 'courseforge',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_user_roles_org_user_key UNIQUE (organization_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_organization_user_roles_user
  ON public.organization_user_roles (user_id);

CREATE INDEX IF NOT EXISTS idx_organization_user_roles_org_role
  ON public.organization_user_roles (organization_id, platform_role);

ALTER TABLE public.organization_user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_organization_user_roles"
  ON public.organization_user_roles
  FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_insert_organization_user_roles"
  ON public.organization_user_roles
  FOR INSERT
  WITH CHECK (organization_id::text = public.get_active_org_id());

CREATE POLICY "org_update_organization_user_roles"
  ON public.organization_user_roles
  FOR UPDATE
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
