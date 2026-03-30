import { createClient } from "@/utils/supabase/client";
import {
  applyMaterialsQaDecisionAction,
  forceResetMaterialsGenerationAction,
  getLessonComponentsSnapshotAction,
  getMaterialsSnapshotAction,
  markMaterialLessonForFixAction,
  runMaterialsFixIterationAction,
  startMaterialsGenerationAction,
  submitMaterialsToQaAction,
  validateMaterialLessonAction,
  validateMaterialsAction,
} from "../actions/materials.actions";
import type {
  MaterialComponent,
  MaterialsPayload,
  MaterialLesson,
} from "../types/materials.types";

export const materialsService = {
  async getMaterialsByArtifactId(
    artifactId: string,
  ): Promise<MaterialsPayload | null> {
    const result = await getMaterialsSnapshotAction(artifactId);
    if (!result.success) {
      console.error("Error fetching materials snapshot:", result.error);
      return null;
    }

    const data = result.materials;
    if (!data) return null;

    return {
      ...data,
      lessons: (result.lessons || []) as MaterialLesson[],
      global_blockers: data.global_blockers || [],
      dod: data.dod || { checklist: [], automatic_checks: [] },
      qa_decision: data.qa_decision,
      package: data.package,
    } as MaterialsPayload;
  },

  async getLessonComponents(lessonId: string): Promise<MaterialComponent[]> {
    const result = await getLessonComponentsSnapshotAction(lessonId);
    if (!result.success) {
      console.error("Error fetching lesson components snapshot:", result.error);
      return [];
    }

    const components = (result.components || []) as MaterialComponent[];
    const uniqueComponents = new Map<string, MaterialComponent>();

    for (const component of components) {
      if (!uniqueComponents.has(component.type)) {
        uniqueComponents.set(component.type, component);
      }
    }

    return Array.from(uniqueComponents.values()).sort((a, b) =>
      a.type.localeCompare(b.type),
    );
  },

  async startMaterialsGeneration(artifactId: string) {
    return startMaterialsGenerationAction(artifactId);
  },

  async runFixIteration(lessonId: string, fixInstructions: string, componentTypes?: string[]) {
    return runMaterialsFixIterationAction(lessonId, fixInstructions, componentTypes);
  },

  async validateMaterials(artifactId: string) {
    return validateMaterialsAction(artifactId);
  },

  async validateLesson(lessonId: string) {
    return validateMaterialLessonAction(lessonId);
  },

  async markLessonForFix(lessonId: string) {
    return markMaterialLessonForFixAction(lessonId);
  },

  async submitToQA(materialsId: string) {
    return submitMaterialsToQaAction(materialsId);
  },

  async applyQADecision(
    materialsId: string,
    decision: "APPROVED" | "REJECTED",
    notes?: string,
  ) {
    return applyMaterialsQaDecisionAction(materialsId, decision, notes);
  },

  async forceResetGeneration(artifactId: string) {
    return forceResetMaterialsGenerationAction(artifactId);
  },

  subscribeToMaterials(materialsId: string, callback: () => void) {
    const supabase = createClient();

    const materialsChannel = supabase
      .channel(`materials:${materialsId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "materials",
          filter: `id=eq.${materialsId}`,
        },
        () => callback(),
      )
      .subscribe();

    const lessonsChannel = supabase
      .channel(`material_lessons:${materialsId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "material_lessons",
          filter: `materials_id=eq.${materialsId}`,
        },
        () => callback(),
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(materialsChannel);
        supabase.removeChannel(lessonsChannel);
      },
    };
  },
};
