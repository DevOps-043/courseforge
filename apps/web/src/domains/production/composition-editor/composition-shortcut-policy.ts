import { COMPOSITION_SHORTCUTS, type CompositionShortcutAction, type CompositionShortcutScope, type CompositionShortcutDefinition } from "./composition-shortcuts";

export type ShortcutKeyEvent = Pick<KeyboardEvent, "key" | "code" | "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "repeat" | "isComposing" | "defaultPrevented">;

export function resolveCompositionShortcut(event: ShortcutKeyEvent, scope: CompositionShortcutScope) {
  return findCompositionShortcut(event, scope, COMPOSITION_SHORTCUTS);
}

/** Serialized into the iframe with the catalog; no module dependencies in this function. */
export function findCompositionShortcut(event: ShortcutKeyEvent, scope: CompositionShortcutScope, definitions: readonly CompositionShortcutDefinition[]) {
  if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return null;
  const key = event.code === "Space" ? " " : event.key.toLowerCase();
  if (event.shiftKey && key !== "?") return null;
  return definitions.find((entry) => entry.action && entry.key?.toLowerCase() === key && entry.scopes?.includes(scope)) ?? null;
}

/** This function is also serialized into the isolated preview; keep it self-contained. */
export function isCompositionShortcutControl(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return true;
  if (target instanceof HTMLElement && target.isContentEditable) return true;
  // The editor's time ruler explicitly owns Space/Home/End; other sliders remain native.
  if (target.closest("[data-composition-time-ruler]")) return false;
  return Boolean(target.closest("input, textarea, select, button, a[href], [contenteditable]:not([contenteditable='false']), [role='button'], [role='checkbox'], [role='combobox'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='radio'], [role='slider'], [role='spinbutton'], [role='switch'], [role='textbox'], [role='tab'], [role='separator'], audio[controls], video[controls]"));
}

export function compositionShortcutAvailable(action: CompositionShortcutAction, transportEnabled: boolean): boolean {
  return !["toggle-playback", "seek-start", "seek-end", "previous-scene", "next-scene"].includes(action) || transportEnabled;
}

export function compositionNavigationTime(action: CompositionShortcutAction, current: number, duration: number, sceneStarts: readonly number[]): number | null {
  if (action === "seek-start") return 0;
  if (action === "seek-end") return duration;
  const starts = [...new Set(sceneStarts)].filter((time) => Number.isFinite(time) && time >= 0 && time <= duration).sort((a, b) => a - b);
  if (action === "previous-scene") return starts.filter((time) => time < current).at(-1) ?? null;
  if (action === "next-scene") return starts.find((time) => time > current) ?? null;
  return null;
}
