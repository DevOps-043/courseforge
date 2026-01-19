-- ==============================================================================
-- SCRIPT: MODIFY THINKING LEVEL COLUMN TYPE
-- ==============================================================================

-- 1. Primero eliminamos la columna anterior si existía (o la modificamos)
-- Para evitar errores de conversión, lo más limpio es recrearla o cambiar el tipo explícitamente.

DO $$ 
BEGIN 
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'curation_settings' AND column_name = 'thinking_level') THEN
        -- Si ya existe como integer (o cualquier otro), la cambiamos a TEXT
        ALTER TABLE public.curation_settings 
        DROP COLUMN thinking_level;
        
        ALTER TABLE public.curation_settings 
        ADD COLUMN thinking_level text NOT NULL DEFAULT 'minimal';
    ELSE
        -- Si no existe, la creamos
        ALTER TABLE public.curation_settings 
        ADD COLUMN thinking_level text NOT NULL DEFAULT 'minimal';
    END IF;
END $$;

-- 2. Añadir restricción de valores permitidos (CHECK constraint)
ALTER TABLE public.curation_settings 
DROP CONSTRAINT IF EXISTS valid_thinking_level;

ALTER TABLE public.curation_settings 
ADD CONSTRAINT valid_thinking_level 
CHECK (thinking_level IN ('minimal', 'low', 'medium', 'high'));

-- 3. Actualizar el valor por defecto en la fila existente
UPDATE public.curation_settings 
SET thinking_level = 'minimal' 
WHERE id = 1;
