import {
  SyllabusGenerationMetadata,
  SyllabusValidationReport,
} from "../types/syllabus.types";

interface SyllabusValidationPanelProps {
  validation?: SyllabusValidationReport;
  metadata?: SyllabusGenerationMetadata;
}

export function SyllabusValidationPanel({
  validation,
  metadata,
}: SyllabusValidationPanelProps) {
  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
      <div className="bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/5 p-6 space-y-4">
        <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">
          Reglas de Calidad (Agentic Checks)
        </h4>
        <div className="grid gap-3">
          {validation?.checks.map((check) => (
            <div
              key={check.code}
              className={`px-4 py-3 rounded-xl border flex items-start gap-3 ${
                check.pass
                  ? "bg-white dark:bg-[#151A21] border-[#00D4B3]/20"
                  : "bg-red-50 dark:bg-[#151A21] border-red-500/20"
              }`}
            >
              <div
                className={`mt-0.5 flex-shrink-0 ${check.pass ? "text-[#00D4B3]" : "text-red-500"}`}
              >
                {check.pass ? (
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
                      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                ) : (
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
                      d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                )}
              </div>
              <div className="text-sm">
                <span
                  className={`font-mono font-bold mr-2 ${check.pass ? "text-[#00D4B3]" : "text-red-500"}`}
                >
                  {check.code}
                </span>
                <span
                  className={
                    check.pass
                      ? "text-gray-600 dark:text-gray-300"
                      : "text-red-600 dark:text-red-400"
                  }
                >
                  {check.message}
                </span>
              </div>
            </div>
          ))}
          {(!validation?.checks || validation.checks.length === 0) && (
            <p className="text-gray-500 text-sm">
              No hay reporte de validación disponible.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-[#151A21] rounded-2xl border border-gray-200 dark:border-white/5 p-6">
        <h4 className="text-sm font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-4">
          Fuentes de Investigación (Google Search)
        </h4>

        {metadata?.search_queries && metadata.search_queries.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {metadata.search_queries.map((query) => (
              <a
                key={query}
                href={`https://www.google.com/search?q=${encodeURIComponent(query)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-1.5 rounded-lg bg-gray-100 dark:bg-white/5 border border-gray-200 dark:border-white/10 text-sm text-blue-600 dark:text-blue-300 flex items-center gap-2 hover:bg-gray-200 dark:hover:bg-white/10 hover:border-blue-400/30 hover:text-blue-700 dark:hover:text-blue-200 transition-all"
              >
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
                    d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                  />
                </svg>
                {query}
              </a>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 text-sm italic">
            No se detectaron consultas de búsqueda específicas o se usó
            conocimiento base.
          </p>
        )}

        {metadata?.research_summary && (
          <div className="mt-6 pt-6 border-t border-gray-200 dark:border-white/5">
            <p className="text-xs font-bold text-gray-500 mb-2">
              RESUMEN DE INVESTIGACIÓN
            </p>
            <div className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
              {metadata.research_summary.split("###").map((section, index) => {
                if (!section.trim()) {
                  return null;
                }

                const sectionLines = section.trim().split("\n");
                const isTitle =
                  index > 0 || metadata.research_summary?.includes("###");
                const title = isTitle ? sectionLines[0] : "";
                const contentLines = isTitle
                  ? sectionLines.slice(1)
                  : sectionLines;

                if (!title && contentLines.length === 0) {
                  return null;
                }

                return (
                  <div key={`${title}-${index}`} className="mb-6 last:mb-0">
                    {title && (
                      <h5 className="font-bold text-gray-900 dark:text-white mb-3 text-base">
                        {title.replace(/^\s*#+\s*/, "")}
                      </h5>
                    )}
                    <div className="space-y-2">
                      {contentLines.map((line, lineIndex) => {
                        if (!line.trim()) {
                          return null;
                        }

                        const isList = /^\s*[-*]\s/.test(line);
                        const cleanLine = line.replace(/^\s*[-*]\s/, "");
                        const parts = cleanLine.split(/(\*\*.*?\*\*)/g);

                        return (
                          <div
                            key={`${lineIndex}-${cleanLine}`}
                            className={`text-sm leading-relaxed ${isList ? "flex gap-2 pl-2" : ""}`}
                          >
                            {isList && (
                              <span className="text-[#00D4B3] mt-1.5 w-1.5 h-1.5 rounded-full bg-[#00D4B3] shrink-0 block" />
                            )}
                            <p
                              className={
                                isList
                                  ? "text-gray-700 dark:text-gray-300"
                                  : "text-gray-600 dark:text-gray-400"
                              }
                            >
                              {parts.map((part, partIndex) => {
                                if (
                                  part.startsWith("**") &&
                                  part.endsWith("**")
                                ) {
                                  return (
                                    <strong
                                      key={partIndex}
                                      className="text-gray-900 dark:text-white font-semibold"
                                    >
                                      {part.slice(2, -2)}
                                    </strong>
                                  );
                                }

                                return part;
                              })}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
