import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompositionEditorDocument } from "../composition-editor/composition-document.types";
import { compositionDeckImageAssetIds } from "../composition-editor/composition-deck-image-aliases.server";
import { readGeneratedCourseDeckEditorial, GeneratedDeckReadError, type VerifiedGeneratedDeck } from "../slides/generation/course-deck-editorial-reader.server";

/** Un alias del documento no concede acceso. Solo el artefacto reconstruido y
 * verificado para este componente permite recuperar un vínculo ausente. */
export async function ensureGeneratedDeckDraftImageLinks(params: {
  componentId?: string; document: CompositionEditorDocument; draftId: string;
  organizationId: string; supabase: SupabaseClient; verified?: VerifiedGeneratedDeck;
}) {
  const ids = compositionDeckImageAssetIds(params.document);
  if (!ids.length) return;
  const { data, error } = await params.supabase.from("video_composition_draft_assets")
    .select("production_asset_id").eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId).in("production_asset_id", ids);
  if (error) throw error;
  const linked = new Set((data || []).map(row => row.production_asset_id as string));
  const missing = ids.filter(id => !linked.has(id));
  if (!missing.length) return;
  const verified = params.verified ?? (params.componentId ? await readGeneratedCourseDeckEditorial({
    componentId: params.componentId, organizationId: params.organizationId, supabase: params.supabase,
  }) : null);
  const allowed = new Set(verified?.artifact.fragments.flatMap(fragment => fragment.usedAssetIds));
  if (missing.some(id => !allowed.has(id))) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
  const { error: writeError } = await params.supabase.from("video_composition_draft_assets").upsert(missing.map(id => ({
    draft_id: params.draftId, organization_id: params.organizationId,
    production_asset_id: id, role: "IMAGE", source_reference: "DECK_DEPENDENCY",
  })), { onConflict: "draft_id,production_asset_id" });
  if (writeError) throw writeError;
}
