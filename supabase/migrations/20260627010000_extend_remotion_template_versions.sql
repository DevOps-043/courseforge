-- ============================================================================
-- Migration: Extend Remotion template versions for custom bundle contracts
-- Date: 2026-06-27
-- Description:
--   Persists manifest metadata needed to render and later preview custom
--   Remotion bundles without relying on the parent template fallback fields.
-- ============================================================================

ALTER TABLE public.remotion_template_versions
  ADD COLUMN IF NOT EXISTS template_type text NOT NULL DEFAULT 'custom_bundle'
    CHECK (template_type IN ('simple', 'custom_bundle')),
  ADD COLUMN IF NOT EXISTS export_mode text NOT NULL DEFAULT 'component'
    CHECK (export_mode IN ('component', 'root')),
  ADD COLUMN IF NOT EXISTS composition_id text,
  ADD COLUMN IF NOT EXISTS composition_ids jsonb,
  ADD COLUMN IF NOT EXISTS props_schema jsonb,
  ADD COLUMN IF NOT EXISTS default_props jsonb,
  ADD COLUMN IF NOT EXISTS default_duration_frames integer,
  ADD COLUMN IF NOT EXISTS default_fps integer,
  ADD COLUMN IF NOT EXISTS default_width integer,
  ADD COLUMN IF NOT EXISTS default_height integer,
  ADD COLUMN IF NOT EXISTS build_status text NOT NULL DEFAULT 'PENDING'
    CHECK (build_status IN ('PENDING', 'BUILDING', 'BUILT', 'BUILD_FAILED')),
  ADD COLUMN IF NOT EXISTS build_hash text,
  ADD COLUMN IF NOT EXISTS build_output_path text,
  ADD COLUMN IF NOT EXISTS built_at timestamp with time zone;

UPDATE public.remotion_template_versions
SET
  export_mode = CASE
    WHEN manifest->>'exportMode' = 'root' THEN 'root'
    ELSE export_mode
  END,
  composition_id = COALESCE(composition_id, NULLIF(manifest->>'compositionId', '')),
  composition_ids = COALESCE(
    composition_ids,
    CASE
      WHEN jsonb_typeof(manifest->'compositionIds') = 'array' THEN manifest->'compositionIds'
      WHEN NULLIF(manifest->>'compositionId', '') IS NOT NULL THEN jsonb_build_array(manifest->>'compositionId')
      ELSE NULL
    END
  ),
  props_schema = COALESCE(props_schema, manifest->'propsSchema'),
  default_props = COALESCE(default_props, manifest->'defaultProps'),
  default_duration_frames = COALESCE(
    default_duration_frames,
    CASE
      WHEN jsonb_typeof(manifest->'defaultDurationFrames') = 'number'
        THEN (manifest->>'defaultDurationFrames')::integer
      ELSE NULL
    END
  ),
  default_fps = COALESCE(
    default_fps,
    CASE
      WHEN jsonb_typeof(manifest->'fps') = 'number' THEN (manifest->>'fps')::integer
      ELSE NULL
    END
  ),
  default_width = COALESCE(
    default_width,
    CASE
      WHEN jsonb_typeof(manifest->'width') = 'number' THEN (manifest->>'width')::integer
      ELSE NULL
    END
  ),
  default_height = COALESCE(
    default_height,
    CASE
      WHEN jsonb_typeof(manifest->'height') = 'number' THEN (manifest->>'height')::integer
      ELSE NULL
    END
  )
WHERE manifest IS NOT NULL;

COMMENT ON COLUMN public.remotion_template_versions.template_type IS
  'simple: legacy/internal template reference. custom_bundle: uploaded external Remotion bundle.';

COMMENT ON COLUMN public.remotion_template_versions.export_mode IS
  'component: template exports MyComposition/default. root: template calls registerRoot() itself.';

COMMENT ON COLUMN public.remotion_template_versions.composition_id IS
  'Primary composition ID declared in courseforge-remotion-template.json.';

COMMENT ON COLUMN public.remotion_template_versions.composition_ids IS
  'All composition IDs declared or discovered for the bundle, when available.';

COMMENT ON COLUMN public.remotion_template_versions.props_schema IS
  'JSON Schema contract for bundle props, extracted from courseforge-remotion-template.json.';

COMMENT ON COLUMN public.remotion_template_versions.default_props IS
  'Default props declared by the bundle manifest.';

COMMENT ON COLUMN public.remotion_template_versions.build_hash IS
  'SHA-256 hash of the compiled bundle artifact. Different from bundle_hash, which hashes the source ZIP.';
