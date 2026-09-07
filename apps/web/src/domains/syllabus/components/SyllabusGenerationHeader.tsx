import { RefreshCw } from "lucide-react";

interface SyllabusGenerationHeaderProps {
  ideaCentral: string;
  canIterate?: boolean;
  isIterating?: boolean;
  iterationCount?: number;
  iterationLimit?: number;
  onIterate?: () => void;
}

function cleanCourseTitle(ideaCentral: string): string {
  return (ideaCentral || "Curso sin nombre")
    .replace(/(TEMA:|IDEA PRINCIPAL:|PÚBLICO:|RESULTADOS:)/g, "")
    .split(".")[0]
    .trim();
}

export function SyllabusGenerationHeader({
  ideaCentral,
  canIterate = true,
  isIterating = false,
  iterationCount = 0,
  iterationLimit = 5,
  onIterate,
}: SyllabusGenerationHeaderProps) {
  const cleanTitle = cleanCourseTitle(ideaCentral);

  return (
    <div className="bg-white dark:bg-[var(--engine-surface-hover)] rounded-2xl border border-gray-200 dark:border-white/5 p-8 relative overflow-hidden">
      <div className="relative z-10">
        <div className="mb-4 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="p-2.5 bg-[var(--engine-accent)]/10 rounded-xl flex-shrink-0">
              <svg
                className="w-6 h-6 text-[var(--engine-accent)]"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 012-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"
                />
              </svg>
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900 dark:text-white leading-tight">
                Crear Temario
              </h2>
              <p className="text-gray-500 dark:text-white/40 text-xs mt-1 font-medium tracking-wide">
                PASO 2 DEL PROCESO
              </p>
            </div>
          </div>

          {onIterate && (
            <button
              type="button"
              onClick={onIterate}
              disabled={isIterating || !canIterate}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[var(--engine-accent)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-all hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw
                size={16}
                className={isIterating ? "animate-spin" : ""}
              />
              {isIterating
                ? "Iterando..."
                : canIterate
                  ? `Iterar temario (${iterationCount}/${iterationLimit})`
                  : `Límite alcanzado (${iterationLimit}/${iterationLimit})`}
            </button>
          )}
        </div>
        <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed max-w-3xl">
          Define la estructura modular del curso{" "}
          <strong className="text-gray-900 dark:text-white">
            "{cleanTitle}"
          </strong>
          . Puedes generar con IA o importar un temario existente.
        </p>
      </div>
      <div className="absolute top-0 right-0 w-64 h-64 bg-[var(--engine-primary)] opacity-5 dark:opacity-20 blur-[100px] rounded-full pointer-events-none" />
    </div>
  );
}
