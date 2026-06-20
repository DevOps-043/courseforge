-- ============================================================================
-- Migration: Harden Remotion template bundles
-- Date: 2026-06-19
-- Description:
--   Adds a private bucket for external Remotion bundle code and expands bundle
--   lifecycle states so human approval is separate from sandbox execution.
-- ============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'template-bundles',
  'template-bundles',
  false,
  10485760,
  ARRAY[
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "Authenticated users can upload template bundles" ON storage.objects;
CREATE POLICY "Authenticated users can upload template bundles"
ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'template-bundles'
  AND name LIKE ('organizations/' || public.get_active_org_id() || '/templates/%')
);

DROP POLICY IF EXISTS "Users can view own organization template bundles" ON storage.objects;
CREATE POLICY "Users can view own organization template bundles"
ON storage.objects
FOR SELECT TO authenticated
USING (
  bucket_id = 'template-bundles'
  AND name LIKE ('organizations/' || public.get_active_org_id() || '/templates/%')
);

DROP POLICY IF EXISTS "Users can update own organization template bundles" ON storage.objects;
CREATE POLICY "Users can update own organization template bundles"
ON storage.objects
FOR UPDATE TO authenticated
USING (
  bucket_id = 'template-bundles'
  AND name LIKE ('organizations/' || public.get_active_org_id() || '/templates/%')
)
WITH CHECK (
  bucket_id = 'template-bundles'
  AND name LIKE ('organizations/' || public.get_active_org_id() || '/templates/%')
);

ALTER TABLE public.remotion_templates
  DROP CONSTRAINT IF EXISTS remotion_templates_bundle_status_check;

ALTER TABLE public.remotion_templates
  ADD CONSTRAINT remotion_templates_bundle_status_check
  CHECK (
    bundle_status IN (
      'NOT_APPLICABLE',
      'VALIDATING',
      'STORED_REFERENCE',
      'PENDING_REVIEW',
      'APPROVED',
      'APPROVED_FOR_SANDBOX',
      'SANDBOX_VALIDATION_FAILED',
      'REJECTED'
    )
  );

ALTER TABLE public.remotion_template_versions
  DROP CONSTRAINT IF EXISTS remotion_template_versions_status_check;

ALTER TABLE public.remotion_template_versions
  ADD CONSTRAINT remotion_template_versions_status_check
  CHECK (
    status IN (
      'UPLOADED',
      'VALIDATING',
      'VALIDATION_FAILED',
      'PENDING_REVIEW',
      'APPROVED',
      'APPROVED_FOR_SANDBOX',
      'SANDBOX_VALIDATION_FAILED',
      'REJECTED',
      'DEPRECATED'
    )
  );

COMMENT ON COLUMN public.remotion_templates.bundle_status IS
  'Lifecycle for uploaded external bundle references. APPROVED is audit approval; APPROVED_FOR_SANDBOX is required before sandbox execution.';
