export const COMPOSITION_SHORTCUT_ACTIONS = [
  "toggle-playback", "open-shortcuts", "seek-start", "seek-end",
  "previous-scene", "next-scene", "toggle-fullscreen", "toggle-grid", "toggle-snap",
] as const;
export type CompositionShortcutAction = typeof COMPOSITION_SHORTCUT_ACTIONS[number];
export type CompositionShortcutScope = "preview" | "timeline";

export interface CompositionShortcutDefinition {
  id: string;
  action?: CompositionShortcutAction;
  keys: string;
  label: string;
  group: string;
  context: string;
  key?: string;
  scopes?: readonly CompositionShortcutScope[];
  repeat?: boolean;
}

/** Local/native bindings are documented here but are never registered a second time. */
export const COMPOSITION_SHORTCUTS: readonly CompositionShortcutDefinition[] = [
  { id: "playback", action: "toggle-playback", keys: "Espacio", key: " ", label: "Reproducir / pausar", group: "Reproducción", context: "Preview o timeline listos; no durante guardado.", scopes: ["preview", "timeline"] },
  { id: "frame", keys: "← / →", label: "Fotograma anterior / siguiente", group: "Navegación temporal", context: "Regla temporal enfocada." },
  { id: "second", keys: "Shift + ← / →", label: "Retroceder / avanzar un segundo", group: "Navegación temporal", context: "Regla temporal enfocada; alineado a fotogramas." },
  { id: "start", action: "seek-start", keys: "Home", key: "Home", label: "Ir al inicio y pausar", group: "Navegación temporal", context: "Timeline enfocado y preview listo.", scopes: ["timeline"], repeat: true },
  { id: "end", action: "seek-end", keys: "End", key: "End", label: "Ir al final y pausar", group: "Navegación temporal", context: "Timeline enfocado y preview listo.", scopes: ["timeline"], repeat: true },
  { id: "previous", action: "previous-scene", keys: "PageUp", key: "PageUp", label: "Ir a la escena anterior y pausar", group: "Navegación temporal", context: "Timeline enfocado; no vuelve al final desde el inicio.", scopes: ["timeline"], repeat: true },
  { id: "next", action: "next-scene", keys: "PageDown", key: "PageDown", label: "Ir a la escena siguiente y pausar", group: "Navegación temporal", context: "Timeline enfocado; no vuelve al inicio desde el final.", scopes: ["timeline"], repeat: true },
  { id: "fullscreen", action: "toggle-fullscreen", keys: "F", key: "f", label: "Entrar / salir de pantalla completa", group: "Vista y herramientas", context: "Marco del preview enfocado (fuera del lienzo embebido). También disponible en la barra.", scopes: ["preview"] },
  { id: "grid", action: "toggle-grid", keys: "G", key: "g", label: "Mostrar / ocultar rejilla", group: "Vista y herramientas", context: "Preview enfocado.", scopes: ["preview"] },
  { id: "snap", action: "toggle-snap", keys: "S", key: "s", label: "Activar / desactivar snap", group: "Vista y herramientas", context: "Preview o timeline enfocado.", scopes: ["preview", "timeline"] },
  { id: "help", action: "open-shortcuts", keys: "?", key: "?", label: "Abrir atajos de teclado", group: "Ayuda e interfaz", context: "Preview o timeline enfocado. Usa el carácter ? de tu teclado.", scopes: ["preview", "timeline"] },
  { id: "escape", keys: "Escape", label: "Cerrar ayuda o menú / salir de pantalla completa", group: "Ayuda e interfaz", context: "Actúa sobre el contexto abierto; no quita el clip." },
  { id: "tab", keys: "Tab / Shift + Tab", label: "Control siguiente / anterior", group: "Ayuda e interfaz", context: "Navegación nativa de la interfaz." },
  { id: "button", keys: "Enter / Espacio", label: "Activar botón", group: "Ayuda e interfaz", context: "Botón enfocado; una única activación nativa." },
  { id: "tabs", keys: "← / → / Home / End", label: "Cambiar pestaña del inspector", group: "Ayuda e interfaz", context: "Pestaña enfocada." },
  { id: "resize", keys: "↑ / ↓", label: "Redimensionar preview y timeline", group: "Ayuda e interfaz", context: "Separador de paneles enfocado." },
];

export const COMPOSITION_IFRAME_SHORTCUT_ACTIONS = COMPOSITION_SHORTCUTS
  .filter((entry) => entry.action && entry.scopes?.includes("preview") && entry.action !== "toggle-fullscreen")
  .map((entry) => entry.action!);

export function compositionShortcutKeys(action: CompositionShortcutAction): string {
  return COMPOSITION_SHORTCUTS.find((entry) => entry.action === action)!.keys;
}
