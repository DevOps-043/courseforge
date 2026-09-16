import type { SupabaseClient } from "@supabase/supabase-js";
import { isGenerationStale } from "../../../lib/pipeline-generation-policy";

export interface RecoverableMaterialLesson {
  id: string;
  state: string;
  iteration_count: number;
  updated_at: string;
  dod?: Record<string, unknown> | null;
}

export const MATERIAL_LESSON_EXPIRED_MESSAGE =
  "La generación de esta lección excedió el tiempo permitido y se detuvo. Se conservaron los materiales guardados. Puedes reintentar la corrección.";

/** Individual retries can outlive a NEEDS_FIX parent; inspect the lesson lease itself. */
export async function recoverExpiredMaterialLessons<T extends RecoverableMaterialLesson>(
  database: SupabaseClient,
  materialsId: string,
  lessons: T[],
  now = Date.now(),
): Promise<T[]> {
  const recovered: T[] = [];
  for (const lesson of lessons) {
    if (lesson.state !== "GENERATING" || !isGenerationStale(lesson.updated_at, now)) {
      recovered.push(lesson);
      continue;
    }
    const previousErrors = Array.isArray(lesson.dod?.errors)
      ? lesson.dod.errors.filter((error): error is string => typeof error === "string") : [];
    const updates = {
      state: "NEEDS_FIX",
      updated_at: new Date(now).toISOString(),
      dod: {
        ...lesson.dod,
        control3_consistency: "FAIL",
        errors: [...new Set([...previousErrors, MATERIAL_LESSON_EXPIRED_MESSAGE])],
      },
    };
    // Compare the observed lease, including iteration, to avoid touching a newer retry.
    const { data, error } = await database.from("material_lessons").update(updates)
      .eq("materials_id", materialsId).eq("id", lesson.id).eq("state", "GENERATING")
      .eq("iteration_count", lesson.iteration_count).eq("updated_at", lesson.updated_at)
      .select("id").maybeSingle();
    if (error) throw error;
    recovered.push(data ? { ...lesson, ...updates } : lesson);
  }
  return recovered;
}
