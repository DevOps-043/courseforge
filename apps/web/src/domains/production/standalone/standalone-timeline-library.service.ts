import type { SupabaseClient } from "@supabase/supabase-js";
import { loadStandaloneHtmlDecks } from "./standalone-html.service";
import { extractHyperframesAnimatedDeck } from "../hyperframes/hyperframes-source-asset.service";
import { createInitialCompositionDocument } from "../composition-editor/composition-document.factory";
import type { CompositionClip } from "../composition-editor/composition-document.types";

export function hasCanonicalHtmlSource(clip: CompositionClip, library: CompositionClip[]) {
  return library.some((candidate) => {
    const expected = candidate.source as unknown as Record<string, unknown>;
    const actual = clip.source as unknown as Record<string, unknown>;
    return Object.keys(actual).length === Object.keys(expected).length
      && Object.entries(expected).every(([key, value]) => actual[key] === value);
  });
}

/** Read prepared HTML only after checking the component's standalone ownership. */
export async function readStandaloneHtmlLibrary(params: {
  componentId: string; organizationId: string; supabase: SupabaseClient;
}) {
  const { data: project, error: projectError } = await params.supabase.from("standalone_assembly_projects")
    .select("id").eq("backing_component_id", params.componentId).eq("organization_id", params.organizationId).maybeSingle();
  if (projectError) throw projectError;
  if (!project) return [];
  const { data: component, error } = await params.supabase.from("material_components")
    .select("assets").eq("id", params.componentId).single();
  if (error) throw error;
  const deck = await loadStandaloneHtmlDecks({ ...params, legacy: extractHyperframesAnimatedDeck(component.assets) });
  if (!deck) return [];
  return createInitialCompositionDocument({ animatedDeck: deck, assets: [],
    plan: { title: "Biblioteca HTML", subtitle: "", accentColor: "#000000", durationSeconds: 5 },
  }).clips;
}
