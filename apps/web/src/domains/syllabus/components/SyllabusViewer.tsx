import { useRef, useState } from "react";
import {
  SyllabusGenerationMetadata,
  SyllabusLesson,
  SyllabusModule,
  SyllabusValidationReport,
} from "../types/syllabus.types";
import { SyllabusModuleCard } from "./SyllabusModuleCard";
import { SyllabusValidationPanel } from "./SyllabusValidationPanel";
import { estimateLessonDurationMinutes } from "../lib/lesson-duration-estimator";
import { getModuleTitle } from "../lib/module-title";
import { syllabusModulesSchema } from "../syllabus-management-request.schema";

interface SyllabusViewerProps {
  modules: SyllabusModule[];
  validation?: SyllabusValidationReport;
  metadata?: SyllabusGenerationMetadata;
  onSave?: (newModules: SyllabusModule[]) => Promise<void>;
  isEditable?: boolean;
}

type ViewerTab = "SYLLABUS" | "VALIDATION";

function cloneModules(modules: SyllabusModule[]): SyllabusModule[] {
  return modules.map((module) => ({
    ...module,
    lessons: module.lessons.map((lesson) => ({ ...lesson })),
  }));
}

function createDraft(modules: SyllabusModule[]): SyllabusModule[] {
  return modules.map((module) => ({
    ...module,
    title: getModuleTitle(module.title),
    lessons: module.lessons.map((lesson) => ({
      ...lesson,
      id: lesson.id || crypto.randomUUID(),
    })),
  }));
}

function createLesson(): SyllabusLesson {
  return {
    id: crypto.randomUUID(),
    title: "",
    objective_specific: "",
    estimated_minutes: estimateLessonDurationMinutes({
      title: "",
      objective_specific: "",
    }),
  };
}

export function SyllabusViewer({
  modules,
  validation,
  metadata,
  onSave,
  isEditable = false,
}: SyllabusViewerProps) {
  const [activeTab, setActiveTab] = useState<ViewerTab>("SYLLABUS");
  const [expandedModules, setExpandedModules] = useState<number[]>([0]);
  const [editingModuleIdx, setEditingModuleIdx] = useState<number | null>(null);
  const [editedModules, setEditedModules] = useState<SyllabusModule[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveInFlight = useRef(false);
  const visibleModules = editingModuleIdx === null ? modules : editedModules;

  const totalLessons = visibleModules.reduce(
    (lessonCount, module) => lessonCount + module.lessons.length,
    0,
  );

  const handleStartEdit = (moduleIndex: number) => {
    setSaveError(null);
    setEditingModuleIdx(moduleIndex);
    setEditedModules(createDraft(modules));
  };

  const handleCancelEdit = () => {
    setSaveError(null);
    setEditingModuleIdx(null);
    setEditedModules([]);
  };

  const saveModules = async (nextModules: SyllabusModule[]) => {
    if (!onSave || saveInFlight.current) return false;
    const parsed = syllabusModulesSchema.safeParse(
      nextModules.map((module) => ({
        ...module,
        title: getModuleTitle(module.title),
      })),
    );
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const moduleIndex = issue.path[0];
      const lessonIndex = issue.path[2];
      const location =
        typeof moduleIndex === "number"
          ? `Módulo ${moduleIndex + 1}${typeof lessonIndex === "number" ? `, lección ${lessonIndex + 1}` : ""}: `
          : "";
      setSaveError(`${location}${issue.message}`);
      return false;
    }

    saveInFlight.current = true;
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(parsed.data);
      return true;
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "No se pudieron guardar los módulos.",
      );
      return false;
    } finally {
      saveInFlight.current = false;
      setIsSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    if (await saveModules(editedModules)) {
      handleCancelEdit();
    }
  };

  const updateEditedModules = (updater: (draft: SyllabusModule[]) => void) => {
    setEditedModules((currentModules) => {
      const draft = cloneModules(currentModules);
      updater(draft);
      return draft;
    });
  };

  const updateModuleTitle = (moduleIndex: number, title: string) => {
    updateEditedModules((draft) => {
      draft[moduleIndex].title = title;
    });
  };

  const updateLesson = <K extends keyof SyllabusLesson>(
    moduleIndex: number,
    lessonIndex: number,
    field: K,
    value: SyllabusLesson[K],
  ) => {
    updateEditedModules((draft) => {
      draft[moduleIndex].lessons[lessonIndex][field] = value;
    });
  };

  const handleDeleteModule = async (moduleIndex: number) => {
    if (!confirm("¿Estás seguro de que deseas eliminar este módulo?")) {
      return;
    }

    const newModules = modules.filter((_, index) => index !== moduleIndex);
    if (await saveModules(newModules)) {
      setExpandedModules((current) =>
        current
          .filter((index) => index !== moduleIndex)
          .map((index) => (index > moduleIndex ? index - 1 : index)),
      );
    }
  };

  const handleAddModule = () => {
    const newModule: SyllabusModule = {
      id: crypto.randomUUID(),
      objective_general_ref: "",
      title: "",
      lessons: [createLesson()],
    };

    setSaveError(null);
    setEditedModules([...createDraft(modules), newModule]);
    setEditingModuleIdx(modules.length);
  };

  const handleAddLesson = (moduleIndex: number) => {
    const lesson = createLesson();
    updateEditedModules((draft) => {
      draft[moduleIndex].lessons.push(lesson);
    });
  };

  const handleDeleteLesson = (moduleIndex: number, lessonIndex: number) => {
    updateEditedModules((draft) => {
      draft[moduleIndex].lessons = draft[moduleIndex].lessons.filter(
        (_, index) => index !== lessonIndex,
      );
    });
  };

  const toggleModule = (moduleIndex: number) => {
    if (editingModuleIdx !== null) {
      return;
    }

    setExpandedModules((currentExpanded) =>
      currentExpanded.includes(moduleIndex)
        ? currentExpanded.filter((index) => index !== moduleIndex)
        : [...currentExpanded, moduleIndex],
    );
  };

  if (!modules.length) {
    return (
      <div className="p-12 text-center text-gray-500 bg-gray-50 dark:bg-[var(--engine-surface-solid)] rounded-2xl border border-dashed border-gray-300 dark:border-gray-700">
        <p>No se ha generado contenido para el temario.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-4 border-b border-gray-200 dark:border-white/5 pb-1">
        <button
          onClick={() => setActiveTab("SYLLABUS")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] ${
            activeTab === "SYLLABUS"
              ? "text-gray-900 dark:text-white border-b-2 border-[var(--engine-accent)]"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          Estructura del Temario
        </button>
        <button
          onClick={() => setActiveTab("VALIDATION")}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition-colors relative top-[1px] flex items-center gap-2 ${
            activeTab === "VALIDATION"
              ? "text-gray-900 dark:text-white border-b-2 border-[var(--engine-accent)]"
              : "text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white"
          }`}
        >
          <span>Validación & Fuentes</span>
          {validation?.automatic_pass && (
            <svg
              className="w-4 h-4 text-[var(--engine-accent)]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          )}
        </button>
      </div>

      {activeTab === "VALIDATION" && (
        <SyllabusValidationPanel validation={validation} metadata={metadata} />
      )}

      {activeTab === "SYLLABUS" && (
        <>
          <div className="flex items-center gap-4 bg-white dark:bg-[var(--engine-surface-solid)] border border-gray-200 dark:border-white/5 p-4 rounded-xl text-sm justify-between">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-gray-600 dark:text-white/70">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                  />
                </svg>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {visibleModules.length} módulos
                </span>
              </div>
              <div className="w-px h-4 bg-gray-200 dark:bg-white/10" />
              <div className="flex items-center gap-2 text-gray-600 dark:text-white/70">
                <svg
                  className="w-4 h-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
                  />
                </svg>
                <span className="font-semibold text-gray-900 dark:text-white">
                  {totalLessons} lecciones
                </span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="bg-[var(--engine-accent)]/10 text-[var(--engine-accent)] px-2 py-1 rounded text-xs font-bold border border-[var(--engine-accent)]/20">
                {editingModuleIdx !== null
                  ? "Cambios sin guardar"
                  : validation?.automatic_pass
                    ? "Validación OK"
                    : "Requiere revisión"}
              </span>
            </div>
          </div>

          {saveError && (
            <p
              role="alert"
              className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300"
            >
              {saveError}
            </p>
          )}
          {isSaving && <p role="status">Guardando cambios…</p>}
          <fieldset
            disabled={isSaving}
            aria-busy={isSaving}
            className="min-w-0 space-y-4"
          >
            {visibleModules.map((module, moduleIndex) => {
              const isEditing = editingModuleIdx === moduleIndex;
              const isExpanded =
                expandedModules.includes(moduleIndex) || isEditing;

              return (
                <SyllabusModuleCard
                  key={module.id || moduleIndex}
                  module={module}
                  index={moduleIndex}
                  isEditable={
                    isEditable && !!onSave && editingModuleIdx === null
                  }
                  isExpanded={isExpanded}
                  isEditing={isEditing}
                  onToggle={() => toggleModule(moduleIndex)}
                  onStartEdit={() => handleStartEdit(moduleIndex)}
                  onDeleteModule={() => handleDeleteModule(moduleIndex)}
                  onSaveEdit={handleSaveEdit}
                  onCancelEdit={handleCancelEdit}
                  onUpdateModuleTitle={(title) =>
                    updateModuleTitle(moduleIndex, title)
                  }
                  onUpdateModuleObjective={(objective) =>
                    updateEditedModules((draft) => {
                      draft[moduleIndex].objective_general_ref = objective;
                    })
                  }
                  onUpdateLesson={(lessonIndex, field, value) =>
                    updateLesson(moduleIndex, lessonIndex, field, value)
                  }
                  onDeleteLesson={(lessonIndex) =>
                    handleDeleteLesson(moduleIndex, lessonIndex)
                  }
                  onAddLesson={() => handleAddLesson(moduleIndex)}
                />
              );
            })}

            {isEditable && onSave && editingModuleIdx === null && (
              <div className="flex justify-center mt-6">
                <button
                  onClick={handleAddModule}
                  className="flex items-center gap-2 px-5 py-2.5 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 border border-dashed border-gray-300 dark:border-white/20 rounded-xl text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white transition-colors text-sm font-medium shadow-sm hover:shadow"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M12 4v16m8-8H4"
                    />
                  </svg>
                  <span>Añadir Módulo</span>
                </button>
              </div>
            )}
          </fieldset>
        </>
      )}
    </div>
  );
}
