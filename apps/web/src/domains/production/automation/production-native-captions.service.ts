import type { MaterialAssets } from "../../materials/types/materials.types";
import type { CompositionEditorDocument } from "../composition-editor/composition-document.types";
import { buildCompositionNarrativeScenes } from "../composition-editor/composition-narrative-source.service";
import { deriveCompositionScenes } from "../composition-editor/composition-scene.service";
import { createCompositionTranscriptCaptionPlan, buildCompositionTranscriptCaptionCues } from "../composition-editor/composition-transcript-caption.service";
import type { CompositionEditorPatchOperation } from "../composition-editor/editor-patch.types";
import type { ProductionNativeCaptionReadiness } from "./production-automation.types";

export interface ProductionNativeCaptionContext {
  componentId: string;
  organizationId: string;
  userId: string;
  itemId: string;
  assets: MaterialAssets | null;
  previous?: ProductionNativeCaptionReadiness;
  overwrite?: { clipId: string; documentHash: string };
}

export interface ProductionNativeCaptionPorts {
  prepare(context: ProductionNativeCaptionContext): Promise<string>;
  read(scope: { draftId: string; organizationId: string }): Promise<{ document: CompositionEditorDocument; documentHash: string }>;
  append(input: { draftId: string; organizationId: string; userId: string; expectedDocumentHash: string; operations: CompositionEditorPatchOperation[] }): Promise<unknown>;
  isConflict(error: unknown): boolean;
}

const review = (detail: string, hfId?: string): ProductionNativeCaptionReadiness => ({
  status: "REVIEW_REQUIRED", detail, ...(hfId ? { hfId } : {}),
});

type ProductionNativeCaptionPlan = {
  result: ProductionNativeCaptionReadiness;
  operations?: CompositionEditorPatchOperation[];
  overwriteClipId?: string;
};

/** La regeneración de contenido existente exige una orden puntual del revisor. */
export function planProductionNativeCaptions(document: CompositionEditorDocument, id: string, previous?: ProductionNativeCaptionReadiness, confirmedClipId?: string): ProductionNativeCaptionPlan {
  const captionLayers = document.clips.filter(clip => clip.source.type === "NATIVE_CAPTIONS");
  const scenes = deriveCompositionScenes(document);
  const visibleVoices = document.clips.filter(clip => !clip.hidden
    && document.tracks.some(track => track.id === clip.trackId && track.semanticRole === "VOICE" && !track.hidden));
  if (!visibleVoices.length || visibleVoices.some(clip => !clip.sceneId
    || !document.narrativeScenes?.some(scene => scene.id === clip.sceneId && scene.wordTimestamps?.some(word =>
      word.end > (clip.sourceOffsetSeconds || 0) && word.start < (clip.sourceOffsetSeconds || 0) + clip.durationSeconds)))) {
    return { result: { status: "WAITING_TIMESTAMPS", detail: "Faltan voces por escena con timestamps en el borrador.",
      ...(previous?.hfId ? { hfId: previous.hfId } : {}) } as ProductionNativeCaptionReadiness };
  }
  const cues = buildCompositionTranscriptCaptionCues({ durationSeconds: document.canvas.durationSeconds, scenes });
  if (captionLayers.length) {
    const existing = captionLayers[0]!;
    const source = existing.source;
    const track = document.tracks.find(candidate => candidate.id === existing.trackId);
    if (captionLayers.length === 1 && (existing.id === id || existing.hfId === previous?.hfId) && !existing.hidden && !track?.hidden
      && existing.startSeconds === 0 && existing.durationSeconds === document.canvas.durationSeconds
      && source.type === "NATIVE_CAPTIONS" && source.origin === "TRANSCRIPT" && source.style.backgroundOpacity === 0
      && JSON.stringify(source.cues) === JSON.stringify(cues)) {
      return { result: { status: "READY", detail: `${cues.length} subtítulos transparentes sincronizados.`, hfId: existing.hfId } as ProductionNativeCaptionReadiness };
    }
    const canOverwrite = captionLayers.length === 1 && Boolean(track) && !track?.locked;
    if (canOverwrite && confirmedClipId === existing.id) {
      const plan = createCompositionTranscriptCaptionPlan({ document, id, scenes, overwriteClipId: existing.id });
      return { operations: plan.operations, result: {
        status: "READY", detail: `${plan.cueCount} subtítulos regenerados con confirmación.`, hfId: existing.hfId,
      } as ProductionNativeCaptionReadiness };
    }
    return { result: review(canOverwrite
      ? "La capa de subtítulos contiene cambios. ¿Quieres sobrescribirla con los subtítulos generados desde la voz?"
      : "Hay varias capas de subtítulos o su pista está bloqueada. Revisa las capas en el editor antes de regenerarlas.", previous?.hfId),
      ...(canOverwrite ? { overwriteClipId: existing.id } : {}) };
  }
  if (previous?.hfId) return { result: review("La capa registrada fue retirada. No se recreará automáticamente.", previous.hfId) };
  const plan = createCompositionTranscriptCaptionPlan({ document, id, scenes });
  return {
    operations: plan.operations,
    result: { status: "READY", detail: `${plan.cueCount} subtítulos transparentes sincronizados.`, hfId: plan.hfId } as ProductionNativeCaptionReadiness,
  };
}

/** Se ejecuta después de comprobar aprobación y disponibilidad de assets en el run. */
export async function ensureProductionNativeCaptions(
  context: ProductionNativeCaptionContext,
  ports: ProductionNativeCaptionPorts,
): Promise<ProductionNativeCaptionReadiness> {
  try {
    if (!context.userId) return review("La ejecución no tiene un creador válido para registrar los subtítulos.", context.previous?.hfId);
    const scenes = context.assets ? buildCompositionNarrativeScenes(context.assets, null) : [];
    if (!scenes.length || scenes.some(scene => !scene.wordTimestamps?.length)) {
      return { status: "WAITING_TIMESTAMPS", detail: "Se requieren voces por escena con timestamps del guion actual. No se inició una transcripción adicional.",
        ...(context.previous?.hfId ? { hfId: context.previous.hfId } : {}) };
    }
    const draftId = await ports.prepare(context);
    const current = await ports.read({ draftId, organizationId: context.organizationId });
    const sceneById = new Map(scenes.map(scene => [scene.id, scene]));
    const voices = new Map(context.assets?.voice_clips?.map(voice => [voice.clip_id, voice]));
    const incompatibleVoice = current.document.clips.some(clip => {
      if (clip.hidden || !current.document.tracks.some(track => track.id === clip.trackId && track.semanticRole === "VOICE" && !track.hidden)) return false;
      const expected = sceneById.get(clip.sceneId || "");
      const actual = current.document.narrativeScenes?.find(scene => scene.id === clip.sceneId);
      const voice = voices.get(clip.sceneId || "");
      return !expected || !actual || actual.scriptHash !== expected.scriptHash
        || JSON.stringify(actual.wordTimestamps) !== JSON.stringify(expected.wordTimestamps)
        || !voice?.asset_id || clip.source.type !== "PRODUCTION_ASSET" || clip.source.productionAssetId !== voice.asset_id;
    });
    if (incompatibleVoice) return review("Las voces o los tiempos del borrador difieren de Producción. Revisa su sincronización antes de crear subtítulos.", context.previous?.hfId);
    const confirmedClipId = context.overwrite?.documentHash === current.documentHash ? context.overwrite.clipId : undefined;
    const plan = planProductionNativeCaptions(current.document, `auto-captions-${context.itemId}`, context.previous, confirmedClipId);
    if (plan.overwriteClipId) {
      plan.result.overwrite = { clipId: plan.overwriteClipId, documentHash: current.documentHash };
      if (context.overwrite) plan.result.detail = "La confirmación ya no corresponde a la capa o versión actual. Confirma nuevamente para sobrescribir.";
    }
    if (context.overwrite && (!confirmedClipId || !current.document.clips.some(clip => clip.id === confirmedClipId && clip.source.type === "NATIVE_CAPTIONS"))) {
      return { ...review("El documento cambió o la capa fue retirada. Revisa la versión actual antes de confirmar nuevamente.", context.previous?.hfId),
        ...(plan.result.overwrite ? { overwrite: plan.result.overwrite } : {}) };
    }
    if (plan.operations) {
      await ports.append({ draftId, organizationId: context.organizationId, userId: context.userId,
        expectedDocumentHash: current.documentHash, operations: plan.operations });
    }
    return plan.result;
  } catch (error) {
    if (ports.isConflict(error)) return review("El borrador cambió durante el guardado. Actualiza el estado para revisar los subtítulos.", context.previous?.hfId);
    return { status: "FAILED", detail: "No se pudieron confirmar los subtítulos automáticos. Revisa el borrador y actualiza el estado.",
      ...(context.previous?.hfId ? { hfId: context.previous.hfId } : {}) };
  }
}
