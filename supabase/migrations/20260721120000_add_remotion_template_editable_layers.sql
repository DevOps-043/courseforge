-- ============================================================================
-- Migration: Add editable layer metadata for custom Remotion templates
-- Date: 2026-07-21
-- Description:
--   Stores normalized initial material positions declared by external bundle
--   manifests. The layout editor uses these boxes as the starting point before
--   persisting user changes as layoutOverrides.
-- ============================================================================

ALTER TABLE public.remotion_template_versions
  ADD COLUMN IF NOT EXISTS editable_layers jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.remotion_template_versions
SET editable_layers = manifest->'editableLayers'
WHERE
  manifest IS NOT NULL
  AND jsonb_typeof(manifest->'editableLayers') = 'array'
  AND editable_layers = '[]'::jsonb;

COMMENT ON COLUMN public.remotion_template_versions.editable_layers IS
  'Editable layer metadata from courseforge-remotion-template.json: layerId, kind, capabilities, constraints and defaultBox in canvas pixels.';
