-- Prevent duplicated A/B/C labels in generated quiz options.
-- The frontend is responsible for rendering option labels.

UPDATE public.system_prompts
SET
  content = content || E'\n- Las opciones deben ser texto limpio. NO incluyas prefijos, letras, numeros, bullets ni etiquetas como "A.", "B)", "C -", "1." dentro de cada opcion; el frontend rotula las opciones.',
  updated_at = NOW()
WHERE code = 'MATERIALS_QUIZ'
  AND is_active = TRUE
  AND content NOT ILIKE '%frontend rotula las opciones%';
