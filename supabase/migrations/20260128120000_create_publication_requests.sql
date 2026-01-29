CREATE TABLE public.publication_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  artifact_id uuid NOT NULL UNIQUE,

  -- Campos adicionales para Soflia
  category text NOT NULL,
  level text NOT NULL CHECK (level IN ('beginner', 'intermediate', 'advanced')),
  instructor_email text NOT NULL,  -- Email del instructor en Soflia
  thumbnail_url text,
  slug text NOT NULL,
  price numeric DEFAULT 0.00,

  -- Información de videos por lección (JSONB)
  lesson_videos jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Estructura: [{ lesson_id: string, video_provider: string, video_provider_id: string, duration_seconds: number }]

  -- Estado de la solicitud
  status text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'READY', 'SENT', 'APPROVED', 'REJECTED')),

  -- Respuesta de Soflia
  soflia_course_id uuid,
  soflia_response jsonb,
  sent_at timestamp with time zone,
  response_at timestamp with time zone,
  rejection_reason text,

  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT publication_requests_pkey PRIMARY KEY (id),
  CONSTRAINT publication_requests_artifact_id_fkey FOREIGN KEY (artifact_id) REFERENCES public.artifacts(id)
);
