import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionEditorCommandId } from "./composition-editor-command-palette";
import type {
  CompositionSelectionAlignment,
  CompositionSelectionDistributionAxis,
} from "./composition-selection-layout.service";

export type CompositionCommandPaletteItem = Readonly<{
  active?: boolean;
  disabledReason?: string;
  enabled: boolean;
  id: CompositionEditorCommandId;
}>;

export type CompositionCommandPaletteContext = Readonly<{
  agentProposalActive: boolean;
  canPaste: boolean;
  canRedo: boolean;
  canUndo: boolean;
  directEditingEnabled: boolean;
  document: CompositionEditorDocument;
  frameStep: number;
  gridVisible: boolean;
  inspectorAssistantActive: boolean;
  inspectorOpen: boolean;
  libraryOpen: boolean;
  presetsOpen: boolean;
  safeAreasVisible: boolean;
  saving: boolean;
  selectedClipIds: ReadonlySet<string>;
  snapEnabled: boolean;
}>;

export type CompositionCommandPaletteHandlers = Readonly<{
  align: (alignment: CompositionSelectionAlignment) => void;
  copy: () => void;
  delete: (ripple: boolean) => void;
  distribute: (axis: CompositionSelectionDistributionAxis) => void;
  duplicate: () => void;
  openAssistant: () => void;
  openLibrary: () => void;
  openPresets: () => void;
  paste: () => void;
  redo: () => void;
  roll: (edge: "LEFT" | "RIGHT", deltaFrames: number) => void;
  slide: (deltaFrames: number) => void;
  toggleDirectEditing: () => void;
  toggleGrid: () => void;
  toggleInspector: () => void;
  toggleSafeAreas: () => void;
  toggleSnap: () => void;
  undo: () => void;
}>;

export function buildCompositionCommandPaletteItems(
  context: CompositionCommandPaletteContext,
): CompositionCommandPaletteItem[] {
  const selectedClips = context.document.clips.filter((clip) => context.selectedClipIds.has(clip.id));
  const tracksById = new Map(context.document.tracks.map((track) => [track.id, track]));
  const hasSelection = selectedClips.length > 0;
  const hasLockedTrack = selectedClips.some((clip) => tracksById.get(clip.trackId)?.locked);
  const visualSelectionCount = selectedClips.filter(
    (clip) => tracksById.get(clip.trackId)?.kind !== "AUDIO",
  ).length;
  const selectionUnavailableReason = context.saving
    ? "Espera a que termine el guardado actual."
    : "Selecciona al menos un clip en el timeline o canvas.";
  const timelineEditUnavailableReason = context.saving
    ? "Espera a que termine el guardado actual."
    : hasLockedTrack
      ? "Desbloquea todas las pistas seleccionadas."
      : "Selecciona al menos un clip en el timeline.";
  const layoutUnavailableReason = context.saving
    ? "Espera a que termine el guardado actual."
    : hasLockedTrack
      ? "Desbloquea todas las pistas seleccionadas."
      : "Selecciona al menos un objeto visual.";
  const distributionUnavailableReason = context.saving
    ? "Espera a que termine el guardado actual."
    : hasLockedTrack
      ? "Desbloquea todas las pistas seleccionadas."
      : visualSelectionCount < 3
        ? "Selecciona al menos tres objetos visuales."
        : layoutUnavailableReason;
  const canEditSelection = !context.saving && hasSelection;
  const canEditTimeline = canEditSelection && !hasLockedTrack;
  const canAlign = !context.saving && !hasLockedTrack && visualSelectionCount >= 1;
  const canDistribute = !context.saving && !hasLockedTrack && visualSelectionCount >= 3;

  return [
    item("history.undo", !context.saving && context.canUndo, undefined, context.saving ? "Espera a que termine el guardado actual." : "No hay cambios para deshacer."),
    item("history.redo", !context.saving && context.canRedo, undefined, context.saving ? "Espera a que termine el guardado actual." : "No hay cambios para rehacer."),
    item("edit.copy", canEditSelection, undefined, selectionUnavailableReason),
    item("edit.paste", !context.saving && context.canPaste, undefined, context.saving ? "Espera a que termine el guardado actual." : "Copia una selección de esta composición antes de pegar."),
    item("edit.duplicate", canEditSelection, undefined, selectionUnavailableReason),
    item("edit.delete", canEditSelection, undefined, selectionUnavailableReason),
    item("edit.ripple-delete", canEditSelection, undefined, selectionUnavailableReason),
    item("layout.align-left", canAlign, undefined, layoutUnavailableReason),
    item("layout.align-horizontal-center", canAlign, undefined, layoutUnavailableReason),
    item("layout.align-right", canAlign, undefined, layoutUnavailableReason),
    item("layout.align-top", canAlign, undefined, layoutUnavailableReason),
    item("layout.align-vertical-center", canAlign, undefined, layoutUnavailableReason),
    item("layout.align-bottom", canAlign, undefined, layoutUnavailableReason),
    item("layout.distribute-horizontal", canDistribute, undefined, distributionUnavailableReason),
    item("layout.distribute-vertical", canDistribute, undefined, distributionUnavailableReason),
    item("timing.slide-backward", canEditTimeline, undefined, timelineEditUnavailableReason),
    item("timing.slide-forward", canEditTimeline, undefined, timelineEditUnavailableReason),
    item("timing.roll-left-backward", canEditTimeline, undefined, timelineEditUnavailableReason),
    item("timing.roll-left-forward", canEditTimeline, undefined, timelineEditUnavailableReason),
    item("timing.roll-right-backward", canEditTimeline, undefined, timelineEditUnavailableReason),
    item("timing.roll-right-forward", canEditTimeline, undefined, timelineEditUnavailableReason),
    item("view.direct-editing", true, context.directEditingEnabled),
    item("view.snap", true, context.snapEnabled),
    item("view.grid", true, context.gridVisible),
    item("view.safe-areas", true, context.safeAreasVisible),
    item("panel.library", true, context.libraryOpen),
    item("panel.inspector", true, context.inspectorOpen),
    item("panel.presets", !context.agentProposalActive, context.presetsOpen, "Finaliza o descarta la propuesta activa antes de abrir presets."),
    item("panel.assistant", true, context.inspectorAssistantActive),
  ];
}

export function executeCompositionEditorCommand(params: {
  frameStep: number;
  handlers: CompositionCommandPaletteHandlers;
  id: CompositionEditorCommandId;
}) {
  const { frameStep, handlers, id } = params;
  switch (id) {
    case "history.undo": return handlers.undo();
    case "history.redo": return handlers.redo();
    case "edit.copy": return handlers.copy();
    case "edit.paste": return handlers.paste();
    case "edit.duplicate": return handlers.duplicate();
    case "edit.delete": return handlers.delete(false);
    case "edit.ripple-delete": return handlers.delete(true);
    case "layout.align-left": return handlers.align("LEFT");
    case "layout.align-horizontal-center": return handlers.align("HORIZONTAL_CENTER");
    case "layout.align-right": return handlers.align("RIGHT");
    case "layout.align-top": return handlers.align("TOP");
    case "layout.align-vertical-center": return handlers.align("VERTICAL_CENTER");
    case "layout.align-bottom": return handlers.align("BOTTOM");
    case "layout.distribute-horizontal": return handlers.distribute("HORIZONTAL");
    case "layout.distribute-vertical": return handlers.distribute("VERTICAL");
    case "timing.slide-backward": return handlers.slide(-frameStep);
    case "timing.slide-forward": return handlers.slide(frameStep);
    case "timing.roll-left-backward": return handlers.roll("LEFT", -frameStep);
    case "timing.roll-left-forward": return handlers.roll("LEFT", frameStep);
    case "timing.roll-right-backward": return handlers.roll("RIGHT", -frameStep);
    case "timing.roll-right-forward": return handlers.roll("RIGHT", frameStep);
    case "view.direct-editing": return handlers.toggleDirectEditing();
    case "view.snap": return handlers.toggleSnap();
    case "view.grid": return handlers.toggleGrid();
    case "view.safe-areas": return handlers.toggleSafeAreas();
    case "panel.library": return handlers.openLibrary();
    case "panel.inspector": return handlers.toggleInspector();
    case "panel.presets": return handlers.openPresets();
    case "panel.assistant": return handlers.openAssistant();
  }
  const exhaustiveCommand: never = id;
  return exhaustiveCommand;
}

function item(
  id: CompositionEditorCommandId,
  enabled: boolean,
  active?: boolean,
  disabledReason?: string,
): CompositionCommandPaletteItem {
  return { id, enabled, ...(active !== undefined ? { active } : {}), ...(disabledReason ? { disabledReason } : {}) };
}
