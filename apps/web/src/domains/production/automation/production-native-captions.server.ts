import { getOrCreateHyperframesCompositionDraft } from "../hyperframes/hyperframes-composition.service";
import { initializeHyperframesDraft } from "../hyperframes/hyperframes-draft.service";
import { applyAndAppendCompositionDocumentPatches, CompositionDocumentConflictError, getCurrentCompositionDocument } from "../composition-editor/composition-document.service";
import type { ProductionNativeCaptionPorts } from "./production-native-captions.service";

/** Los servicios existentes comprueban pertenencia y append atómico por organización/hash. */
export function productionNativeCaptionPorts(supabase: Parameters<typeof getCurrentCompositionDocument>[0]["supabase"]): ProductionNativeCaptionPorts {
  return {
    async prepare(context) {
      const { composition } = await getOrCreateHyperframesCompositionDraft({
        componentId: context.componentId, createdBy: context.userId, name: "Composición de producción",
        organizationId: context.organizationId, supabase,
      });
      const draft = await initializeHyperframesDraft({ compositionId: composition.id,
        organizationId: context.organizationId, userId: context.userId, supabase });
      return draft.draftId;
    },
    read: scope => getCurrentCompositionDocument({ ...scope, supabase }),
    append: ({ operations, ...scope }) => applyAndAppendCompositionDocumentPatches({ ...scope, supabase,
      auditSource: "SYSTEM", patch: { operations, source: "AGENT", summary: "Generó subtítulos transparentes automáticamente desde la voz." } }),
    isConflict: error => error instanceof CompositionDocumentConflictError,
  };
}
