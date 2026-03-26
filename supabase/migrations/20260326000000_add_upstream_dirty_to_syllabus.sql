-- Migration: Add upstream dirty tracking to syllabus table
-- Date: 2026-03-26

ALTER TABLE public.syllabus 
ADD COLUMN IF NOT EXISTS upstream_dirty boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS upstream_dirty_source text;

-- No new RLS needed as org_update_syllabus already covers all columns
