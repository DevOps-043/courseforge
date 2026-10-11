import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import type { HtmlEditingBootstrapCatalogProvider } from "./composition-html-editing-bootstrap-host.server";
import { readGeneratedCourseDeckEditorial, GeneratedDeckReadError } from "../slides/generation/course-deck-editorial-reader.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { generatedDeckFontBindingsMatch } from "../slides/generation/course-deck-editorial-fonts.server";

/** Called only AFTER the bootstrap RPC authorizes actor, exact native source and
 * CAS. Material declarations are independently reconstructed, never installed
 * from Storage JSON, HTML markers, template IDs or client claims. */
export function generatedDeckBootstrapCatalog(supabase: SupabaseClient, operatorCatalog: string): HtmlEditingBootstrapCatalogProvider {
  return async (scope, signal) => {
    const effectiveSignal = signal ?? AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    effectiveSignal.throwIfAborted();
    const { data: draft, error } = await supabase.from("video_composition_drafts")
      .select("composition_id").eq("id", scope.documentId).eq("organization_id", scope.organizationId)
      .eq("state", "ACTIVE").abortSignal(effectiveSignal).maybeSingle();
    if (error || !draft || !z.string().uuid().safeParse(draft.composition_id).success) throw new GeneratedDeckReadError("UNAVAILABLE");
    const { data: composition, error: compositionError } = await supabase.from("video_compositions")
      .select("material_component_id").eq("id", draft.composition_id).eq("organization_id", scope.organizationId)
      .abortSignal(effectiveSignal).maybeSingle();
    if (compositionError || !composition) throw new GeneratedDeckReadError("UNAVAILABLE");
    const verified = composition.material_component_id ? await readGeneratedCourseDeckEditorial({
      componentId: composition.material_component_id, organizationId: scope.organizationId, supabase, signal: effectiveSignal,
    }) : null;
    if (verified) {
      const resolvedFonts = verified.fontBindings;
      if (!resolvedFonts || !generatedDeckFontBindingsMatch(verified.artifact.fontRequirements, resolvedFonts))
        throw new GeneratedDeckReadError("FONT_BINDING_REQUIRED");
      const instance = verified.instance(scope.clipId, scope.slideIndex);
      const savedFonts = scope.fontBindings ?? [];
      const fontsMatch = savedFonts.length === resolvedFonts.length && resolvedFonts.every(font =>
        savedFonts.some(saved => JSON.stringify(saved) === JSON.stringify(font)));
      if (instance.html === scope.sourceHtml && !fontsMatch) throw new GeneratedDeckReadError("FONT_BINDING_REQUIRED");
      if (instance.html === scope.sourceHtml && fontsMatch) return new HtmlEditingTemplateCatalog(JSON.stringify({
        format: "courseforge-html-editable-catalog-v1", organizationId: scope.organizationId, templates: [instance.template],
      }));
    }
    // Preserve the explicit operator-owned path for legacy/imported material.
    // No cross-tenant merge, synthesized legacy fields or permission fallback.
    return new HtmlEditingTemplateCatalog(operatorCatalog);
  };
}
