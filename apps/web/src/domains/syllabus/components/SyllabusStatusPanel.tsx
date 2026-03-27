interface SyllabusStatusPanelProps {
  status: "STEP_GENERATING" | "STEP_ESCALATED";
  error?: string | null;
}

export function SyllabusStatusPanel({
  status,
  error,
}: SyllabusStatusPanelProps) {
  if (status === "STEP_GENERATING") {
    return (
      <div className="bg-white dark:bg-[#1E2329] rounded-2xl border border-gray-200 dark:border-white/5 p-12 text-center">
        <div className="inline-block relative w-16 h-16 mb-6">
          <div className="absolute inset-0 rounded-full border-4 border-[#00D4B3]/20 border-t-[#00D4B3] animate-spin" />
          <div className="absolute inset-0 flex items-center justify-center">
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
                d="M13 10V3L4 14h7v7l9-11h-7z"
              />
            </svg>
          </div>
        </div>
        <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
          Generando Estructura Inteligente
        </h3>
        <p className="text-gray-500 dark:text-gray-400">
          Analizando objetivos, investigando tendencias y estructurando módulos...
        </p>
      </div>
    );
  }

  return (
    <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-500/20 rounded-2xl p-6">
      <h3 className="text-red-700 dark:text-red-300 font-bold mb-2">
        Error al generar el temario
      </h3>
      <p className="text-red-600 dark:text-red-200 text-sm">{error}</p>
    </div>
  );
}
