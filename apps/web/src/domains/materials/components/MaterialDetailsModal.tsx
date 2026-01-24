import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ChevronRight,
  CheckCircle,
  AlertTriangle,
  Clock,
  Layout,
  MessageSquare,
  BookOpen,
  HelpCircle,
  ListOrdered,
  Play,
  Sparkles,
  RefreshCw,
} from "lucide-react";
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
  onIterationStart: (lessonId: string, instructions: string) => void;
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
    <AnimatePresence>
      {isOpen && (
        <div
          className="fixed inset-0 flex items-center justify-center z-[9999]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal Content */}
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="relative w-[1200px] h-[80vh] rounded-2xl shadow-2xl overflow-hidden flex flex-row
                bg-white dark:bg-[#0F1419] border border-gray-200 dark:border-white/10"
          >
            {/* Left Panel - Navigation */}
            <div className="w-80 flex flex-col border-r border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#131820]">
              {/* Header */}
              <div className="p-6 border-b border-gray-200 dark:border-white/5">
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center 
                    bg-gradient-to-br from-blue-600 to-cyan-400 dark:from-[#0A2540] dark:to-[#00D4B3]">
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
                        ? "bg-white dark:bg-[#1E2329] text-blue-600 dark:text-[#00D4B3] shadow-md dark:shadow-shadow-black/20 border border-gray-200 dark:border-white/5"
                        : "text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200 hover:bg-gray-200 dark:hover:bg-white/5"
                    }`}
                  >
                    {getComponentIcon(comp.type)}
                    <span className="flex-1 text-left truncate">
                      {comp.type.replace(/_/g, " ")}
                    </span>
                    {selectedType === comp.type && (
                      <motion.div
                        layoutId="activeIndicator"
                        className="w-1.5 h-1.5 rounded-full bg-blue-600 dark:bg-[#00D4B3]"
                      />
                    )}
                  </button>
                ))}
              </div>

              {/* Actions Footer */}
              <div className="p-4 border-t border-gray-200 dark:border-white/5 bg-gray-50 dark:bg-[#0F1419]">
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setActiveTab("dod")}
                    className={`flex items-center justify-center gap-2 p-2 rounded-lg text-xs font-medium transition-colors ${
                      activeTab === "dod"
                        ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 shadow-sm"
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
                        ? "bg-white dark:bg-[#1E2329] text-gray-900 dark:text-white border border-gray-200 dark:border-white/10 shadow-sm"
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
            <div className="flex-1 flex flex-col relative bg-white dark:bg-[#0F1419]">
              <button
                onClick={onClose}
                className="absolute top-4 right-4 p-2 rounded-lg transition-colors z-10 text-gray-400 hover:text-gray-600 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-white/5"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex-1 overflow-y-auto p-8 custom-scrollbar">
                {activeTab === "preview" && selectedComponent ? (
                  <div className="max-w-3xl mx-auto space-y-6">
                    <div className="flex items-center gap-3 mb-8">
                      <span className="p-2 rounded-lg bg-blue-50 dark:bg-[#00D4B3]/10 text-blue-600 dark:text-[#00D4B3]">
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
                        bg-white dark:bg-[#1E2329] border border-gray-200 dark:border-white/5 text-gray-900 dark:text-gray-200">
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
                      <CheckCircle className="text-blue-600 dark:text-[#00D4B3]" />
                      Definition of Done
                    </h2>
                    <MaterialsDodChecklist
                      dod={lesson.dod!}
                      className="p-6 rounded-2xl border bg-white dark:bg-[#1E2329] border-gray-200 dark:border-white/5"
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
                      onStartIteration={(instr) =>
                        onIterationStart(lesson.id, instr)
                      }
                      className="p-6 rounded-2xl border shadow-xl bg-white dark:bg-[#1E2329] border-gray-200 dark:border-white/5"
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
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
