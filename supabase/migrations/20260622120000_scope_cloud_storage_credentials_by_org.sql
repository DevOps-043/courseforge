ALTER TABLE public.user_cloud_storage_credentials
    ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid(),
    ADD COLUMN IF NOT EXISTS organization_id uuid NULL;

ALTER TABLE public.user_cloud_storage_credentials
    ADD CONSTRAINT user_cloud_storage_credentials_organization_id_fkey
    FOREIGN KEY (organization_id)
    REFERENCES public.organizations(id)
    ON DELETE CASCADE;

ALTER TABLE public.user_cloud_storage_credentials
    DROP CONSTRAINT IF EXISTS user_cloud_storage_credentials_pkey;

ALTER TABLE public.user_cloud_storage_credentials
    ADD CONSTRAINT user_cloud_storage_credentials_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS user_cloud_storage_credentials_user_org_provider_uidx
    ON public.user_cloud_storage_credentials (user_id, organization_id, provider)
    WHERE organization_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_cloud_storage_credentials_legacy_user_provider_uidx
    ON public.user_cloud_storage_credentials (user_id, provider)
    WHERE organization_id IS NULL;

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
