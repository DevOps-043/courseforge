import { useState, useEffect } from "react";
import {
  CheckCircle,
  Layout,
  MessageSquare,
  BookOpen,
  HelpCircle,
  ListOrdered,
  Play,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { EngineDialog } from "@/components/ui/EngineDialog";
import {
  MaterialLesson,
  MaterialComponent,
  ComponentType,
} from "../types/materials.types";
import { ComponentViewer } from "./ComponentViewer";
import { IterationPanel } from "./IterationPanel";
import { MaterialsDodChecklist } from "./MaterialsDodChecklist";

interface MaterialDetailsModalProps {
  lesson: MaterialLesson;
  components: MaterialComponent[];
  isOpen: boolean;
  onClose: () => void;
  onIterationStart: (lessonId: string, instructions: string, componentTypes?: string[]) => void;
}

export function MaterialDetailsModal({
  lesson,
  components,
  isOpen,
  onClose,
  onIterationStart,
}: MaterialDetailsModalProps) {
  const [selectedType, setSelectedType] = useState<ComponentType | null>(
    components.length > 0 ? components[0].type : null,
  );
  const [activeTab, setActiveTab] = useState<"preview" | "dod" | "iteration">(
    "preview",
  );

  // Sync selection when components change (e.g., after iteration)
  useEffect(() => {
    if (components.length > 0) {
      if (!selectedType || !components.some(c => c.type === selectedType)) {
        setSelectedType(components[0].type);
      }
    } else {
        setSelectedType(null);
    }
  }, [components, selectedType]);

  const getComponentIcon = (type: ComponentType) => {
    switch (type) {
      case "DIALOGUE": return <MessageSquare className="w-4 h-4" />;
      case "READING": return <BookOpen className="w-4 h-4" />;
      case "QUIZ": return <HelpCircle className="w-4 h-4" />;
      case "DEMO_GUIDE": return <ListOrdered className="w-4 h-4" />;
      case "EXERCISE": return <Layout className="w-4 h-4" />;
      case "VIDEO_DEMO": return <Play className="w-4 h-4" />;
      default: return <Layout className="w-4 h-4" />;
    }
  };

  const selectedComponent = components.find((c) => c.type === selectedType);

  return (
    <EngineDialog
      isOpen={isOpen}
      onClose={onClose}
      size="workspace"
      eyebrow="Estudio de materiales"
      title={lesson.lesson_title}
      description="Previsualiza, valida e itera los componentes de esta lección."
      icon={<Layout aria-hidden="true" />}
      bodyClassName="!p-0"
    >
      <div className="flex h-[min(44rem,calc(100svh-8rem))] min-h-0 flex-col md:flex-row">
            {/* Left Panel - Navigation */}
            <div className="flex max-h-64 w-full flex-col border-b border-[var(--engine-border)] bg-[var(--engine-surface-soft)] md:max-h-none md:w-72 md:border-b-0 md:border-r">
              {/* Header */}
              <div className="p-6 border-b border-gray-200 dark:border-white/5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center 
                    bg-gradient-to-br from-blue-600 to-cyan-400 dark:from-[var(--engine-primary)] dark:to-[var(--engine-accent)]">
                    <Layout className="text-white w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-sm leading-tight line-clamp-2 text-gray-900 dark:text-white">
                      {lesson.lesson_title}
                    </h3>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full border ${
                          lesson.state === "APPROVABLE"
                            ? "bg-green-100 dark:bg-green-500/10 border-green-200 dark:border-green-500/20 text-green-700 dark:text-green-400"
                            : "bg-yellow-100 dark:bg-yellow-500/10 border-yellow-200 dark:border-yellow-500/20 text-yellow-700 dark:text-yellow-400"
                        }`}
                      >
                        {lesson.state}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Component List */}
              <div className="flex-1 overflow-y-auto p-4 space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wider mb-3 px-2 text-gray-500 dark:text-gray-500">
                  Materiales Generados
                </p>
                {components.map((comp) => (
                  <button
                    key={comp.id}
                    onClick={() => {
                      setSelectedType(comp.type);
                      setActiveTab("preview");
                    }}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-sm transition-all ${
                      selectedType === comp.type
                        ? "bg-white dark:bg-[var(--engine-surface-hover)] text-blue-600 dark:text-[var(--engine-accent)] shadow-md dark:shadow-shadow-black/20 border border-gray-200 dark:border-white/5"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/5"
                    }`}
                  >
                    {getComponentIcon(comp.type)}
                    <span className="flex-1 text-left truncate">
                      {comp.type.replace(/_/g, " ")}
                    </span>
                    {selectedType === comp.type && (
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--engine-accent)]" />
                    )}
                  </button>
                ))}
              </div>

              {/* Actions Footer */}
              <div className="p-4 border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[var(--engine-canvas)]">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setActiveTab("dod")}
                    className={`flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === "dod"
                        ? "bg-white dark:bg-[var(--engine-surface-hover)] text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/5"
                    }`}
                  >
                    <CheckCircle className="w-3.5 h-3.5" />
                    DoD Status
                  </button>
                  <button
                    onClick={() => setActiveTab("iteration")}
                    className={`flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === "iteration"
                        ? "bg-white dark:bg-[var(--engine-surface-hover)] text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 shadow-sm"
                        : "text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-white/5"
                    }`}
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Iterar
                  </button>
                </div>
              </div>
            </div>

            {/* Right Panel - Content */}
            <div className="flex-1 flex flex-col relative bg-white dark:bg-[var(--engine-canvas)]">
              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeTab === "preview" && selectedComponent ? (
                  <div className="max-w-3xl mx-auto space-y-6">
                    <div className="flex items-center gap-3 mb-8">
                      <span className="p-2 rounded-lg bg-blue-50 dark:bg-[var(--engine-accent)]/10 text-blue-600 dark:text-[var(--engine-accent)]">
                        {getComponentIcon(selectedComponent.type)}
                      </span>
                      <div>
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                          {selectedComponent.type.replace(/_/g, " ")}
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Vista previa del material generado
                        </p>
                      </div>
                    </div>
                    <div className="material-content-wrapper p-6 rounded-2xl shadow-xl 
                        bg-white dark:bg-[var(--engine-surface-hover)] border border-gray-200 dark:border-white/5 text-gray-900 dark:text-gray-200">
                      <ComponentViewer
                        component={selectedComponent}
                        variant="embedded"
                        className="border-0 shadow-none !bg-transparent"
                      />
                    </div>
                  </div>
                ) : activeTab === "dod" ? (
                  <div className="max-w-2xl mx-auto pt-10">
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3 text-gray-900 dark:text-white">
                      <CheckCircle className="text-blue-600 dark:text-[var(--engine-accent)]" />
                      Definition of Done
                    </h2>
                    <MaterialsDodChecklist
                      dod={lesson.dod!}
                      className="p-6 rounded-2xl border bg-white dark:bg-[var(--engine-surface-hover)] border-gray-200 dark:border-white/5"
                    />
                  </div>
                ) : activeTab === "iteration" ? (
                  <div className="max-w-2xl mx-auto pt-10">
                    <h2 className="text-2xl font-bold mb-6 flex items-center gap-3 text-gray-900 dark:text-white">
                      <Sparkles className="text-orange-500 dark:text-[#F59E0B]" />
                      Iteración con IA
                    </h2>
                    <IterationPanel
                      currentIteration={lesson.iteration_count}
                      maxIterations={lesson.max_iterations}
                      availableComponents={lesson.expected_components}
                      onStartIteration={(instr, types) =>
                        onIterationStart(lesson.id, instr, types)
                      }
                      className="p-6 rounded-2xl border shadow-xl bg-white dark:bg-[var(--engine-surface-hover)] border-gray-200 dark:border-white/5"
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full text-gray-400 dark:text-gray-500">
                    <Layout className="w-16 h-16 mb-4 opacity-20" />
                    <p>Selecciona un componente para ver su contenido</p>
                  </div>
                )}
              </div>
            </div>
      </div>
    </EngineDialog>
  );
}
