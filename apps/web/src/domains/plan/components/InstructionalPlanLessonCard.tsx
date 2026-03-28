"use client";

import type { ChangeEvent } from "react";
import {
  Check,
  CheckSquare,
  ChevronDown,
  Clock,
  Edit3,
  Info,
  Layers,
  Target,
  X,
} from "lucide-react";
import {
  PremiumInput,
  PremiumSelect,
  PremiumTextarea,
} from "./PlanFieldControls";
import { COMPONENT_TYPES, getComponentBadge } from "./plan-component-config";
import type { PlanLessonItem } from "./plan-view.types";

interface InstructionalPlanLessonCardProps {
  displayLesson: PlanLessonItem;
  expanded: boolean;
  isEditing: boolean;
  lesson: PlanLessonItem;
  onCancelEdit: () => void;
  onComponentFieldChange: (
    componentIndex: number,
    field: "description" | "duration",
    value: string,
  ) => void;
  onComponentTypeChange: (componentIndex: number, newType: string) => void;
  onLessonFieldChange: (
    field: "learning_objective" | "measurable_criteria",
    value: string,
  ) => void;
  onSaveEdit: () => Promise<void> | void;
  onStartEdit: () => void;
  onToggle: () => void;
}

export function InstructionalPlanLessonCard({
  displayLesson,
  expanded,
  isEditing,
  lesson,
  onCancelEdit,
  onComponentFieldChange,
  onComponentTypeChange,
  onLessonFieldChange,
  onSaveEdit,
  onStartEdit,
  onToggle,
}: InstructionalPlanLessonCardProps) {
  const handleLessonTextChange =
    (field: "learning_objective" | "measurable_criteria") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onLessonFieldChange(field, event.target.value);
    };

  const handleComponentTextChange =
    (componentIndex: number, field: "description" | "duration") =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      onComponentFieldChange(componentIndex, field, event.target.value);
    };

  return (
    <div
      className={`group overflow-hidden rounded-xl border transition-all duration-300 ${
        expanded
          ? "border-[#00D4B3]/30 bg-white shadow-lg shadow-black/5 dark:bg-[#0f1418] dark:shadow-black/40"
          : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50 dark:border-gray-800 dark:bg-[#0A0E12] dark:hover:border-gray-700 dark:hover:bg-[#0f1418]"
      }`}
    >
      <div
        onClick={() => {
          if (!isEditing) {
            onToggle();
          }
        }}
        className={`flex items-start justify-between p-5 ${
          isEditing ? "cursor-default" : "cursor-pointer"
        }`}
      >
        <div className="flex flex-1 gap-4">
          <div className="mt-1 flex flex-col items-center gap-2">
            <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-100 font-mono text-xs font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-400">
              {lesson.lesson_order}
            </div>
            <div
              className={`w-0.5 flex-1 rounded-full ${
                expanded ? "bg-[#00D4B3]/20" : "bg-transparent"
              }`}
            />
          </div>

          <div className="flex-1 space-y-1">
            <h4
              className={`text-base font-semibold transition-colors ${
                expanded
                  ? "text-[#00D4B3]"
                  : "text-gray-900 group-hover:text-[#00D4B3] dark:text-gray-200 dark:group-hover:text-white"
              }`}
            >
              {lesson.lesson_title}
            </h4>

            {!isEditing && (
              <div className="flex flex-wrap gap-2 pt-1">
                <span className="inline-flex items-center gap-1.5 rounded border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-blue-600 dark:text-blue-400">
                  <Clock size={10} />
                  {lesson.duration}
                </span>

                {lesson.components.map((component, componentIndex) => {
                  const badge = getComponentBadge(component.type);

                  return (
                    <span
                      key={`badge-${componentIndex}`}
                      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${badge.color}`}
                    >
                      {badge.icon}
                      {badge.label}
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {!isEditing && expanded && (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onStartEdit();
              }}
              className="rounded-lg bg-gray-100 p-2 text-gray-500 transition-colors hover:bg-gray-200 hover:text-gray-900 dark:bg-gray-800/50 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-white"
            >
              <Edit3 size={16} />
            </button>
          )}

          <div
            className={`rounded-lg p-2 transition-all duration-300 ${
              expanded
                ? "rotate-180 bg-[#00D4B3] text-white dark:text-[#0A2540]"
                : "bg-gray-100 text-gray-400 group-hover:bg-white group-hover:text-gray-600 dark:bg-gray-800/50 dark:text-gray-500 dark:group-hover:bg-gray-800 dark:group-hover:text-gray-300"
            }`}
          >
            <ChevronDown size={16} />
          </div>
        </div>
      </div>

      {expanded && (
        <div className="animate-in slide-in-from-top-2 space-y-6 px-5 pb-5 pl-[3.25rem] duration-300">
          {isEditing ? (
            <div className="space-y-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-inner dark:border-gray-800/60 dark:bg-[#0A0E12]">
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#00D4B3]">
                  <Target size={14} /> Objetivo de Aprendizaje
                </label>
                <PremiumTextarea
                  value={
                    displayLesson.learning_objective || displayLesson.oa_text || ""
                  }
                  onChange={handleLessonTextChange("learning_objective")}
                  placeholder="Describe que aprendera el estudiante..."
                  className="min-h-[100px] border-gray-200 bg-gray-50 text-sm text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </div>

              <div className="space-y-2">
                <label className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                  <CheckSquare size={14} /> Criterio de Exito
                </label>
                <PremiumInput
                  value={displayLesson.measurable_criteria || ""}
                  onChange={handleLessonTextChange("measurable_criteria")}
                  placeholder="Ej: Identificar 3 de 5 elementos..."
                  className="border-gray-200 bg-gray-50 text-sm text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                />
              </div>

              <div className="space-y-4">
                <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-gray-500">
                  <span className="flex items-center gap-2">
                    <Layers size={14} /> Componentes
                  </span>
                </div>

                {displayLesson.components.map((component, componentIndex) => (
                  <div
                    key={`component-${componentIndex}`}
                    className="group/edit-card relative space-y-3 rounded-xl border border-gray-200 bg-gray-50 p-4 transition-colors hover:border-gray-300 dark:border-gray-700/50 dark:bg-[#151A21]/50 dark:hover:border-gray-600"
                  >
                    <div className="flex gap-4">
                      <div className="w-48 flex-shrink-0 space-y-3">
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">
                            Tipo
                          </label>
                          <PremiumSelect
                            options={COMPONENT_TYPES}
                            value={component.type}
                            onChange={(value: string) =>
                              onComponentTypeChange(componentIndex, value)
                            }
                            className="border-gray-200 bg-white text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                          />
                        </div>
                        <div>
                          <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">
                            Duracion
                          </label>
                          <PremiumInput
                            value={component.duration || ""}
                            placeholder="Ej: 5 min"
                            onChange={handleComponentTextChange(
                              componentIndex,
                              "duration",
                            )}
                            className="border-gray-200 bg-white px-3 py-2 text-xs text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                          />
                        </div>
                      </div>

                      <div className="flex-1">
                        <label className="mb-1 block text-[10px] font-bold uppercase text-gray-500">
                          Descripcion / Guion
                        </label>
                        <PremiumTextarea
                          value={component.description || component.summary || ""}
                          onChange={handleComponentTextChange(
                            componentIndex,
                            "description",
                          )}
                          placeholder="Detalles sobre este componente..."
                          className="min-h-[105px] border-gray-200 bg-white text-xs leading-relaxed text-gray-900 dark:border-white/10 dark:bg-white/5 dark:text-white"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={onSaveEdit}
                  className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-[#00D4B3] to-[#00A38D] px-5 py-2.5 text-sm font-bold text-white transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-[#00D4B3]/20 dark:text-[#0A2540]"
                >
                  <Check size={16} /> Guardar Cambios
                </button>
                <button
                  type="button"
                  onClick={onCancelEdit}
                  className="flex items-center gap-2 rounded-xl border border-gray-200 bg-gray-100 px-5 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-200 dark:border-white/10 dark:bg-white/5 dark:text-gray-300 dark:hover:bg-white/10"
                >
                  <X size={16} /> Cancelar
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="relative space-y-3">
                <div className="absolute left-[-1.5rem] top-2 h-full w-0.5 bg-[#00D4B3]/20" />

                <div className="rounded-lg border border-[#00D4B3]/10 bg-[#00D4B3]/5 p-4">
                  <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[#00D4B3]">
                    <Target size={14} />
                    Objetivo de Aprendizaje
                  </div>
                  <p className="text-sm leading-relaxed text-gray-700 dark:text-gray-300">
                    {lesson.learning_objective || lesson.oa_text}
                  </p>
                  <div className="mt-3 flex gap-2">
                    {(lesson.bloom_taxonomy_level || lesson.oa_bloom_verb) && (
                      <span className="inline-flex items-center rounded border border-purple-500/20 bg-purple-500/10 px-2 py-1 text-[10px] font-bold uppercase text-purple-600 dark:text-purple-400">
                        Bloom:{" "}
                        {lesson.bloom_taxonomy_level || lesson.oa_bloom_verb}
                      </span>
                    )}
                  </div>
                </div>

                {lesson.measurable_criteria && (
                  <div className="flex items-start gap-3 pl-2">
                    <div className="mt-1 rounded bg-green-500/10 p-1 text-green-600 dark:text-green-500">
                      <CheckSquare size={12} />
                    </div>
                    <div>
                      <span className="text-xs font-bold uppercase text-gray-500">
                        Criterio de Exito
                      </span>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {lesson.measurable_criteria}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500">
                  <Layers size={14} />
                  Componentes Detallados
                </div>

                <div className="grid gap-3">
                  {lesson.components.map((component, componentIndex) => {
                    const badge = getComponentBadge(component.type);

                    return (
                      <div
                        key={`detail-${componentIndex}`}
                        className="flex gap-3 rounded-lg border border-gray-200 bg-white p-3 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-[#161b22] dark:hover:border-gray-700"
                      >
                        <div
                          className={`mt-0.5 h-fit rounded p-1.5 ${badge.color.split(" ")[1]} ${badge.color.split(" ")[0]}`}
                        >
                          {badge.icon}
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center justify-between">
                            <span
                              className={`text-xs font-bold ${badge.color.split(" ")[0]}`}
                            >
                              {badge.label}
                            </span>
                            {component.duration && (
                              <span className="text-[10px] font-mono text-gray-500 dark:text-gray-600">
                                {component.duration}
                              </span>
                            )}
                          </div>
                          <p className="text-sm leading-snug text-gray-700 dark:text-gray-400">
                            {component.description || component.summary}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {lesson.alignment_notes && (
                <div className="border-t border-gray-200 pt-2 dark:border-gray-800">
                  <div className="flex items-start gap-2 text-xs italic text-gray-500">
                    <Info size={12} className="mt-0.5" />
                    <p>{lesson.alignment_notes}</p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
