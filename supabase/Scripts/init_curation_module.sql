-- ==============================================================================
-- SCRIPT DE INICIALIZACIÓN: MÓDULO DE CURADURÍA (PASO 4)
-- ==============================================================================
-- Este script crea las tablas y relaciones necesarias para el módulo de curaduría
-- de fuentes, alineado estrictamente con el esquema heredado para compatibilidad CSV.
-- ==============================================================================

-- 1. TABLA PRINCIPAL: curation
-- Representa una ejecución o estado de curaduría para un artefacto.
CREATE TABLE IF NOT EXISTS public.curation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'PHASE2_DRAFT'::text,
  qa_decision jsonb NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT curation_pkey PRIMARY KEY (id),
  CONSTRAINT curation_artifact_id_key UNIQUE (artifact_id),
  CONSTRAINT curation_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts (id) ON DELETE CASCADE,
  CONSTRAINT curation_attempt_number_check CHECK (attempt_number = ANY (ARRAY[1, 2]))
) TABLESPACE pg_default;

-- Índices para curation
CREATE INDEX IF NOT EXISTS idx_curation_artifact ON public.curation USING btree (artifact_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_curation_state ON public.curation USING btree (state) TABLESPACE pg_default;

-- Trigger para updated_at en curation
DROP TRIGGER IF EXISTS update_curation_updated_at ON public.curation;
CREATE TRIGGER update_curation_updated_at BEFORE UPDATE ON public.curation 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 2. TABLA DE FILAS: curation_rows
-- Representa cada fuente individual sugerida o añadida manualmente.
CREATE TABLE IF NOT EXISTS public.curation_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  curation_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  component text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  source_ref text NOT NULL,
  source_title text NULL,
  source_rationale text NULL,
  url_status text NOT NULL DEFAULT 'PENDING'::text,
  http_status_code integer NULL,
  last_checked_at timestamp with time zone NULL,
  failure_reason text NULL,
  apta boolean NULL,
  motivo_no_apta text NULL,
  cobertura_completa boolean NULL,
  notes text NULL,
  auto_evaluated boolean NULL DEFAULT false,
  auto_reason text NULL,
  forbidden_override boolean NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT curation_rows_pkey PRIMARY KEY (id),
  CONSTRAINT curation_rows_curation_id_fkey FOREIGN KEY (curation_id) REFERENCES public.curation (id) ON DELETE CASCADE
) TABLESPACE pg_default;

-- Índices para curation_rows
CREATE INDEX IF NOT EXISTS idx_curation_rows_curation ON public.curation_rows USING btree (curation_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_curation_rows_lesson ON public.curation_rows USING btree (lesson_id) TABLESPACE pg_default;
CREATE INDEX IF NOT EXISTS idx_curation_rows_status ON public.curation_rows USING btree (url_status) TABLESPACE pg_default;

-- Trigger para updated_at en curation_rows
DROP TRIGGER IF EXISTS update_curation_rows_updated_at ON public.curation_rows;
CREATE TRIGGER update_curation_rows_updated_at BEFORE UPDATE ON public.curation_rows 
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- 3. TABLA DE BLOQUEOS: curation_blockers
-- Representa impedimentos que bloquean el avance de la curaduría.
CREATE TABLE IF NOT EXISTS public.curation_blockers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  curation_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  component text NOT NULL,
  impact text NOT NULL,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  
  CONSTRAINT curation_blockers_pkey PRIMARY KEY (id),
  CONSTRAINT curation_blockers_curation_id_fkey FOREIGN KEY (curation_id) REFERENCES public.curation (id) ON DELETE CASCADE,
  CONSTRAINT curation_blockers_status_check CHECK (status = ANY (ARRAY['OPEN'::text, 'MITIGATING'::text, 'ACCEPTED'::text]))
) TABLESPACE pg_default;

-- Índices para curation_blockers
CREATE INDEX IF NOT EXISTS idx_curation_blockers_curation ON public.curation_blockers USING btree (curation_id) TABLESPACE pg_default;

-- ==============================================================================
-- FIN DEL SCRIPT
-- ==============================================================================
