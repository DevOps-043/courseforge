-- ==============================================================================
-- SCRIPT: ADD FALLBACK MODEL COLUMN
-- ==============================================================================

ALTER TABLE public.curation_settings 
ADD COLUMN IF NOT EXISTS fallback_model text NOT NULL DEFAULT 'gemini-2.0-flash';
