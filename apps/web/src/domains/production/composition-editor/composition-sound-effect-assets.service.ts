import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Resolves the intersection of draft-linked and tenant-owned READY effects.
 *
 * Keep these as two explicit queries. PostgREST represents a many-to-one
 * embedded relation as an object, while one-to-many is an array; authorization
 * must not depend on that response-shape distinction.
 */
export async function readReadyLinkedSoundEffectAssetIds(params: {
  draftId: string;
  organizationId: string;
  soundEffectAssetIds: readonly string[];
  supabase: SupabaseClient<any, "public", any>;
}): Promise<Set<string>> {
  const requestedIds = [...new Set(params.soundEffectAssetIds)];
  if (requestedIds.length === 0) return new Set();

  const [linksResult, assetsResult] = await Promise.all([
    params.supabase
      .from("video_composition_draft_sound_effect_assets")
      .select("sound_effect_asset_id")
      .eq("draft_id", params.draftId)
      .eq("organization_id", params.organizationId)
      .in("sound_effect_asset_id", requestedIds),
    params.supabase
      .from("sound_effect_assets")
      .select("id")
      .eq("organization_id", params.organizationId)
      .eq("status", "READY")
      .in("id", requestedIds),
  ]);

  if (linksResult.error) throw linksResult.error;
  if (assetsResult.error) throw assetsResult.error;

  const linkedIds = toStringIdSet(linksResult.data, "sound_effect_asset_id");
  const readyIds = toStringIdSet(assetsResult.data, "id");
  return new Set(requestedIds.filter((id) => linkedIds.has(id) && readyIds.has(id)));
}

function toStringIdSet(rows: unknown, key: string) {
  if (!Array.isArray(rows)) return new Set<string>();
  return new Set(rows.flatMap((row: unknown) => {
    if (!row || typeof row !== "object") return [];
    const value = (row as Record<string, unknown>)[key];
    return typeof value === "string" ? [value] : [];
  }));
}
