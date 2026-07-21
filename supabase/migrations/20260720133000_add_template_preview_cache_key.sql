-- ============================================================================
-- Migration: Idempotency key for custom Remotion template previews
-- Date: 2026-07-20
-- Description:
--   Prevents duplicated quick-preview jobs for the same compiled template build,
--   component, props hash, layout override hash, and preview frame. This keeps
--   editing responsive while avoiding queue amplification during repeated clicks
--   or automatic preview refreshes.
-- ============================================================================

ALTER TABLE public.remotion_template_previews
  ADD COLUMN IF NOT EXISTS preview_cache_key text;

UPDATE public.remotion_template_previews
SET preview_cache_key = md5(
  concat_ws(
    ':',
    template_build_id::text,
    COALESCE(material_component_id::text, 'global'),
    props_hash,
    COALESCE(layout_overrides_hash, ''),
    preview_frame::text
  )
)
WHERE preview_cache_key IS NULL;

ALTER TABLE public.remotion_template_previews
  ALTER COLUMN preview_cache_key SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_remotion_template_previews_cache_key
  ON public.remotion_template_previews (organization_id, preview_cache_key);

COMMENT ON COLUMN public.remotion_template_previews.preview_cache_key IS
  'Idempotency key for a materialized preview request scoped to organization.';
