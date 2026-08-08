-- Separate SofLIA Bundle Agent conversations by artifact kind so HTML slide
-- template conversations do not consume the active video-bundle limit.

ALTER TABLE public.soflia_bundle_conversations
  ADD COLUMN IF NOT EXISTS artifact_kind text NOT NULL DEFAULT 'video_bundle';

ALTER TABLE public.soflia_bundle_conversations
  DROP CONSTRAINT IF EXISTS soflia_bundle_conversations_artifact_kind_check;

ALTER TABLE public.soflia_bundle_conversations
  ADD CONSTRAINT soflia_bundle_conversations_artifact_kind_check
  CHECK (artifact_kind IN ('video_bundle', 'slide_template'));

UPDATE public.soflia_bundle_conversations conversations
SET artifact_kind = 'slide_template'
WHERE artifact_kind = 'video_bundle'
  AND (
    conversations.title ILIKE '%slide%'
    OR conversations.title ILIKE '%diapositiva%'
    OR EXISTS (
      SELECT 1
      FROM public.soflia_bundle_specs specs
      WHERE specs.conversation_id = conversations.id
        AND specs.spec_json ->> 'artifactKind' = 'slide_template'
    )
  );

CREATE INDEX IF NOT EXISTS idx_soflia_bundle_conversations_org_kind_status
  ON public.soflia_bundle_conversations (organization_id, artifact_kind, status, updated_at DESC);
