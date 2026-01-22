-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.artifacts (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  run_id text,
  course_id text,
  idea_central text NOT NULL,
  nombres jsonb NOT NULL DEFAULT '[]'::jsonb,
  objetivos jsonb NOT NULL DEFAULT '[]'::jsonb,
  descripcion jsonb NOT NULL DEFAULT '{}'::jsonb,
  state USER-DEFINED NOT NULL DEFAULT 'DRAFT'::artifact_state,
  validation_report jsonb,
  semantic_result jsonb,
  auto_retry_count integer NOT NULL DEFAULT 0,
  iteration_count integer NOT NULL DEFAULT 0,
  generation_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT artifacts_pkey PRIMARY KEY (id),
  CONSTRAINT artifacts_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id)
);
CREATE TABLE public.curation (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number = ANY (ARRAY[1, 2])),
  state text NOT NULL DEFAULT 'PHASE2_DRAFT'::text,
  qa_decision jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT curation_pkey PRIMARY KEY (id),
  CONSTRAINT curation_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.curation_blockers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  curation_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  component text NOT NULL,
  impact text NOT NULL,
  owner text NOT NULL,
  status text NOT NULL DEFAULT 'OPEN'::text CHECK (status = ANY (ARRAY['OPEN'::text, 'MITIGATING'::text, 'ACCEPTED'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT curation_blockers_pkey PRIMARY KEY (id),
  CONSTRAINT curation_blockers_curation_id_fkey FOREIGN KEY (curation_id) REFERENCES public.curation(id)
);
CREATE TABLE public.curation_rows (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  curation_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  component text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  source_ref text NOT NULL,
  source_title text,
  source_rationale text,
  url_status text NOT NULL DEFAULT 'PENDING'::text,
  http_status_code integer,
  last_checked_at timestamp with time zone,
  failure_reason text,
  apta boolean,
  motivo_no_apta text,
  cobertura_completa boolean,
  notes text,
  auto_evaluated boolean DEFAULT false,
  auto_reason text,
  forbidden_override boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT curation_rows_pkey PRIMARY KEY (id),
  CONSTRAINT curation_rows_curation_id_fkey FOREIGN KEY (curation_id) REFERENCES public.curation(id)
);
CREATE TABLE public.instructional_plans (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  lesson_plans jsonb NOT NULL DEFAULT '[]'::jsonb,
  blockers jsonb NOT NULL DEFAULT '[]'::jsonb,
  dod jsonb NOT NULL DEFAULT '{"checklist": [], "semantic_checks": [], "automatic_checks": []}'::jsonb,
  approvals jsonb NOT NULL DEFAULT '{"architect_status": "PENDING"}'::jsonb,
  final_status text,
  state text NOT NULL DEFAULT 'STEP_DRAFT'::text,
  iteration_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  validation jsonb,
  CONSTRAINT instructional_plans_pkey PRIMARY KEY (id),
  CONSTRAINT instructional_plans_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.login_history (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  login_at timestamp with time zone DEFAULT now(),
  ip_address text,
  user_agent text,
  metadata jsonb DEFAULT '{}'::jsonb,
  CONSTRAINT login_history_pkey PRIMARY KEY (id),
  CONSTRAINT login_history_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);
CREATE TABLE public.model_settings (
  id integer NOT NULL DEFAULT 1,
  model_name text NOT NULL DEFAULT 'gemini-2.0-flash'::text,
  temperature numeric NOT NULL DEFAULT 0.20,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  fallback_model text NOT NULL DEFAULT 'gemini-2.0-flash'::text,
  thinking_level text NOT NULL DEFAULT 'minimal'::text CHECK (thinking_level = ANY (ARRAY['minimal'::text, 'low'::text, 'medium'::text, 'high'::text])),
  setting_type text DEFAULT 'SEARCH'::text,
  CONSTRAINT model_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.organizations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  logo_url text,
  is_active boolean DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT organizations_pkey PRIMARY KEY (id)
);
CREATE TABLE public.profiles (
  id uuid NOT NULL,
  username text UNIQUE,
  email text,
  first_name text,
  last_name_father text,
  last_name_mother text,
  avatar_url text,
  platform_role USER-DEFINED NOT NULL DEFAULT 'CONSTRUCTOR'::app_role,
  organization_id uuid,
  organization_role text,
  is_active boolean DEFAULT true,
  last_login_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT profiles_pkey PRIMARY KEY (id),
  CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id),
  CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id)
);
CREATE TABLE public.syllabus (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  route text NOT NULL DEFAULT 'B_NO_SOURCE'::text CHECK (route = ANY (ARRAY['A_WITH_SOURCE'::text, 'B_NO_SOURCE'::text])),
  modules jsonb NOT NULL DEFAULT '[]'::jsonb,
  source_summary jsonb,
  validation jsonb NOT NULL DEFAULT '{"checks": [], "automatic_pass": false}'::jsonb,
  qa jsonb NOT NULL DEFAULT '{"status": "PENDING"}'::jsonb,
  state text NOT NULL DEFAULT 'STEP_DRAFT'::text,
  iteration_count integer NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT syllabus_pkey PRIMARY KEY (id),
  CONSTRAINT syllabus_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.system_prompts (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  code text NOT NULL,
  version text NOT NULL DEFAULT '1.0.0'::text,
  content text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT system_prompts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.user_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  token_hash text NOT NULL,
  device_info text,
  ip_address text,
  is_active boolean DEFAULT true,
  expires_at timestamp with time zone NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  last_accessed_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id)
);