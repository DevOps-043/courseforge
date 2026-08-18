-- Gemini 2.0 Flash was shut down on 2026-06-01. Keep existing tenants from
-- failing every agent edit after the provider retirement.
UPDATE public.video_composition_generation_settings
SET agent_model = 'gemini-3.5-flash',
    updated_at = now()
WHERE agent_model IN ('gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-exp');
