-- Migración para corregir las restricciones de clave foránea de 'created_by'
-- Esto permite que los usuarios del Auth Bridge (que existen en public.profiles pero no en auth.users)
-- puedan crear artefactos e importaciones SCORM.

BEGIN;

-- 1. Corregir tabla 'public.artifacts'
ALTER TABLE public.artifacts 
  DROP CONSTRAINT IF EXISTS artifacts_created_by_fkey;

ALTER TABLE public.artifacts 
  ADD CONSTRAINT artifacts_created_by_fkey 
  FOREIGN KEY (created_by) 
  REFERENCES public.profiles(id) 
  ON DELETE SET NULL;

-- 2. Corregir tabla 'public.scorm_imports'
ALTER TABLE public.scorm_imports 
  DROP CONSTRAINT IF EXISTS scorm_imports_created_by_fkey;

ALTER TABLE public.scorm_imports 
  ADD CONSTRAINT scorm_imports_created_by_fkey 
  FOREIGN KEY (created_by) 
  REFERENCES public.profiles(id) 
  ON DELETE SET NULL;

-- 3. Corregir tabla 'public.login_history' (ya apuntaba a profiles, pero nos aseguramos)
ALTER TABLE public.login_history 
  DROP CONSTRAINT IF EXISTS login_history_user_id_fkey;

ALTER TABLE public.login_history 
  ADD CONSTRAINT login_history_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES public.profiles(id) 
  ON DELETE CASCADE;

COMMIT;
