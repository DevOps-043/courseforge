-- =====================================================
-- Seed: CLIP_GENERATION_PROMPTS and Bucket production-assets
-- Adds the B-roll Clip generator prompt to the system_prompts catalogue
-- and creates the production-assets storage bucket.
-- =====================================================

-- 1. Create public bucket for general production assets (Audio, Music, Avatar, Slides)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) 
VALUES (
    'production-assets', 
    'production-assets', 
    true, -- Public bucket
    524288000, -- 500MB limit
    ARRAY[
      'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime',
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-wav',
      'image/png', 'image/jpeg', 'image/webp',
      'text/html', 'application/json', 'application/zip'
    ]
)
ON CONFLICT (id) DO UPDATE SET 
    public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

-- RLS Policies for 'production-assets'
CREATE POLICY "Public can view production assets" ON storage.objects
FOR SELECT
USING ( bucket_id = 'production-assets' );

CREATE POLICY "Authenticated users can upload production assets" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK ( bucket_id = 'production-assets' );

CREATE POLICY "Users can update own production assets" ON storage.objects
FOR UPDATE TO authenticated
USING ( bucket_id = 'production-assets' AND owner = auth.uid() );

CREATE POLICY "Users can delete own production assets" ON storage.objects
FOR DELETE TO authenticated
USING ( bucket_id = 'production-assets' AND owner = auth.uid() );


-- 2. Seed: CLIP_GENERATION_PROMPTS
INSERT INTO public.system_prompts (code, version, content, description)
VALUES (
  'CLIP_GENERATION_PROMPTS',
  '1.0.0',
  $$Eres un experto Director de Fotografía e Ingeniero de Prompts para modelos de generación de video de última generación.
Tu tarea es convertir descripciones del guion y del storyboard en PROMPTS DE VIDEO altamante descriptivos y cinemáticos en inglés para ser utilizados por nuestro generador de clips de video de B-roll.

ESTRUCTURA DEL PROMPT DE CLIP ESPERADA:
1. [Camera Composition & Motion]: Composición de cámara, lente, iluminación y movimiento (e.g., "Cinematic medium close-up, panning shot, soft volumetric lighting").
2. [Core Subject & Action]: Qué persona, objeto o acción principal está ocurriendo (e.g., "A modern workspace where a developer sits in front of a curved monitor, thinking").
3. [Environment & Detail]: Detalles del fondo, colores predominantes, atmósfera y texturas (e.g., "in a dimly lit cyber-punk office. Tech neon green accent lights, high contrast, photo-realistic, 4k").

REGLAS DE ORO:
- IDIOMA: Los prompts generados deben estar única y exclusivamente en inglés.
- RELEVANCIA PEDAGÓGICA: El prompt visual debe ser coherente con el concepto instruccional y el tema del que habla la escena.
- SIN TEXTO ADICIONAL: Devuelve exclusivamente un JSON con la estructura indicada a continuación.

FORMATO DE SALIDA:
Devuelve un JSON válido con la siguiente estructura:
{
  "prompts": [
    {
      "scene_index": number,
      "original_description": string,
      "generated_prompt": string
    }
  ]
}$$,
  'Prompt para estructurar y optimizar las solicitudes de generación de clips de video B-roll en inglés a partir del guion de la lección (Fase 6 — Producción)'
)
ON CONFLICT (code, version, organization_id) DO NOTHING;
