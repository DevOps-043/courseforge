-- migration: 20260611144100_create_user_google_credentials.sql

CREATE TABLE public.user_google_credentials (
    user_id uuid NOT NULL,
    google_email text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_google_credentials_pkey PRIMARY KEY (user_id),
    CONSTRAINT user_google_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

-- Habilitar RLS (Row Level Security)
ALTER TABLE public.user_google_credentials ENABLE ROW LEVEL SECURITY;

-- Políticas de Seguridad (Basadas en auth.uid() asignado por el Auth Bridge)
CREATE POLICY "Los usuarios solo pueden ver sus propias credenciales" 
    ON public.user_google_credentials
    FOR SELECT 
    USING (auth.uid() = user_id);

CREATE POLICY "Los usuarios solo pueden modificar sus propias credenciales" 
    ON public.user_google_credentials
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "El backend (service_role) tiene acceso total"
    ON public.user_google_credentials
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
