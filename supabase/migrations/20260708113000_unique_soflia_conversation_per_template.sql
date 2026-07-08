-- ============================================================================
-- Migration: One SofLIA conversation per Remotion template
-- Date: 2026-07-08
-- Description:
--   A Remotion template/bundle must have a single SofLIA Bundle Agent
--   conversation within an organization. This keeps chat history and generated
--   versions scoped to the intended bundle and prevents accidental overlap.
-- ============================================================================

WITH ranked_template_conversations AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY organization_id, template_id
      ORDER BY updated_at DESC, created_at DESC, id DESC
    ) AS conversation_rank
  FROM public.soflia_bundle_conversations
  WHERE template_id IS NOT NULL
)
UPDATE public.soflia_bundle_conversations AS conversation
SET
  template_id = NULL,
  status = 'ARCHIVED',
  updated_at = now()
FROM ranked_template_conversations AS ranked
WHERE conversation.id = ranked.id
  AND ranked.conversation_rank > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_soflia_bundle_conversations_org_template_unique
  ON public.soflia_bundle_conversations (organization_id, template_id)
  WHERE template_id IS NOT NULL;
