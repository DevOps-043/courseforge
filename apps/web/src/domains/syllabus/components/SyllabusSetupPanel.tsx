import { SyllabusInputMode, Esp02Route, SyllabusModule } from "../types/syllabus.types";
import { SyllabusImportForm } from "./SyllabusImportForm";
import { SyllabusRouteSelector } from "./SyllabusRouteSelector";

interface SyllabusSetupPanelProps {
  activeTab: SyllabusInputMode;
  route: Esp02Route | null;
  onTabChange: (tab: SyllabusInputMode) => void;
  onRouteChange: (route: Esp02Route | null) => void;
  onGenerate: () => void;
  onImport: (modules: SyllabusModule[]) => void;
}

const TAB_OPTIONS: Array<{
  value: SyllabusInputMode;
  title: string;
  description: string;
  iconPath: string;
}> = [
  {
    value: "GENERATE",
    title: "Generar con IA",
    description: "La IA crea el temario basándose en los objetivos.",
    iconPath: "M13 10V3L4 14h7v7l9-11h-7z",
  },
  {
    value: "IMPORT",
    title: "Importar Temario",
    description: "Pega un temario existente en formato Markdown.",
    iconPath:
      "M8 7v8a2 2 0 002 2h6M8 7V5a2 2 0 012-2h4.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V15a2 2 0 01-2 2h-2M8 7H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2v-2",
  },
];

export function SyllabusSetupPanel({
  activeTab,
  route,
  onTabChange,
  onRouteChange,
  onGenerate,
  onImport,
}: SyllabusSetupPanelProps) {
  return (
    <>
      <div className="grid grid-cols-2 gap-4">
        {TAB_OPTIONS.map((option) => {
          const isActive = activeTab === option.value;

          return (
            <button
              key={option.value}
              onClick={() => onTabChange(option.value)}
              className={`
                p-6 rounded-xl border-2 text-left transition-all relative overflow-hidden group
                ${
                  isActive
                    ? "border-[#00D4B3] bg-[#00D4B3]/5"
                    : "border-gray-200 dark:border-white/5 bg-white dark:bg-[#1E2329] hover:bg-gray-50 dark:hover:bg-white/5"
                }
              `}
            >
              <div className="flex items-center gap-3 mb-2">
                <div
                  className={`p-1.5 rounded ${
                    isActive
                      ? "bg-[#00D4B3] text-[#0A2540]"
                      : "bg-gray-100 dark:bg-white/10 text-gray-500 dark:text-gray-400"
                  }`}
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
                      d={option.iconPath}
                    />
                  </svg>
                </div>
                <h3
                  className={`font-bold ${
                    isActive
                      ? "text-gray-900 dark:text-white"
                      : "text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {option.title}
                </h3>
              </div>
              <p className="text-sm text-gray-500 group-hover:text-gray-600 dark:group-hover:text-gray-400 transition-colors">
                {option.description}
              </p>

              {isActive && (
                <div className="absolute top-4 right-4 w-2 h-2 rounded-full bg-[#00D4B3] shadow-[0_0_10px_#00D4B3]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-2">
        {activeTab === "GENERATE" && (
          <div className="space-y-6">
            <div className="bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-white/5 rounded-2xl p-6">
              <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-widest mb-6">
                Método de Generación
              </h4>
              <SyllabusRouteSelector
                selectedRoute={route}
                onSelect={onRouteChange}
              />
            </div>

            <button
              onClick={onGenerate}
              className={`
                w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all
                ${
                  route
                    ? "bg-[#00D4B3] text-[#0A2540] hover:bg-[#00bda0] shadow-[0_4px_20px_rgba(0,212,179,0.2)]"
                    : "bg-gray-200 dark:bg-gray-800 text-gray-400 dark:text-gray-500 cursor-not-allowed"
                }
              `}
              disabled={!route}
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
                  d="M13 10V3L4 14h7v7l9-11h-7z"
                />
              </svg>
              Generar Temario con IA
            </button>
          </div>
        )}

        {activeTab === "IMPORT" && <SyllabusImportForm onImport={onImport} />}
      </div>
    </>
  );
}
