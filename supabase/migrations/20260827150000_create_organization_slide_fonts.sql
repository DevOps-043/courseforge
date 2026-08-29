-- Fonts are organization-owned assets. This migration is intentionally safe to
-- re-run from the Supabase SQL editor after an interrupted/manual deployment.
DO $$
BEGIN
  IF to_regclass('public.organization_slide_fonts') IS NULL THEN
    CREATE TABLE public.organization_slide_fonts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
      family text NOT NULL,
      source text NOT NULL,
      css_url text,
      storage_path text,
      created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  END IF;
END $$;

-- Permit recovery from a table that was created before a previous execution
-- stopped. The application requires all of these columns.
ALTER TABLE public.organization_slide_fonts
  ADD COLUMN IF NOT EXISTS css_url text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_slide_fonts'::regclass
      AND conname = 'organization_slide_fonts_family_check'
  ) THEN
    ALTER TABLE public.organization_slide_fonts
      ADD CONSTRAINT organization_slide_fonts_family_check
      CHECK (family ~ '^[a-zA-Z0-9 ._-]+$' AND char_length(trim(family)) BETWEEN 1 AND 120);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_slide_fonts'::regclass
      AND conname = 'organization_slide_fonts_source_check'
  ) THEN
    ALTER TABLE public.organization_slide_fonts
      ADD CONSTRAINT organization_slide_fonts_source_check
      CHECK (
        (source = 'google' AND css_url IS NOT NULL AND storage_path IS NULL)
        OR (source = 'uploaded' AND storage_path IS NOT NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS organization_slide_fonts_organization_id_idx
  ON public.organization_slide_fonts (organization_id, created_at DESC);

ALTER TABLE public.organization_slide_fonts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "organization members can read their slide fonts" ON public.organization_slide_fonts;
CREATE POLICY "organization members can read their slide fonts"
  ON public.organization_slide_fonts FOR SELECT
  USING (organization_id::text = public.get_active_org_id());

DROP POLICY IF EXISTS "organization members can manage their slide fonts" ON public.organization_slide_fonts;
CREATE POLICY "organization members can manage their slide fonts"
  ON public.organization_slide_fonts FOR ALL
  USING (organization_id::text = public.get_active_org_id())
  WITH CHECK (organization_id::text = public.get_active_org_id());
