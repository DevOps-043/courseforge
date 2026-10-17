import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentCompositionDocument } from "./composition-document.service";
import type { NarrativeExtractionReadRepository } from "./composition-narrative-extraction-query";

export function createNarrativeExtractionReadRepository(
  supabase: SupabaseClient, signal: AbortSignal,
): NarrativeExtractionReadRepository {
  return {
    async readComponentId(draftId, organizationId) {
      const { data: draft, error } = await supabase.from("video_composition_drafts").select("composition_id")
        .eq("id", draftId).eq("organization_id", organizationId).abortSignal(signal).maybeSingle();
      if (error) throw error;
      if (!draft) return null;
      const { data: composition, error: compositionError } = await supabase.from("video_compositions").select("material_component_id")
        .eq("id", draft.composition_id).eq("organization_id", organizationId).abortSignal(signal).maybeSingle();
      if (compositionError) throw compositionError;
      return composition?.material_component_id ?? null;
    },
    async readDocument(draftId, organizationId) {
      signal.throwIfAborted();
      const current = await getCurrentCompositionDocument({ draftId, organizationId, supabase });
      signal.throwIfAborted();
      return current;
    },
    async readLinkedAsset(draftId, organizationId, componentId, assetId) {
      const { data: link, error } = await supabase.from("video_composition_draft_assets").select("production_asset_id")
        .eq("draft_id", draftId).eq("organization_id", organizationId).eq("production_asset_id", assetId)
        .abortSignal(signal).maybeSingle();
      if (error) throw error;
      if (!link) return null;
      const { data: asset, error: assetError } = await supabase.from("production_assets")
        .select("id, organization_id, material_component_id, asset_type, mime_type, checksum, qa_status, duration_milliseconds, metadata")
        .eq("id", assetId).eq("organization_id", organizationId).eq("material_component_id", componentId)
        .abortSignal(signal).maybeSingle();
      if (assetError) throw assetError;
      return asset;
    },
  };
}
