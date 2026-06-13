CREATE TABLE IF NOT EXISTS public.user_cloud_storage_credentials (
    user_id uuid NOT NULL,
    provider text NOT NULL,
    account_email text NOT NULL,
    access_token text NOT NULL,
    refresh_token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    scopes text[] NOT NULL DEFAULT '{}',
    created_at timestamp with time zone NOT NULL DEFAULT now(),
    updated_at timestamp with time zone NOT NULL DEFAULT now(),
    CONSTRAINT user_cloud_storage_credentials_pkey PRIMARY KEY (user_id, provider),
    CONSTRAINT user_cloud_storage_credentials_provider_check CHECK (provider IN ('google_drive', 'onedrive')),
    CONSTRAINT user_cloud_storage_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE
);

ALTER TABLE public.user_cloud_storage_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can read their own cloud storage credentials"
    ON public.user_cloud_storage_credentials;
CREATE POLICY "Users can read their own cloud storage credentials"
    ON public.user_cloud_storage_credentials
    FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can modify their own cloud storage credentials"
    ON public.user_cloud_storage_credentials;
CREATE POLICY "Users can modify their own cloud storage credentials"
    ON public.user_cloud_storage_credentials
    FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role can manage cloud storage credentials"
    ON public.user_cloud_storage_credentials;
CREATE POLICY "Service role can manage cloud storage credentials"
    ON public.user_cloud_storage_credentials
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

DO $$
BEGIN
    IF to_regclass('public.user_google_credentials') IS NOT NULL THEN
        INSERT INTO public.user_cloud_storage_credentials (
            user_id,
            provider,
            account_email,
            access_token,
            refresh_token,
            expires_at,
            scopes,
            created_at,
            updated_at
        )
        SELECT
            user_id,
            'google_drive',
            google_email,
            access_token,
            refresh_token,
            expires_at,
            ARRAY['openid', 'email', 'profile', 'https://www.googleapis.com/auth/drive.file'],
            created_at,
            updated_at
        FROM public.user_google_credentials
        ON CONFLICT (user_id, provider) DO UPDATE SET
            account_email = EXCLUDED.account_email,
            access_token = EXCLUDED.access_token,
            refresh_token = EXCLUDED.refresh_token,
            expires_at = EXCLUDED.expires_at,
            scopes = EXCLUDED.scopes,
            updated_at = now();
    END IF;
END $$;
