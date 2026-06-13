-- ============================================================================
-- Migration: Add composition_id to remotion_templates
-- Date: 2026-06-09
-- Description: Vincula cada plantilla con el slug estable de su composición
--   Remotion (registrada en apps/web/src/remotion/Root.tsx). Es el puente entre
--   el UUID de la plantilla (UI / production_jobs) y la composición a renderizar
--   tanto en el <Player> (preview) como en el render server-side (CLI).
-- ============================================================================

-- 1. Nueva columna (nullable: plantillas externas podrían no mapear aún)
ALTER TABLE public.remotion_templates
  ADD COLUMN IF NOT EXISTS composition_id text;

-- 2. Mapear las plantillas globales sembradas a su composición por nombre/rol
UPDATE public.remotion_templates
  SET composition_id = 'split-avatar'
  WHERE id = '8ef33d3c-9a48-433b-82a1-bd12822a105c';

UPDATE public.remotion_templates
  SET composition_id = 'full-slides'
  WHERE id = 'a2c3dbf9-2e02-4757-bbdf-a2c6d48c8dfa';

UPDATE public.remotion_templates
  SET composition_id = 'avatar-focus'
  WHERE id = 'cb2657e3-0d32-4d1a-bf41-86f21272de3b';

-- 3. Fallback determinista para cualquier plantilla sin mapeo explícito:
--    la composición 'full-slides' degrada con gracia ante assets faltantes.
UPDATE public.remotion_templates
  SET composition_id = 'full-slides'
  WHERE composition_id IS NULL;