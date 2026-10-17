export type CompositionEditorCommandId =
  | "edit.copy"
  | "edit.delete"
  | "edit.duplicate"
  | "edit.paste"
  | "edit.ripple-delete"
  | "history.redo"
  | "history.undo"
  | "layout.align-bottom"
  | "layout.align-horizontal-center"
  | "layout.align-left"
  | "layout.align-right"
  | "layout.align-top"
  | "layout.align-vertical-center"
  | "layout.distribute-horizontal"
  | "layout.distribute-vertical"
  | "panel.assistant"
  | "panel.inspector"
  | "panel.library"
  | "panel.presets"
  | "view.direct-editing"
  | "view.grid"
  | "view.safe-areas"
  | "view.snap"
  | "timing.roll-left-backward"
  | "timing.roll-left-forward"
  | "timing.roll-right-backward"
  | "timing.roll-right-forward"
  | "timing.slide-backward"
  | "timing.slide-forward";

export type CompositionEditorCommandDefinition = Readonly<{
  category: "Edición" | "Historial" | "Layout" | "Paneles" | "Tiempo" | "Vista";
  description: string;
  id: CompositionEditorCommandId;
  keywords: readonly string[];
  label: string;
  shortcut?: string;
}>;

export const COMPOSITION_EDITOR_COMMANDS: readonly CompositionEditorCommandDefinition[] = Object.freeze([
  command("history.undo", "Historial", "Deshacer último cambio", "Restaura el checkpoint anterior confirmado.", ["undo", "revertir"], "Ctrl/Cmd+Z"),
  command("history.redo", "Historial", "Rehacer último cambio", "Reaplica el último cambio deshecho.", ["redo", "reaplicar"], "Ctrl/Cmd+Shift+Z"),
  command("edit.copy", "Edición", "Copiar selección", "Guarda los IDs seleccionados en el portapapeles interno.", ["clipboard", "portapapeles"], "Ctrl/Cmd+C"),
  command("edit.paste", "Edición", "Pegar en el playhead", "Inserta una copia segura en la posición actual.", ["clipboard", "insertar", "cursor"], "Ctrl/Cmd+V"),
  command("edit.duplicate", "Edición", "Duplicar selección", "Duplica el bloque después de su posición actual.", ["clonar", "copia"], "Ctrl/Cmd+D"),
  command("edit.delete", "Edición", "Eliminar selección", "Retira los clips seleccionados sin cerrar huecos.", ["borrar", "quitar"], "Delete"),
  command("edit.ripple-delete", "Edición", "Eliminar y cerrar hueco", "Retira la selección y desplaza contenido posterior compatible.", ["ripple", "borrar", "compactar"], "Shift+Delete"),
  command("layout.align-left", "Layout", "Alinear a la izquierda del canvas", "Alinea el borde izquierdo de la selección visual.", ["posición", "posicion", "borde"]),
  command("layout.align-horizontal-center", "Layout", "Centrar horizontalmente en el canvas", "Centra la selección visual sobre el eje horizontal.", ["alinear", "medio", "canvas"]),
  command("layout.align-right", "Layout", "Alinear a la derecha del canvas", "Alinea el borde derecho de la selección visual.", ["posición", "posicion", "borde"]),
  command("layout.align-top", "Layout", "Alinear arriba del canvas", "Alinea el borde superior de la selección visual.", ["posición", "posicion", "borde"]),
  command("layout.align-vertical-center", "Layout", "Centrar verticalmente en el canvas", "Centra la selección visual sobre el eje vertical.", ["alinear", "medio", "canvas"]),
  command("layout.align-bottom", "Layout", "Alinear abajo del canvas", "Alinea el borde inferior de la selección visual.", ["posición", "posicion", "borde"]),
  command("layout.distribute-horizontal", "Layout", "Distribuir horizontalmente", "Iguala el espacio horizontal entre tres o más objetos visuales.", ["espaciado", "separar", "layout"]),
  command("layout.distribute-vertical", "Layout", "Distribuir verticalmente", "Iguala el espacio vertical entre tres o más objetos visuales.", ["espaciado", "separar", "layout"]),
  command("timing.slide-backward", "Tiempo", "Slide hacia atrás", "Desplaza el bloque hacia atrás usando el paso de frames configurado.", ["frame", "tiempo", "izquierda"]),
  command("timing.slide-forward", "Tiempo", "Slide hacia adelante", "Desplaza el bloque hacia adelante usando el paso de frames configurado.", ["frame", "tiempo", "derecha"]),
  command("timing.roll-left-backward", "Tiempo", "Roll de entrada hacia atrás", "Mueve el corte de entrada hacia atrás por frames.", ["trim", "corte", "izquierda"]),
  command("timing.roll-left-forward", "Tiempo", "Roll de entrada hacia adelante", "Mueve el corte de entrada hacia adelante por frames.", ["trim", "corte", "derecha"]),
  command("timing.roll-right-backward", "Tiempo", "Roll de salida hacia atrás", "Mueve el corte de salida hacia atrás por frames.", ["trim", "corte", "izquierda"]),
  command("timing.roll-right-forward", "Tiempo", "Roll de salida hacia adelante", "Mueve el corte de salida hacia adelante por frames.", ["trim", "corte", "derecha"]),
  command("view.direct-editing", "Vista", "Alternar edición directa", "Activa selección, arrastre y tiradores sobre el canvas.", ["canvas", "seleccionar", "mover"]),
  command("view.snap", "Vista", "Alternar snap magnético", "Alinea bordes y centros durante movimientos y resize.", ["guías", "guias", "magnet", "alinear"]),
  command("view.grid", "Vista", "Alternar rejilla", "Muestra u oculta la rejilla visual del canvas.", ["grid", "cuadrícula", "cuadricula"]),
  command("view.safe-areas", "Vista", "Alternar áreas seguras", "Muestra guías de título, acción y centro.", ["guias", "título", "titulo", "acción", "accion"]),
  command("panel.library", "Paneles", "Abrir biblioteca", "Abre los assets disponibles para insertar.", ["media", "assets", "archivos"]),
  command("panel.inspector", "Paneles", "Alternar inspector", "Abre o cierra el inspector contextual.", ["propiedades", "selección", "seleccion"]),
  command("panel.presets", "Paneles", "Abrir presets", "Abre el catálogo de estilos versionados.", ["plantillas", "estilos"]),
  command("panel.assistant", "Paneles", "Abrir SofLIA", "Abre el asistente de composición.", ["ia", "asistente", "agente"]),
]);

export function filterCompositionEditorCommands(
  commands: readonly CompositionEditorCommandDefinition[],
  query: string,
): CompositionEditorCommandDefinition[] {
  const terms = normalizeSearchValue(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [...commands];
  return commands
    .map((item, sourceIndex) => ({ item, score: scoreCommand(item, terms), sourceIndex }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.sourceIndex - right.sourceIndex)
    .map((candidate) => candidate.item);
}

function command(
  id: CompositionEditorCommandId,
  category: CompositionEditorCommandDefinition["category"],
  label: string,
  description: string,
  keywords: readonly string[],
  shortcut?: string,
): CompositionEditorCommandDefinition {
  return Object.freeze({ category, description, id, keywords: Object.freeze([...keywords]), label, ...(shortcut ? { shortcut } : {}) });
}

function scoreCommand(commandDefinition: CompositionEditorCommandDefinition, terms: readonly string[]) {
  const label = normalizeSearchValue(commandDefinition.label);
  const searchable = normalizeSearchValue([
    commandDefinition.label,
    commandDefinition.description,
    commandDefinition.category,
    commandDefinition.shortcut || "",
    ...commandDefinition.keywords,
  ].join(" "));
  const searchableTokens = searchable.split(/\s+/);
  let score = 0;
  for (const term of terms) {
    const matches = term.length === 1 ? searchableTokens.includes(term) : searchable.includes(term);
    if (!matches) return 0;
    score += label.startsWith(term) ? 4 : label.includes(term) ? 2 : 1;
  }
  return score;
}

function normalizeSearchValue(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
