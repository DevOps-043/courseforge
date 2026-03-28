"use client";

import { CheckCircle2, RefreshCw } from "lucide-react";
import { UpstreamChangeAlert } from "@/shared/components/UpstreamChangeAlert";
import { InstructionalPlanValidationResult } from "./InstructionalPlanValidationResult";
import { InstructionalPlanLessonCard } from "./InstructionalPlanLessonCard";
import { InstructionalPlanReviewPanel } from "./InstructionalPlanReviewPanel";
import {
  groupPlanModules,
  InstructionalPlanRecord,
  PlanLessonItem,
} from "./plan-view.types";

interface InstructionalPlanResultsViewProps {
  canReview: boolean;
  editedLesson: PlanLessonItem | null;
  editingLessonId: string | null;
  expandedLessonId: string | null;
  isGenerating: boolean;
  isValidating: boolean;
  onApprove: () => Promise<void> | void;
  onCancelEdit: () => void;
  onComponentFieldChange: (
    componentIndex: number,
    field: "description" | "duration",
    value: string,
  ) => void;
  onComponentTypeChange: (componentIndex: number, newType: string) => void;
  onDismissUpstreamDirty: () => Promise<void> | void;
  onIterateUpstreamDirty: () => Promise<void> | void;
  onLessonFieldChange: (
    field: "learning_objective" | "measurable_criteria",
    value: string,
  ) => void;
  onNext?: () => void;
  onRegenerate: () => Promise<void> | void;
  onRegenerateRejected: () => Promise<void> | void;
  onReject: () => Promise<void> | void;
  onReviewNotesChange: (value: string) => void;
  onSaveLesson: () => Promise<void> | void;
  onStartEdit: (lesson: PlanLessonItem) => void;
  onToggleExpandedLesson: (lessonId: string) => void;
  onValidate: () => Promise<void> | void;
  plan: InstructionalPlanRecord;
  reviewNotes: string;
}

export function InstructionalPlanResultsView({
  canReview,
  editedLesson,
  editingLessonId,
  expandedLessonId,
  isGenerating,
  isValidating,
  onApprove,
  onCancelEdit,
  onComponentFieldChange,
  onComponentTypeChange,
  onDismissUpstreamDirty,
  onIterateUpstreamDirty,
  onLessonFieldChange,
  onNext,
  onRegenerate,
  onRegenerateRejected,
  onReject,
  onReviewNotesChange,
  onSaveLesson,
  onStartEdit,
  onToggleExpandedLesson,
  onValidate,
  plan,
  reviewNotes,
}: InstructionalPlanResultsViewProps) {
  const modules = groupPlanModules(plan.lesson_plans);

  return (
    <div className="mx-auto max-w-5xl animate-in space-y-8 fade-in pb-20 duration-500">
      <div className="flex items-center justify-between border-b border-gray-200 pb-6 dark:border-gray-800">
        <div>
          <h2 className="flex items-center gap-3 text-2xl font-bold text-gray-900 dark:text-white">
            <div className="rounded-lg bg-green-500/10 p-2 text-green-500">
              <CheckCircle2 size={24} />
            </div>
            Plan Instruccional Generado
          </h2>
          <p className="ml-12 mt-1 text-sm text-gray-500 dark:text-gray-400">
            {plan.lesson_plans.length} lecciones planificadas • Iteracion{" "}
            {plan.iteration_count || 1}/5
          </p>
        </div>

        <button
          type="button"
          onClick={onRegenerate}
          disabled={isGenerating}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm text-gray-700 transition-colors hover:border-[#00D4B3] hover:text-[#00D4B3] dark:border-gray-700 dark:bg-[#0F1419] dark:text-gray-300 dark:hover:text-[#00D4B3]"
        >
          <RefreshCw size={14} className={isGenerating ? "animate-spin" : ""} />
          {isGenerating ? "Regenerando..." : "Regenerar"}
        </button>
      </div>

      {plan.upstream_dirty && (
        <UpstreamChangeAlert
          source={plan.upstream_dirty_source || "un paso anterior"}
          onIterate={onIterateUpstreamDirty}
          onDismiss={onDismissUpstreamDirty}
          isIterating={isGenerating}
        />
      )}

      <div className="space-y-8">
        {modules.map((module) => (
          <div key={module.index} className="space-y-4">
            <div className="flex items-center gap-3 border-b border-gray-200 py-4 dark:border-gray-800/50">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/10 text-sm font-bold text-blue-500 dark:text-blue-400">
                {module.index}
              </div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-200">
                {module.title}
              </h3>
              <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium uppercase tracking-wider text-gray-500 dark:bg-gray-800/50">
                {module.lessons.length} Lecciones
              </span>
            </div>

            <div className="grid gap-4">
              {module.lessons.map((lesson) => {
                const isEditing = editingLessonId === lesson.lesson_id;
                const displayLesson = isEditing && editedLesson ? editedLesson : lesson;

                return (
                  <InstructionalPlanLessonCard
                    key={lesson.lesson_id || `lesson-${module.index}-${module.lessons.indexOf(lesson)}`}
                    lesson={lesson}
                    displayLesson={displayLesson}
                    expanded={expandedLessonId === lesson.lesson_id}
                    isEditing={isEditing}
                    onToggle={() => onToggleExpandedLesson(lesson.lesson_id)}
                    onStartEdit={() => onStartEdit(lesson)}
                    onCancelEdit={onCancelEdit}
                    onSaveEdit={onSaveLesson}
                    onLessonFieldChange={onLessonFieldChange}
                    onComponentFieldChange={onComponentFieldChange}
                    onComponentTypeChange={onComponentTypeChange}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {plan.validation && (
        <div className="border-t border-gray-200 pt-8 dark:border-gray-800">
          <InstructionalPlanValidationResult validation={plan.validation} />
        </div>
      )}

      <InstructionalPlanReviewPanel
        canReview={canReview}
        isGenerating={isGenerating}
        isValidating={isValidating}
        onApprove={onApprove}
        onNext={onNext}
        onReject={onReject}
        onRegenerateRejected={onRegenerateRejected}
        onValidate={onValidate}
        plan={plan}
        reviewNotes={reviewNotes}
        setReviewNotes={onReviewNotesChange}
      />
    </div>
  );
}
