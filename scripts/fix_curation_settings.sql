-- Script para corregir y estructurar la configuración de Curation
-- 1. Restaura el modelo de búsqueda (ID 1).
-- 2. Añade columna 'setting_type' para distinguir entre Búsqueda y Validación.
-- 3. Añade el nuevo registro para Validación (ID 2).

-- A. Añadir columna de tipo (Si no existe) para diferenciar configuraciones
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'curation_settings' AND column_name = 'setting_type') THEN 
        ALTER TABLE public.curation_settings ADD COLUMN setting_type text DEFAULT 'SEARCH'; 
    END IF; 
END $$;

-- B. Restaurar Configuración de BÚSQUEDA (ID 1) a sus valores originales
UPDATE public.curation_settings
SET 
    model_name = 'gemini-2.5-flash',
    fallback_model = 'gemini-2.0-flash',
    temperature = 1.0,
    thinking_level = 'high',
    setting_type = 'SEARCH',
    is_active = true,
    updated_at = NOW()
WHERE id = 1;

-- C. Insertar Configuración de VALIDACIÓN (ID 2)
INSERT INTO public.curation_settings (
    id,
    setting_type,
    model_name,
    fallback_model,
    temperature,
    thinking_level,
    is_active,
    created_at,
    updated_at
) VALUES (
    2,
    'VALIDATION',
    '3-pro-review',
    '3-flash-review',
    0.3,
    'high',
    true,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO UPDATE SET
    setting_type = 'VALIDATION',
    model_name = '3-pro-review',
    fallback_model = '3-flash-review',
    temperature = 0.3,
    thinking_level = 'high',
    updated_at = NOW();

-- Nota: Si usas Supabase Table Editor y no ves la columna 'setting_type', recarga la página.
