-- Native, versioned composition documents for the Courseforge editor.
-- The document is mutable only through optimistic versions; immutable render
-- revisions remain in video_composition_revisions.

CREATE TABLE IF NOT EXISTS public.video_composition_draft_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draft_id uuid NOT NULL REFERENCES public.video_composition_drafts(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  format text NOT NULL DEFAULT 'courseforge-composition-v1',
  document jsonb NOT NULL,
  document_hash text NOT NULL CHECK (document_hash ~ '^[a-f0-9]{64}$'),
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_composition_draft_documents_unique_version UNIQUE (draft_id, version)
);

CREATE INDEX IF NOT EXISTS idx_video_composition_draft_documents_current
  ON public.video_composition_draft_documents (draft_id, version DESC);

ALTER TABLE public.video_composition_draft_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_select_video_composition_draft_documents" ON public.video_composition_draft_documents
  FOR SELECT USING (organization_id::text = public.get_active_org_id());
CREATE POLICY "org_insert_video_composition_draft_documents" ON public.video_composition_draft_documents
  FOR INSERT WITH CHECK (organization_id::text = public.get_active_org_id());

COMMENT ON TABLE public.video_composition_draft_documents IS
  'Append-only, versioned native editor documents. Each approved render must originate from one exact document version.';
