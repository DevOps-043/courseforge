import type { MaterialsGenerationInput } from "../../../src/domains/materials/types/materials.types";
import { selectLatestComponentsByType } from "../../../src/domains/materials/lib/material-component-versions";
import { isVideoComponentType } from "../../../src/domains/video-duration/video-duration-policy";
import { runInlineValidation, type MaterialComponentRecord } from "./materials-lesson-validation";

/** Resume only missing/invalid components; successful work keeps its IDs and assets. */
export function selectMaterialRetryTypes(input: MaterialsGenerationInput, saved: MaterialComponentRecord[]): string[] {
  const components = selectLatestComponentsByType(saved);
  const validSourceIds = new Set(input.sources.map((source) => source.id));
  const retry = input.lesson.components.filter((planned) => {
    const component = components.find((candidate) => candidate.type === planned.type);
    if (!component) return true;
    const dod = runInlineValidation({
      id: input.lesson.lesson_id, materials_id: "", lesson_id: input.lesson.lesson_id, updated_at: "",
      expected_components: [planned.type], quiz_spec: input.lesson.quiz_spec,
    }, [{ ...component, assets: {
      ...component.assets,
      ...(planned.duration_contract ? { video_duration_contract: planned.duration_contract } : {}),
    } }], { requiresSources: false, requiredSourcesByLesson: new Map(), validSourceIdsByLesson: new Map() });
    return dod.errors.length > 0 || (!isVideoComponentType(component.type) && component.validation_status === "FAIL")
      || (input.requires_sources && (component.source_refs || []).some((id) => !validSourceIds.has(id)));
  }).map((component) => component.type);

  // An empty selection means revalidate saved content, never regenerate everything.
  return retry;
}
