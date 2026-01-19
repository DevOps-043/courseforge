-- Script CORRECTIVO para permitir múltiples configuraciones
-- El error 'single_row_check' indica que la tabla estaba restringida a solo 1 fila.
-- Vamos a eliminar esa restricción para poder guardar ambos modelos (Búsqueda y Validación).

-- 1. Eliminar la restricción que impide tener más de 1 fila
ALTER TABLE public.curation_settings DROP CONSTRAINT IF EXISTS single_row_check;

-- 2. Asegurarnos que existe la columna 'setting_type'
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'curation_settings' AND column_name = 'setting_type') THEN 
        ALTER TABLE public.curation_settings ADD COLUMN setting_type text DEFAULT 'SEARCH'; 
    END IF; 
END $$;

-- 3. Restaurar / Actualizar fila 1 (BÚSQUEDA)
UPDATE public.curation_settings
SET 
    model_name = 'gemini-2.5-flash',
    fallback_model = 'gemini-2.0-flash',
    temperature = 1.0,
    setting_type = 'SEARCH',
    updated_at = NOW()
WHERE id = 1;

-- 4. Insertar fila 2 (VALIDACIÓN)
INSERT INTO public.curation_settings (
    id, setting_type, model_name, fallback_model, temperature, thinking_level, is_active
) VALUES (
    2, 'VALIDATION', '3-pro-review', '3-flash-review', 0.3, 'high', true
)
ON CONFLICT (id) DO UPDATE SET
    model_name = '3-pro-review',
    fallback_model = '3-flash-review',
    setting_type = 'VALIDATION';
