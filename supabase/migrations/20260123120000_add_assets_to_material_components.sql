-- Add assets column to material_components table
ALTER TABLE public.material_components 
ADD COLUMN IF NOT EXISTS assets jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.material_components.assets IS 'Stores links and metadata for produced assets (slides, videos, screencasts)';
