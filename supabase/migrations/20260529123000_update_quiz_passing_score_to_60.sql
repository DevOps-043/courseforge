-- Align quiz passing policy to 60% without regenerating existing course content.

UPDATE public.system_prompts
SET content = replace(
  replace(
    replace(
      replace(
        replace(
          replace(content,
            'passing_score debe ser 80',
            'passing_score debe ser 60'
          ),
          '"passing_score": 80',
          '"passing_score": 60'
        ),
        'corte 80%',
        'corte 60%'
      ),
      'quiz ≥80%',
      'quiz ≥60%'
    ),
    '≥80%',
    '≥60%'
  ),
  '80%',
  '60%'
)
WHERE is_active = true
  AND content ~ '(80%|≥80|passing_score)';

CREATE OR REPLACE FUNCTION public.enforce_quiz_passing_score_60_for_org_prompts()
RETURNS trigger AS $$
BEGIN
  UPDATE public.system_prompts
  SET content = replace(
    replace(
      replace(
        replace(
          replace(
            replace(content,
              'passing_score debe ser 80',
              'passing_score debe ser 60'
            ),
            '"passing_score": 80',
            '"passing_score": 60'
          ),
          'corte 80%',
          'corte 60%'
        ),
        'quiz ≥80%',
        'quiz ≥60%'
      ),
      '≥80%',
      '≥60%'
    ),
    '80%',
    '60%'
  )
  WHERE organization_id = NEW.id
    AND is_active = true
    AND content ~ '(80%|≥80|passing_score)';

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS zz_enforce_quiz_passing_score_60_for_org_prompts ON public.organizations;

CREATE TRIGGER zz_enforce_quiz_passing_score_60_for_org_prompts
AFTER INSERT ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.enforce_quiz_passing_score_60_for_org_prompts();
