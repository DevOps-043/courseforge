-- Require explicit correct answers in generated quizzes.
-- TRUE_FALSE answers must map cleanly to the options consumed by SofLIA.

UPDATE public.system_prompts
SET
  content = content || E'\n- correct_answer es REQUERIDO para cada pregunta. En TRUE_FALSE debe ser exactamente "Verdadero" o "Falso", coherente con las opciones.',
  updated_at = NOW()
WHERE code = 'MATERIALS_QUIZ'
  AND is_active = TRUE
  AND content NOT ILIKE '%correct_answer es REQUERIDO%';
