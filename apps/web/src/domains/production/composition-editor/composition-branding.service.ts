import type { SupabaseClient } from "@supabase/supabase-js";

export type AssemblyBrandingAsset = {
  checksum: string;
  durationMilliseconds: number;
  id: string;
  kind: "INTRO" | "OUTRO";
  mimeType: string;
  name: string;
  storageBucket: string;
  storagePath: string;
};

export type ResolvedAssemblyBranding = {
  intro: AssemblyBrandingAsset | null;
  introSource: "ASSEMBLY_OVERRIDE" | "GENERATED" | "ORG_DEFAULT";
  outro: AssemblyBrandingAsset | null;
};

/** Resolves only approved, tenant-owned branding. No client-provided asset id is trusted. */
export async function resolveAssemblyBranding(params: {
  draftId: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}): Promise<ResolvedAssemblyBranding> {
  const { data: settings, error: settingsError } = await params.supabase
    .from("organization_assembly_settings")
    .select("default_intro_asset_id, default_outro_asset_id, intro_enabled, outro_enabled")
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (settingsError) throw settingsError;
  const { data: draftBranding, error: draftError } = await params.supabase
    .from("video_composition_draft_branding")
    .select("intro_asset_id, intro_source, outro_asset_id")
    .eq("draft_id", params.draftId)
    .eq("organization_id", params.organizationId)
    .maybeSingle();
  if (draftError) throw draftError;
  const introId = draftBranding?.intro_asset_id || (settings?.intro_enabled ? settings.default_intro_asset_id : null);
  const outroId = draftBranding?.outro_asset_id || (settings?.outro_enabled ? settings.default_outro_asset_id : null);
  const ids = [introId, outroId].filter((id): id is string => typeof id === "string");
  if (ids.length === 0) return { intro: null, introSource: "ORG_DEFAULT", outro: null };
  const { data, error } = await params.supabase
    .from("organization_assembly_assets")
    .select("id, kind, name, storage_bucket, storage_path, mime_type, duration_milliseconds, checksum")
    .eq("organization_id", params.organizationId)
    .eq("status", "APPROVED")
    .in("id", ids);
  if (error) throw error;
  const byId = new Map((data || []).map((row) => [row.id as string, mapAsset(row)]));
  const intro = introId ? byId.get(introId) || null : null;
  const outro = outroId ? byId.get(outroId) || null : null;
  if (intro && intro.kind !== "INTRO") throw new Error("El asset configurado como intro tiene un tipo inválido.");
  if (outro && outro.kind !== "OUTRO") throw new Error("El asset configurado como outro tiene un tipo inválido.");
  return {
    intro,
    introSource: draftBranding?.intro_source === "ASSEMBLY_OVERRIDE" || draftBranding?.intro_source === "GENERATED"
      ? draftBranding.intro_source
      : "ORG_DEFAULT",
    outro,
  };
}

export function buildAssemblyBrandingSnapshot(asset: AssemblyBrandingAsset) {
  return {
    checksum: asset.checksum,
    duration_milliseconds: asset.durationMilliseconds,
    mime_type: asset.mimeType,
    name: asset.name,
    storage_bucket: asset.storageBucket,
    storage_path: asset.storagePath,
  };
}

function mapAsset(row: Record<string, unknown>): AssemblyBrandingAsset {
  return {
    checksum: String(row.checksum),
    durationMilliseconds: Number(row.duration_milliseconds),
    id: String(row.id),
    kind: row.kind === "OUTRO" ? "OUTRO" : "INTRO",
    mimeType: String(row.mime_type),
    name: String(row.name),
    storageBucket: String(row.storage_bucket),
    storagePath: String(row.storage_path),
  };
}
