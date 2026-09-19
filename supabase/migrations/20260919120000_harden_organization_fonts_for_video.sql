-- Extends the existing slide-font registry into a shared organization font
-- registry without renaming the table, preserving deployed slide integrations.
ALTER TABLE public.organization_slide_fonts
  ADD COLUMN IF NOT EXISTS checksum_sha256 text,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN IF NOT EXISTS storage_bucket text;

UPDATE public.organization_slide_fonts
SET storage_bucket = 'production-assets'
WHERE source = 'uploaded'
  AND storage_path IS NOT NULL
  AND storage_bucket IS NULL;

UPDATE public.organization_slide_fonts
SET status = CASE
  WHEN source = 'google' THEN 'READY'
  WHEN checksum_sha256 IS NOT NULL THEN 'READY'
  ELSE 'LEGACY'
END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_slide_fonts'::regclass
      AND conname = 'organization_slide_fonts_status_check'
  ) THEN
    ALTER TABLE public.organization_slide_fonts
      ADD CONSTRAINT organization_slide_fonts_status_check
      CHECK (status IN ('LEGACY', 'READY', 'REJECTED'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_slide_fonts'::regclass
      AND conname = 'organization_slide_fonts_checksum_check'
  ) THEN
    ALTER TABLE public.organization_slide_fonts
      ADD CONSTRAINT organization_slide_fonts_checksum_check
      CHECK (checksum_sha256 IS NULL OR checksum_sha256 ~ '^[a-f0-9]{64}$');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.organization_slide_fonts'::regclass
      AND conname = 'organization_slide_fonts_file_size_check'
  ) THEN
    ALTER TABLE public.organization_slide_fonts
      ADD CONSTRAINT organization_slide_fonts_file_size_check
      CHECK (file_size_bytes IS NULL OR file_size_bytes BETWEEN 1 AND 10485760);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS organization_slide_fonts_checksum_idx
  ON public.organization_slide_fonts (organization_id, checksum_sha256);

-- Font mutations must cross the server API so role checks and binary validation
-- cannot be bypassed by an authenticated organization member.
DROP POLICY IF EXISTS "organization members can manage their slide fonts"
  ON public.organization_slide_fonts;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'organization-fonts',
  'organization-fonts',
  false,
  10485760,
  ARRAY['font/woff2', 'font/woff', 'font/ttf', 'font/otf']
)
ON CONFLICT (id) DO UPDATE SET
  public = false,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- No client storage policy is created. Reads and writes go through authorized
-- server routes using the service role; previews receive short-lived signatures.
