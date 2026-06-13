-- Prevent generated quizzes whose answer options are only labels such as A/B/C/D.
-- These options render as unlabeled choices for learners and cannot be repaired safely
-- unless the original option text exists elsewhere in the same JSON payload.

UPDATE public.system_prompts
SET
  content = content || E'\n- Cada opcion debe contener contenido pedagogico sustantivo. Nunca generes opciones que sean solo "A", "B", "C", "D", numeros, etiquetas vacias o placeholders.',
  updated_at = NOW()
WHERE code = 'MATERIALS_QUIZ'
  AND is_active = TRUE
  AND content NOT ILIKE '%contenido pedagogico sustantivo%';
