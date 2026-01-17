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
  CONSTRAINT instructional_plans_pkey PRIMARY KEY (id),
  CONSTRAINT instructional_plans_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.material_blockers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  materials_id uuid NOT NULL,
  lesson_id text,
  component_type text,
  code text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'error'::text,
  auto_generated boolean DEFAULT false,
  status text NOT NULL DEFAULT 'OPEN'::text CHECK (status = ANY (ARRAY['OPEN'::text, 'MITIGATING'::text, 'ACCEPTED'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  CONSTRAINT material_blockers_pkey PRIMARY KEY (id),
  CONSTRAINT material_blockers_materials_id_fkey FOREIGN KEY (materials_id) REFERENCES public.materials(id)
);
CREATE TABLE public.material_components (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  material_lesson_id uuid NOT NULL,
  type text NOT NULL,
  content jsonb NOT NULL,
  source_refs ARRAY DEFAULT '{}'::text[],
  validation_status text NOT NULL DEFAULT 'PENDING'::text,
  validation_errors ARRAY DEFAULT '{}'::text[],
  generated_at timestamp with time zone NOT NULL DEFAULT now(),
  iteration_number integer NOT NULL DEFAULT 1,
  CONSTRAINT material_components_pkey PRIMARY KEY (id),
  CONSTRAINT material_components_material_lesson_id_fkey FOREIGN KEY (material_lesson_id) REFERENCES public.material_lessons(id)
);
CREATE TABLE public.material_lessons (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  materials_id uuid NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  module_id text NOT NULL,
  module_title text NOT NULL,
  oa_text text NOT NULL,
  expected_components ARRAY NOT NULL DEFAULT '{}'::text[],
  quiz_spec jsonb,
  requires_demo_guide boolean DEFAULT false,
  dod jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'PENDING'::text,
  iteration_count integer NOT NULL DEFAULT 0,
  max_iterations integer NOT NULL DEFAULT 2,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT material_lessons_pkey PRIMARY KEY (id),
  CONSTRAINT material_lessons_materials_id_fkey FOREIGN KEY (materials_id) REFERENCES public.materials(id)
);
CREATE TABLE public.materials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  prompt_version text NOT NULL DEFAULT 'default'::text,
  state text NOT NULL DEFAULT 'PHASE3_DRAFT'::text,
  qa_decision jsonb,
  package jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  lessons jsonb DEFAULT '[]'::jsonb,
  global_blockers jsonb DEFAULT '[]'::jsonb,
  dod jsonb DEFAULT '{"checklist": [], "automatic_checks": []}'::jsonb,
  CONSTRAINT materials_pkey PRIMARY KEY (id),
  CONSTRAINT materials_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid,
  artifact_id uuid,
  title text NOT NULL DEFAULT ''::text,
  content text NOT NULL DEFAULT ''::text,
  tags ARRAY DEFAULT '{}'::text[],
  color text DEFAULT 'default'::text,
  is_pinned boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT notes_pkey PRIMARY KEY (id),
  CONSTRAINT notes_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT notes_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.pipeline_events (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  artifact_id uuid NOT NULL,
  event_type text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  step_id text,
  entity_id text,
  entity_type text,
  CONSTRAINT pipeline_events_pkey PRIMARY KEY (id),
  CONSTRAINT pipeline_events_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
CREATE TABLE public.production_evidence (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL,
  type USER-DEFINED NOT NULL,
  url text,
  label text NOT NULL,
  metadata_json jsonb DEFAULT '{}'::jsonb,
  captured_by uuid,
  captured_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT production_evidence_pkey PRIMARY KEY (id),
  CONSTRAINT production_evidence_task_id_fkey FOREIGN KEY (task_id) REFERENCES public.production_tasks(id),
  CONSTRAINT production_evidence_captured_by_fkey FOREIGN KEY (captured_by) REFERENCES auth.users(id)
);
CREATE TABLE public.production_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL,
  module_id text,
  lesson_id text NOT NULL,
  video_id text NOT NULL,
  step_id USER-DEFINED NOT NULL,
  state USER-DEFINED NOT NULL DEFAULT 'NOT_STARTED'::production_task_state,
  owner_user_id uuid,
  qa_user_id uuid,
  blocked_reason text,
  escalated_to_role USER-DEFINED,
  checklist_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  started_at timestamp with time zone,
  submitted_at timestamp with time zone,
  approved_at timestamp with time zone,
  CONSTRAINT production_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT production_tasks_course_id_fkey FOREIGN KEY (course_id) REFERENCES public.artifacts(id),
  CONSTRAINT production_tasks_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES auth.users(id),
  CONSTRAINT production_tasks_qa_user_id_fkey FOREIGN KEY (qa_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.qa_sessions (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  artifact_id uuid NOT NULL,
  reviewer_id uuid,
  decision USER-DEFINED,
  feedback text,
  suggestions jsonb NOT NULL DEFAULT '[]'::jsonb,
  started_at timestamp with time zone NOT NULL DEFAULT now(),
  completed_at timestamp with time zone,
  CONSTRAINT qa_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT qa_sessions_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id),
  CONSTRAINT qa_sessions_reviewer_id_fkey FOREIGN KEY (reviewer_id) REFERENCES auth.users(id)
);
CREATE TABLE public.slide_blockers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slides_id uuid NOT NULL,
  video_id text NOT NULL,
  code text NOT NULL,
  message text NOT NULL,
  severity text NOT NULL DEFAULT 'ERROR'::text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  resolved_at timestamp with time zone,
  resolved_by text,
  CONSTRAINT slide_blockers_pkey PRIMARY KEY (id),
  CONSTRAINT slide_blockers_slides_id_fkey FOREIGN KEY (slides_id) REFERENCES public.slides(id)
);
CREATE TABLE public.slide_videos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  slides_id uuid NOT NULL,
  video_id text NOT NULL,
  lesson_id text NOT NULL,
  lesson_title text NOT NULL,
  module_id text NOT NULL,
  module_title text NOT NULL,
  module_index integer NOT NULL,
  lesson_index integer NOT NULL,
  tn_mn_vn text NOT NULL,
  script jsonb,
  storyboard jsonb,
  gamma_deck jsonb,
  png_export jsonb,
  dod jsonb NOT NULL DEFAULT '{}'::jsonb,
  state text NOT NULL DEFAULT 'PENDING'::text,
  iteration_count integer NOT NULL DEFAULT 0,
  max_iterations integer NOT NULL DEFAULT 2,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT slide_videos_pkey PRIMARY KEY (id),
  CONSTRAINT slide_videos_slides_id_fkey FOREIGN KEY (slides_id) REFERENCES public.slides(id)
);
CREATE TABLE public.slides (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,
  version integer NOT NULL DEFAULT 1,
  branding jsonb NOT NULL DEFAULT '{"fonts": [], "palette": []}'::jsonb,
  state text NOT NULL DEFAULT 'STEP6_DRAFT'::text,
  qa_decision jsonb,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  videos jsonb DEFAULT '[]'::jsonb,
  global_blockers jsonb DEFAULT '[]'::jsonb,
  dod jsonb DEFAULT '{"checklist": [], "automatic_checks": []}'::jsonb,
  CONSTRAINT slides_pkey PRIMARY KEY (id),
  CONSTRAINT slides_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
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
CREATE TABLE public.user_roles (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL,
  role USER-DEFINED NOT NULL DEFAULT 'operator'::user_role,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_roles_pkey PRIMARY KEY (id),
  CONSTRAINT user_roles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.validations (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL,
  step_number integer NOT NULL,
  step_type text NOT NULL,
  validation_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  score numeric,
  status text NOT NULL DEFAULT 'PENDING'::text CHECK (status = ANY (ARRAY['PENDING'::text, 'IN_PROGRESS'::text, 'COMPLETED'::text, 'ERROR'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT validations_pkey PRIMARY KEY (id),
  CONSTRAINT validations_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);