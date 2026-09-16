-- One editable composition is the durable identity of one material component.
-- Concurrent editor initialization (for example React Strict Mode or two tabs)
-- previously allowed duplicate DRAFT rows. Preserve every row for audit, keep
-- the most advanced composition active, and archive only the redundant shells.

WITH composition_progress AS (
  SELECT
    composition.id,
    ROW_NUMBER() OVER (
      PARTITION BY composition.organization_id, composition.material_component_id
      ORDER BY
        (composition.active_revision_id IS NOT NULL) DESC,
        COALESCE(revision.latest_revision_number, 0) DESC,
        COALESCE(draft.current_version, 0) DESC,
        GREATEST(composition.updated_at, COALESCE(draft.updated_at, composition.updated_at)) DESC,
        composition.created_at DESC,
        composition.id DESC
    ) AS position
  FROM public.video_compositions AS composition
  LEFT JOIN public.video_composition_drafts AS draft
    ON draft.composition_id = composition.id
  LEFT JOIN LATERAL (
    SELECT MAX(item.revision_number) AS latest_revision_number
    FROM public.video_composition_revisions AS item
    WHERE item.composition_id = composition.id
  ) AS revision ON true
  WHERE composition.status <> 'ARCHIVED'
    AND composition.material_component_id IS NOT NULL
)
UPDATE public.video_compositions AS composition
SET status = 'ARCHIVED'
FROM composition_progress AS progress
WHERE composition.id = progress.id
  AND progress.position > 1;

UPDATE public.video_composition_drafts AS draft
SET state = 'ARCHIVED'
FROM public.video_compositions AS composition
WHERE composition.id = draft.composition_id
  AND composition.status = 'ARCHIVED'
  AND draft.state <> 'ARCHIVED';

CREATE UNIQUE INDEX IF NOT EXISTS video_compositions_unique_active_component
  ON public.video_compositions (organization_id, material_component_id)
  WHERE material_component_id IS NOT NULL
    AND status <> 'ARCHIVED';

COMMENT ON INDEX public.video_compositions_unique_active_component IS
  'Prevents concurrent editor initialization from creating multiple active compositions for one material component.';

-- The assembly bridge owns one active SOURCE_MEDIA provenance row per stored
-- object. Older duplicates remain auditable as archived rows.
WITH ranked_source_assets AS (
  SELECT
    asset.id,
    ROW_NUMBER() OVER (
      PARTITION BY
        asset.organization_id,
        asset.material_component_id,
        asset.asset_type,
        asset.storage_bucket,
        asset.storage_path
      ORDER BY
        EXISTS (
          SELECT 1
          FROM public.video_composition_draft_assets AS draft_asset
          JOIN public.video_composition_drafts AS draft
            ON draft.id = draft_asset.draft_id
          WHERE draft_asset.production_asset_id = asset.id
            AND draft.state <> 'ARCHIVED'
        ) DESC,
        asset.created_at DESC,
        asset.id DESC
    ) AS position
  FROM public.production_assets AS asset
  WHERE asset.asset_type = 'SOURCE_MEDIA'
    AND asset.qa_status IS DISTINCT FROM 'ARCHIVED'
    AND asset.material_component_id IS NOT NULL
    AND asset.storage_bucket IS NOT NULL
    AND asset.storage_path IS NOT NULL
)
UPDATE public.production_assets AS asset
SET qa_status = 'ARCHIVED'
FROM ranked_source_assets AS ranked
WHERE asset.id = ranked.id
  AND ranked.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS production_assets_unique_active_source_object
  ON public.production_assets (
    organization_id,
    material_component_id,
    asset_type,
    storage_bucket,
    storage_path
  )
  WHERE asset_type = 'SOURCE_MEDIA'
    AND qa_status IS DISTINCT FROM 'ARCHIVED'
    AND material_component_id IS NOT NULL
    AND storage_bucket IS NOT NULL
    AND storage_path IS NOT NULL;

COMMENT ON INDEX public.production_assets_unique_active_source_object IS
  'Makes Production-to-assembly source synchronization idempotent across concurrent requests.';
