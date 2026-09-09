-- Repair environments where the global materials prompt remained on the
-- word-budget contract even after the character-budget migration shipped.

BEGIN;

DO $migration$
DECLARE
  active_prompt public.system_prompts%ROWTYPE;
  upgraded_content text;
BEGIN
  SELECT prompt.*
  INTO active_prompt
  FROM public.system_prompts AS prompt
  WHERE prompt.code = 'MATERIALS_SYSTEM'
    AND prompt.organization_id IS NULL
    AND prompt.is_active = true
  ORDER BY prompt.updated_at DESC, prompt.created_at DESC, prompt.id DESC
  LIMIT 1;

  IF active_prompt.id IS NULL
    OR active_prompt.content LIKE '%900 caracteres por minuto%'
  THEN
    RETURN;
  END IF;

  upgraded_content := replace(
    active_prompt.content,
    '- La narración debe cumplir el presupuesto de palabras sin exceder el máximo.',
    concat_ws(E'\n',
      '- Para dimensionar editorialmente el guion, usa 900 caracteres por minuto como referencia.',
      '- El rango objetivo obligatorio es ±5 % de targetCharacterCount.',
      '- minimumWordCount, targetWordCount y maximumWordCount son metadatos para TTS; no gobiernan la extensión del guion.',
      '- duration_estimate_minutes, duration_seconds y timecodes se derivan en servidor desde la narración.'
    )
  );
  upgraded_content := replace(
    upgraded_content,
    '- duración, palabras y timecodes coherentes;',
    '- caracteres editoriales, duración derivada y timecodes coherentes;'
  );

  IF upgraded_content NOT LIKE '%900 caracteres por minuto%' THEN
    RAISE EXCEPTION
      'MATERIALS_SYSTEM active prompt cannot be upgraded safely: expected legacy marker was not found';
  END IF;

  UPDATE public.system_prompts AS prompt
  SET is_active = false, updated_at = now()
  WHERE prompt.code = 'MATERIALS_SYSTEM'
    AND prompt.organization_id IS NULL
    AND prompt.is_active = true;

  INSERT INTO public.system_prompts (
    code,
    version,
    content,
    description,
    scope,
    is_active,
    organization_id,
    parent_prompt_id,
    source,
    change_summary,
    created_at,
    updated_at
  ) VALUES (
    'MATERIALS_SYSTEM',
    '3.2.0',
    upgraded_content,
    'Producción global de materiales con caracteres como métrica canónica',
    COALESCE(active_prompt.scope, 'Cursos'),
    true,
    NULL,
    active_prompt.id,
    'SEED',
    'Elimina la ambigüedad palabras/caracteres y deriva duración y timecodes en servidor.',
    now(),
    now()
  );
END
$migration$;

COMMIT;
