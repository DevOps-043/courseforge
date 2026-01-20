-- Script para corregir la configuración de curación y evitar errores de cuota (429)
-- Se cambia al modelo gemini-2.0-flash que tiene límites confirmados de 2000 RPM en tu cuenta.

UPDATE public.curation_settings 
SET 
    model_name = 'gemini-2.0-flash',      -- Modelo principal (Límite: 2000 RPM)
    fallback_model = 'gemini-1.5-flash',  -- Fallback seguro
    temperature = 0.5,
    updated_at = NOW()
WHERE id = 1;

-- Asegurarnos de que el registro existe si no lo estaba
INSERT INTO public.curation_settings (id, model_name, fallback_model, temperature, thinking_level, is_active)
SELECT 1, 'gemini-2.0-flash', 'gemini-1.5-flash', 0.5, 'medium', true
WHERE NOT EXISTS (SELECT 1 FROM public.curation_settings WHERE id = 1);

