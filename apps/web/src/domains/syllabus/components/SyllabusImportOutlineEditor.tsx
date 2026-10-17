"use client";
import type { ImportOutline } from "../import/syllabus-import.schema";

interface Props {
  outline: ImportOutline;
  onChange: (outline: ImportOutline) => void;
  disabled: boolean;
}
const fieldClass =
  "w-full rounded-lg border border-gray-300 bg-white p-2 text-sm text-gray-900 dark:border-white/20 dark:bg-gray-900 dark:text-white";

export function SyllabusImportOutlineEditor({
  outline,
  onChange,
  disabled,
}: Props) {
  const changeModule = (
    index: number,
    update: Partial<ImportOutline[number]>,
  ) =>
    onChange(
      outline.map((module, position) =>
        position === index ? { ...module, ...update } : module,
      ),
    );
  const moveModule = (index: number, offset: number) => {
    const next = [...outline];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onChange(next);
  };
  return (
    <fieldset disabled={disabled} className="space-y-4">
      {outline.map((module, moduleIndex) => (
        <section
          key={module.id}
          className="space-y-3 rounded-xl border border-gray-200 p-4 dark:border-white/15"
        >
          <label className="block text-sm">
            Título del módulo {moduleIndex + 1}
            <input
              className={fieldClass}
              maxLength={500}
              value={module.title}
              onChange={(event) =>
                changeModule(moduleIndex, { title: event.target.value })
              }
            />
          </label>
          <label className="block text-sm">
            Objetivo general (opcional durante revisión)
            <textarea
              className={fieldClass}
              maxLength={2_000}
              value={module.objective_general_ref}
              onChange={(event) =>
                changeModule(moduleIndex, {
                  objective_general_ref: event.target.value,
                })
              }
            />
          </label>
          <div className="flex flex-wrap gap-3 text-sm">
            <button
              type="button"
              disabled={moduleIndex === 0 || disabled}
              onClick={() => moveModule(moduleIndex, -1)}
            >
              Subir módulo
            </button>
            <button
              type="button"
              disabled={moduleIndex === outline.length - 1 || disabled}
              onClick={() => moveModule(moduleIndex, 1)}
            >
              Bajar módulo
            </button>
            <button
              type="button"
              className="text-red-600"
              onClick={() =>
                onChange(outline.filter((_, index) => index !== moduleIndex))
              }
            >
              Eliminar módulo
            </button>
          </div>
          {module.lessons.map((lesson, lessonIndex) => {
            const update = (fields: Partial<typeof lesson>) =>
              changeModule(moduleIndex, {
                lessons: module.lessons.map((entry, index) =>
                  index === lessonIndex ? { ...entry, ...fields } : entry,
                ),
              });
            return (
              <div
                key={lesson.id}
                className="space-y-2 border-l-2 border-emerald-300 pl-4"
              >
                <label className="block text-sm">
                  Lección {moduleIndex + 1}.{lessonIndex + 1}
                  <input
                    className={fieldClass}
                    maxLength={500}
                    value={lesson.title}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </label>
                <label className="block text-sm">
                  Objetivo específico (se completará si está vacío)
                  <textarea
                    className={fieldClass}
                    maxLength={2_000}
                    value={lesson.objective_specific}
                    onChange={(event) =>
                      update({ objective_specific: event.target.value })
                    }
                  />
                </label>
                <label className="block text-sm">
                  Temas incluidos, uno por línea
                  <textarea
                    className={fieldClass}
                    value={lesson.topics.join("\n")}
                    onChange={(event) =>
                      update({
                        topics: event.target.value
                          .split("\n")
                          .filter((topic) => topic.trim()),
                      })
                    }
                  />
                </label>
                {lesson.sourceQuote && (
                  <details className="text-xs text-gray-500">
                    <summary>Fragmento del documento original</summary>
                    <p className="whitespace-pre-wrap">{lesson.sourceQuote}</p>
                  </details>
                )}
                <div className="flex flex-wrap gap-3 text-sm">
                  <button
                    type="button"
                    disabled={lessonIndex === 0 || disabled}
                    onClick={() => {
                      const next = [...module.lessons];
                      [next[lessonIndex - 1], next[lessonIndex]] = [
                        next[lessonIndex],
                        next[lessonIndex - 1],
                      ];
                      changeModule(moduleIndex, { lessons: next });
                    }}
                  >
                    Subir lección
                  </button>
                  <button
                    type="button"
                    disabled={
                      lessonIndex === module.lessons.length - 1 || disabled
                    }
                    onClick={() => {
                      const next = [...module.lessons];
                      [next[lessonIndex + 1], next[lessonIndex]] = [
                        next[lessonIndex],
                        next[lessonIndex + 1],
                      ];
                      changeModule(moduleIndex, { lessons: next });
                    }}
                  >
                    Bajar lección
                  </button>
                  <button
                    type="button"
                    className="text-red-600"
                    onClick={() =>
                      changeModule(moduleIndex, {
                        lessons: module.lessons.filter(
                          (_, index) => index !== lessonIndex,
                        ),
                      })
                    }
                  >
                    Eliminar lección
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="text-sm font-semibold"
            onClick={() =>
              changeModule(moduleIndex, {
                lessons: [
                  ...module.lessons,
                  {
                    id: crypto.randomUUID(),
                    title: "Nueva lección",
                    objective_specific: "",
                    topics: [],
                    sourceQuote: "",
                  },
                ],
              })
            }
          >
            Agregar lección
          </button>
        </section>
      ))}
      <button
        type="button"
        className="text-sm font-semibold"
        onClick={() =>
          onChange([
            ...outline,
            {
              id: crypto.randomUUID(),
              title: "Nuevo módulo",
              objective_general_ref: "",
              sourceQuote: "",
              lessons: [],
            },
          ])
        }
      >
        Agregar módulo
      </button>
    </fieldset>
  );
}
