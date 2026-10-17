import { z } from "zod";
import { COMPOSITION_ASSET_INSERTION_MODES } from "./composition-timeline-edit.service";

const COMPOSITION_EDITOR_PREFERENCES_KEY = "courseforge:composition-editor:preferences:v1";
const MAX_PREFERENCES_BYTES = 2_048;

const compositionEditorPreferencesSchema = z.object({
  assetInsertionMode: z.enum(COMPOSITION_ASSET_INSERTION_MODES),
  schemaVersion: z.literal(1),
  timelineFrameStep: z.number().int().min(1).max(300),
  timelineKeyboardEditMode: z.enum(["ROLL_LEFT", "ROLL_RIGHT", "SLIDE"]),
}).strict();

export type CompositionEditorPreferences = z.infer<typeof compositionEditorPreferencesSchema>;

export const DEFAULT_COMPOSITION_EDITOR_PREFERENCES: CompositionEditorPreferences = Object.freeze({
  assetInsertionMode: "APPEND",
  schemaVersion: 1,
  timelineFrameStep: 1,
  timelineKeyboardEditMode: "SLIDE",
});

type PreferenceStorage = Pick<Storage, "getItem" | "setItem">;

export function resolveBrowserCompositionEditorPreferenceStorage(): PreferenceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCompositionEditorPreferences(
  storage: PreferenceStorage | null | undefined,
): CompositionEditorPreferences {
  if (!storage) return { ...DEFAULT_COMPOSITION_EDITOR_PREFERENCES };
  try {
    const serialized = storage.getItem(COMPOSITION_EDITOR_PREFERENCES_KEY);
    if (!serialized || serialized.length > MAX_PREFERENCES_BYTES) {
      return { ...DEFAULT_COMPOSITION_EDITOR_PREFERENCES };
    }
    const parsed = compositionEditorPreferencesSchema.safeParse(JSON.parse(serialized) as unknown);
    return parsed.success ? parsed.data : { ...DEFAULT_COMPOSITION_EDITOR_PREFERENCES };
  } catch {
    return { ...DEFAULT_COMPOSITION_EDITOR_PREFERENCES };
  }
}

export function writeCompositionEditorPreferences(
  storage: PreferenceStorage | null | undefined,
  preferences: CompositionEditorPreferences,
) {
  if (!storage) return false;
  const parsed = compositionEditorPreferencesSchema.safeParse(preferences);
  if (!parsed.success) return false;
  try {
    const serialized = JSON.stringify(parsed.data);
    if (serialized.length > MAX_PREFERENCES_BYTES) return false;
    storage.setItem(COMPOSITION_EDITOR_PREFERENCES_KEY, serialized);
    return true;
  } catch {
    return false;
  }
}
