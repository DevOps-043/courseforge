-- Prompt version history and deterministic active prompt resolution.

ALTER TABLE public.system_prompts
  ADD COLUMN IF NOT EXISTS parent_prompt_id uuid REFERENCES public.system_prompts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'SEED',
  ADD COLUMN IF NOT EXISTS change_summary text,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_system_prompts_code_org_active_updated
  ON public.system_prompts (code, organization_id, is_active, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_system_prompts_parent
  ON public.system_prompts (parent_prompt_id);

WITH ranked AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY code, organization_id
      ORDER BY
        is_active DESC,
        updated_at DESC,
        created_at DESC,
        id DESC
    ) AS rank
  FROM public.system_prompts
  WHERE is_active = true
)
UPDATE public.system_prompts prompt
SET is_active = false
FROM ranked
WHERE prompt.id = ranked.id
  AND ranked.rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_system_prompts_one_active_per_scope
  ON public.system_prompts (code, COALESCE(organization_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE is_active = true;
