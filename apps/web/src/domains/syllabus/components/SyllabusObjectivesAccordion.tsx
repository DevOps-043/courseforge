interface SyllabusObjectivesAccordionProps {
  objectives: string[];
  isOpen: boolean;
  onToggle: () => void;
}

export function SyllabusObjectivesAccordion({
  objectives,
  isOpen,
  onToggle,
}: SyllabusObjectivesAccordionProps) {
  return (
    <div className="space-y-2">
      <button
        onClick={onToggle}
        className="w-full bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-white/5 rounded-xl px-6 py-4 flex justify-between items-center cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5 transition-all group"
      >
        <div className="flex items-center gap-4">
          <div className="p-2 bg-gray-100 dark:bg-white/5 rounded-lg group-hover:bg-gray-200 dark:group-hover:bg-white/10 transition-colors">
            <svg
              className="w-5 h-5 text-gray-500 dark:text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"
              />
            </svg>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-900 dark:text-white font-medium">
              Objetivos de Aprendizaje
            </span>
            <span className="px-2.5 py-0.5 rounded-full bg-gray-100 dark:bg-white/10 text-xs text-gray-600 dark:text-white/70 font-mono border border-gray-200 dark:border-white/5">
              {objectives.length}
            </span>
          </div>
        </div>
        <svg
          className={`w-5 h-5 text-gray-400 dark:text-gray-500 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
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
      </button>

      {isOpen && (
        <div className="bg-gray-50 dark:bg-[#1E2329]/50 border border-gray-200 dark:border-white/5 rounded-xl p-6 animate-in slide-in-from-top-2 duration-200">
          <ul className="space-y-3">
            {objectives.map((objective, index) => (
              <li
                key={`${objective}-${index}`}
                className="flex gap-4 text-sm text-gray-600 dark:text-gray-300 items-start"
              >
                <span className="flex-shrink-0 w-6 h-6 rounded-full bg-[#00D4B3]/10 text-[#00D4B3] flex items-center justify-center text-xs font-mono border border-[#00D4B3]/20 mt-0.5">
                  {index + 1}
                </span>
                <span className="leading-relaxed">{objective}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
