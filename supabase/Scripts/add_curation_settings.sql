-- ==============================================================================
-- SCRIPT: ADD CURATION SETTINGS TABLE
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.curation_settings (
    id integer NOT NULL DEFAULT 1,
    model_name text NOT NULL DEFAULT 'gemini-2.0-flash',
    temperature numeric(3,2) NOT NULL DEFAULT 0.20,
    thinking_level integer NOT NULL DEFAULT 0, -- 0 = desactivado, >0 = budget de tokens (si aplica) o nivel abstracto
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    
    CONSTRAINT curation_settings_pkey PRIMARY KEY (id),
    CONSTRAINT single_row_check CHECK (id = 1) -- Asegura que solo haya una fila de configuración global
);

-- Insertar configuración por defecto
INSERT INTO public.curation_settings (id, model_name, temperature, thinking_level, is_active)
VALUES (1, 'gemini-2.0-flash', 0.1, 0, true)
ON CONFLICT (id) DO UPDATE 
SET updated_at = now();

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_curation_settings_updated_at ON public.curation_settings;
CREATE TRIGGER update_curation_settings_updated_at BEFORE UPDATE ON public.curation_settings 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Habilitar RLS (opcional, pero recomendado)
ALTER TABLE public.curation_settings ENABLE ROW LEVEL SECURITY;

-- Política de lectura pública (o restricta a admin, según necesidad, aquí lo dejamos abierto para lectura del background)
CREATE POLICY "Allow read access for all users" ON public.curation_settings FOR SELECT USING (true);
CREATE POLICY "Allow update for service role only" ON public.curation_settings FOR UPDATE USING (auth.role() = 'service_role');
