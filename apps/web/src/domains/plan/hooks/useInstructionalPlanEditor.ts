"use client";

import { Dispatch, SetStateAction, useCallback, useState } from "react";
import { toast } from "sonner";
import { markDownstreamDirtyAction } from "@/lib/server/pipeline-dirty-actions";
import { updateInstructionalPlanContentAction } from "../actions/plan.actions";
import type {
  InstructionalPlanRecord,
  PlanLessonItem,
} from "../components/plan-view.types";

function cloneLesson(lesson: PlanLessonItem): PlanLessonItem {
  return typeof structuredClone === "function"
    ? structuredClone(lesson)
    : (JSON.parse(JSON.stringify(lesson)) as PlanLessonItem);
}

interface UseInstructionalPlanEditorParams {
  artifactId: string;
  existingPlan: InstructionalPlanRecord | null;
  setExistingPlan: Dispatch<SetStateAction<InstructionalPlanRecord | null>>;
}

export function useInstructionalPlanEditor({
  artifactId,
  existingPlan,
  setExistingPlan,
}: UseInstructionalPlanEditorParams) {
  const [editedLesson, setEditedLesson] = useState<PlanLessonItem | null>(null);
  const [editingLessonId, setEditingLessonId] = useState<string | null>(null);
  const [expandedLessonId, setExpandedLessonId] = useState<string | null>(null);

  const handleStartEdit = useCallback((lesson: PlanLessonItem) => {
    setEditingLessonId(lesson.lesson_id);
    setEditedLesson(cloneLesson(lesson));
    setExpandedLessonId(lesson.lesson_id);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingLessonId(null);
    setEditedLesson(null);
  }, []);

  const updateEditedLesson = useCallback(
    (updater: (lesson: PlanLessonItem) => PlanLessonItem) => {
      setEditedLesson((currentLesson) =>
        currentLesson ? updater(currentLesson) : currentLesson,
      );
    },
    [],
  );

  const handleLessonFieldChange = useCallback(
    (field: "learning_objective" | "measurable_criteria", value: string) => {
      updateEditedLesson((currentLesson) => ({
        ...currentLesson,
        [field]: value,
      }));
    },
    [updateEditedLesson],
  );

  const handleComponentFieldChange = useCallback(
    (
      componentIndex: number,
      field: "description" | "duration",
      value: string,
    ) => {
      updateEditedLesson((currentLesson) => {
        const components = [...currentLesson.components];
        const component = components[componentIndex];

        if (!component) {
          return currentLesson;
        }

        components[componentIndex] = {
          ...component,
          [field]: value,
        };

        return {
          ...currentLesson,
          components,
        };
      });
    },
    [updateEditedLesson],
  );

  const handleComponentTypeChange = useCallback(
    (componentIndex: number, newType: string) => {
      updateEditedLesson((currentLesson) => {
        const components = [...currentLesson.components];
        const component = components[componentIndex];

        if (!component) {
          return currentLesson;
        }

        components[componentIndex] = {
          ...component,
          type: newType,
        };

        return {
          ...currentLesson,
          components,
        };
      });
    },
    [updateEditedLesson],
  );

  const handleSaveLesson = useCallback(async () => {
    if (!editedLesson || !editingLessonId || !existingPlan) {
      return;
    }

    const previousPlan = existingPlan;
    const updatedLessonPlans = existingPlan.lesson_plans.map((lesson) =>
      lesson.lesson_id === editingLessonId ? editedLesson : lesson,
    );

    try {
      setExistingPlan({
        ...existingPlan,
        lesson_plans: updatedLessonPlans,
      });
      setEditingLessonId(null);
      setEditedLesson(null);

      const result = await updateInstructionalPlanContentAction(
        artifactId,
        updatedLessonPlans,
      );

      if (!result.success) {
        toast.error("Error al guardar cambios");
        setExistingPlan(previousPlan);
        return;
      }

      toast.success("Leccion actualizada correctamente");
      await markDownstreamDirtyAction(artifactId, 3, "Plan Instruccional");
    } catch (error) {
      console.error(error);
      toast.error("Error de conexion");
      setExistingPlan(previousPlan);
    }
  }, [
    artifactId,
    editedLesson,
    editingLessonId,
    existingPlan,
    setExistingPlan,
  ]);

  const handleToggleExpandedLesson = useCallback((lessonId: string) => {
    setExpandedLessonId((currentLessonId) =>
      currentLessonId === lessonId ? null : lessonId,
    );
  }, []);

  return {
    editedLesson,
    editingLessonId,
    expandedLessonId,
    handleCancelEdit,
    handleComponentFieldChange,
    handleComponentTypeChange,
    handleLessonFieldChange,
    handleSaveLesson,
    handleStartEdit,
    handleToggleExpandedLesson,
  };
}
