-- Script para actualizar la configuración de los modelos de validación (Paso 4)
-- Este script configura los modelos '3-pro-review' y '3-flash-review' según lo solicitado.

INSERT INTO public.curation_settings (
    id, 
    model_name, 
    fallback_model, 
    temperature, 
    thinking_level, 
    is_active, 
    updated_at,
    created_at
)
VALUES (
    1,                  -- ID fijo para la configuración principal
    '3-pro-review',     -- Modelo Principal (Evaluación)
    '3-flash-review',   -- Fallback (Respaldo)
    0.3,                -- Temperatura (Baja para mayor consistencia en validaciones)
    'high',             -- Nivel de "thinking" si aplica (campo visto en tu DB)
    true,               -- Activo
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    model_name = EXCLUDED.model_name,
    fallback_model = EXCLUDED.fallback_model,
    temperature = EXCLUDED.temperature,
    thinking_level = EXCLUDED.thinking_level,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();
