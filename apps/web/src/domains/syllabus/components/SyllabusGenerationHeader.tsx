interface SyllabusGenerationHeaderProps {
  ideaCentral: string;
}

function cleanCourseTitle(ideaCentral: string): string {
  return (ideaCentral || "Curso sin nombre")
    .replace(/(TEMA:|IDEA PRINCIPAL:|PÚBLICO:|RESULTADOS:)/g, "")
    .split(".")[0]
    .trim();
}

export function SyllabusGenerationHeader({
  ideaCentral,
}: SyllabusGenerationHeaderProps) {
  const cleanTitle = cleanCourseTitle(ideaCentral);

  return (
    <div className="bg-white dark:bg-[#1E2329] rounded-2xl border border-gray-200 dark:border-white/5 p-8 relative overflow-hidden">
      <div className="relative z-10">
        <div className="flex items-center gap-4 mb-4">
          <div className="p-2.5 bg-[#00D4B3]/10 rounded-xl flex-shrink-0">
            <svg
              className="w-6 h-6 text-[#00D4B3]"
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
        <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed max-w-3xl">
          Define la estructura modular del curso{" "}
          <strong className="text-gray-900 dark:text-white">
            "{cleanTitle}"
          </strong>
          . Puedes generar con IA o importar un temario existente.
        </p>
      </div>
      <div className="absolute top-0 right-0 w-64 h-64 bg-[#0A2540] opacity-5 dark:opacity-20 blur-[100px] rounded-full pointer-events-none" />
    </div>
  );
}
