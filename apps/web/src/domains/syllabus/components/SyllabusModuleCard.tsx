import { SyllabusLesson, SyllabusModule } from "../types/syllabus.types";

interface SyllabusModuleCardProps {
  module: SyllabusModule;
  index: number;
  isEditable: boolean;
  isExpanded: boolean;
  isEditing: boolean;
  onToggle: () => void;
  onStartEdit: () => void;
  onDeleteModule: () => Promise<void>;
  onSaveEdit: () => Promise<void>;
  onCancelEdit: () => void;
  onUpdateModuleTitle: (title: string) => void;
  onUpdateLesson: <K extends keyof SyllabusLesson>(
    lessonIndex: number,
    field: K,
    value: SyllabusLesson[K],
  ) => void;
  onDeleteLesson: (lessonIndex: number) => void;
  onAddLesson: () => void;
}

export function SyllabusModuleCard({
  module,
  index,
  isEditable,
  isExpanded,
  isEditing,
  onToggle,
  onStartEdit,
  onDeleteModule,
  onSaveEdit,
  onCancelEdit,
  onUpdateModuleTitle,
  onUpdateLesson,
  onDeleteLesson,
  onAddLesson,
}: SyllabusModuleCardProps) {
  return (
    <div
      className={`group bg-white dark:bg-[#151A21] rounded-2xl border ${isEditing ? "border-[#00D4B3] ring-1 ring-[#00D4B3]/30" : "border-gray-200 dark:border-white/5"} overflow-hidden transition-all duration-300`}
    >
      <div className="w-full px-6 py-5 flex justify-between items-start">
        <div
          onClick={() => !isEditing && onToggle()}
          className={`flex-1 ${!isEditing ? "cursor-pointer" : ""}`}
        >
          <div className="flex items-center gap-2 mb-1">
            {isEditing ? (
              <input
                className="bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-lg font-bold text-gray-900 dark:text-white w-full focus:outline-none focus:border-[#00D4B3] transition-all focus:bg-white dark:focus:bg-[#151A21] placeholder-gray-400 dark:placeholder-gray-600 shadow-inner"
                value={module.title}
                onChange={(event) => onUpdateModuleTitle(event.target.value)}
              />
            ) : (
              <h3 className="text-lg font-bold text-gray-900 dark:text-white group-hover:text-[#00D4B3] transition-colors">
                Módulo {index + 1}: {module.title}
              </h3>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pl-4">
          {!isEditing && isEditable && (
            <div className="flex items-center gap-2">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onStartEdit();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 dark:bg-white/5 hover:bg-gray-200 dark:hover:bg-white/10 rounded-lg text-gray-500 dark:text-gray-400 hover:text-[#00D4B3] transition-colors border border-gray-200 dark:border-white/5 hover:border-[#00D4B3]/30 text-xs font-medium"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                  />
                </svg>
                <span>Editar</span>
              </button>
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  void onDeleteModule();
                }}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 dark:bg-red-500/10 hover:bg-red-100 dark:hover:bg-red-500/20 rounded-lg text-red-500 dark:text-red-400 hover:text-red-600 dark:hover:text-red-300 transition-colors border border-red-200 dark:border-red-500/20 hover:border-red-300 dark:hover:border-red-500/30 text-xs font-medium"
                title="Eliminar módulo"
              >
                <svg
                  className="w-3.5 h-3.5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                <span className="hidden sm:inline">Eliminar</span>
              </button>
            </div>
          )}

          {isEditing ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void onSaveEdit()}
                className="p-1.5 bg-green-500/10 hover:bg-green-500/20 text-green-500 rounded-lg"
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
                    d="M5 13l4 4L19 7"
                  />
                </svg>
              </button>
              <button
                onClick={onCancelEdit}
                className="p-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-500 rounded-lg"
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
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>
          ) : (
            <div onClick={onToggle} className="cursor-pointer flex items-center gap-3">
              <span className="text-xs font-medium bg-gray-100 dark:bg-[#0F1419] px-2.5 py-1 rounded-md border border-gray-200 dark:border-white/10 text-gray-500 dark:text-gray-400">
                {module.lessons.length} lecciones
              </span>
              <svg
                className={`w-5 h-5 text-gray-400 dark:text-gray-500 transition-transform duration-300 ${isExpanded ? "rotate-180" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 9l-7 7-7-7"
                />
              </svg>
            </div>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#0F1419]/50 animate-in slide-in-from-top-1 duration-200">
          <div className="p-4 space-y-2">
            {module.lessons.map((lesson, lessonIndex) => (
              <div
                key={`${lesson.title}-${lessonIndex}`}
                className="p-4 rounded-xl hover:bg-gray-100 dark:hover:bg-white/5 transition-colors group/item border border-transparent hover:border-gray-200 dark:hover:border-white/5"
              >
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-8 h-8 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6] flex items-center justify-center text-xs font-bold font-mono border border-[#1F5AF6]/20 mt-0.5">
                    {index + 1}.{lessonIndex + 1}
                  </div>

                  <div className="flex-grow min-w-0 space-y-2">
                    {isEditing ? (
                      <div className="space-y-3 relative">
                        <div className="flex justify-between items-start gap-4">
                          <input
                            className="w-full bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-base font-medium text-gray-900 dark:text-white focus:outline-none focus:border-[#00D4B3] transition-all focus:bg-white dark:focus:bg-[#151A21] placeholder-gray-400 dark:placeholder-gray-600"
                            value={lesson.title}
                            onChange={(event) =>
                              onUpdateLesson(
                                lessonIndex,
                                "title",
                                event.target.value,
                              )
                            }
                            placeholder="Título de la lección"
                          />
                          {module.lessons.length > 1 && (
                            <button
                              onClick={() => onDeleteLesson(lessonIndex)}
                              className="shrink-0 p-3 mt-0.5 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10 rounded-xl transition-colors border border-transparent hover:border-red-100 dark:hover:border-red-500/20"
                              title="Eliminar lección"
                            >
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                        <textarea
                          className="w-full bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-gray-700 dark:text-gray-300 focus:outline-none focus:border-[#00D4B3] min-h-[80px] transition-all focus:bg-white dark:focus:bg-[#151A21] resize-none placeholder-gray-400 dark:placeholder-gray-600"
                          value={lesson.objective_specific}
                          onChange={(event) =>
                            onUpdateLesson(
                              lessonIndex,
                              "objective_specific",
                              event.target.value,
                            )
                          }
                          placeholder="Objetivo específico de esta lección..."
                        />
                        <div className="flex items-center gap-3 bg-gray-50 dark:bg-[#151A21] rounded-xl px-4 py-2 border border-gray-200 dark:border-white/5 w-fit hover:border-gray-300 dark:hover:border-white/10 transition-colors group/time">
                          <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-500 group-hover/time:bg-blue-500/20 transition-colors">
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
                                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                          </div>
                          <div className="w-px h-6 bg-gray-200 dark:bg-white/5" />
                          <div className="flex flex-col justify-center">
                            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider leading-none mb-0.5">
                              Tiempo Est.
                            </span>
                            <div className="flex items-baseline gap-1">
                              <input
                                type="number"
                                className="bg-transparent border-none p-0 text-sm font-bold text-gray-900 dark:text-white w-12 focus:outline-none focus:ring-0 font-mono text-right appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                value={lesson.estimated_minutes}
                                onChange={(event) =>
                                  onUpdateLesson(
                                    lessonIndex,
                                    "estimated_minutes",
                                    parseInt(event.target.value, 10),
                                  )
                                }
                              />
                              <span className="text-xs text-gray-400 font-medium">
                                min
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <>
                        <h4 className="text-base font-medium text-gray-800 dark:text-gray-200 mb-1.5 group-hover/item:text-blue-600 dark:group-hover/item:text-white transition-colors">
                          {lesson.title}
                        </h4>
                        <div className="text-sm text-gray-500 dark:text-gray-500 flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <svg
                              className="w-3.5 h-3.5 opacity-50"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                              />
                            </svg>
                            <span className="truncate opacity-80">
                              {lesson.objective_specific}
                            </span>
                          </div>
                          {lesson.estimated_minutes && (
                            <div className="flex items-center gap-2">
                              <svg
                                className="w-3.5 h-3.5 opacity-50"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                                />
                              </svg>
                              <span className="opacity-80 font-mono text-xs">
                                {lesson.estimated_minutes} min
                              </span>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {isEditing && (
              <div className="p-4 border-t border-gray-200/50 dark:border-white/5">
                <button
                  onClick={onAddLesson}
                  className="w-full py-3 flex items-center justify-center gap-2 border-2 border-dashed border-[#00D4B3]/30 hover:border-[#00D4B3] rounded-xl text-[#00D4B3] hover:bg-[#00D4B3]/5 transition-colors text-sm font-semibold"
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
                  <span>Añadir Lección</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
