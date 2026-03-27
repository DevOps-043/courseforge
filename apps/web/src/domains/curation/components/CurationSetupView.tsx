"use client";

import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clipboard,
  ExternalLink,
  FileText,
  Loader2,
  Play,
  RefreshCw,
  Settings2,
  Sparkles,
  Upload,
} from "lucide-react";
import { DEFAULT_PROMPT_PREVIEW } from "../lib/curation-ui";

interface CurationSetupModule {
  lessons: unknown[];
}

interface CurationSetupViewProps {
  copiedToClipboard: boolean;
  isProcessingJson: boolean;
  jsonError: string | null;
  jsonInput: string;
  jsonPreview: {
    count: number;
    lessons: string[];
  } | null;
  onGenerate: () => Promise<void> | void;
  onImportJson: () => Promise<void> | void;
  onJsonInputChange: (value: string) => void;
  onOpenGPT: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
  setShowAutomaticFlow: (value: boolean) => void;
  setShowJsonImport: (value: boolean) => void;
  showAutomaticFlow: boolean;
  showJsonImport: boolean;
  temario?: CurationSetupModule[];
}

export function CurationSetupView({
  copiedToClipboard,
  isProcessingJson,
  jsonError,
  jsonInput,
  jsonPreview,
  onGenerate,
  onImportJson,
  onJsonInputChange,
  onOpenGPT,
  onRefresh,
  setShowAutomaticFlow,
  setShowJsonImport,
  showAutomaticFlow,
  showJsonImport,
  temario,
}: CurationSetupViewProps) {
  const hasTemario = Boolean(temario && temario.length > 0);
  const lessonsCount =
    temario?.reduce((acc, module) => acc + module.lessons.length, 0) ?? 0;

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-20 animate-in fade-in slide-in-from-bottom-4 duration-500 relative">
      <div className="space-y-2">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-3">
          <div className="p-2 rounded-lg bg-[#1F5AF6]/10 text-[#1F5AF6]">
            <Sparkles size={24} />
          </div>
          Paso 4: Curaduria de Fuentes (Fase 2)
        </h2>
        <p className="text-gray-500 dark:text-[#94A3B8] text-base leading-relaxed max-w-2xl ml-12">
          Encuentra fuentes de alta calidad para cada leccion. Busqueda profunda
          con 1-2 fuentes verificadas por leccion.
        </p>
      </div>

      <div className="bg-gradient-to-br from-[#1F5AF6]/5 via-[#00D4B3]/5 to-[#1F5AF6]/5 dark:from-[#1F5AF6]/10 dark:via-[#00D4B3]/10 dark:to-[#1F5AF6]/10 border border-[#1F5AF6]/20 dark:border-[#1F5AF6]/30 rounded-2xl p-8 shadow-xl shadow-[#1F5AF6]/5 dark:shadow-black/20 transition-all duration-300 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-32 h-32 bg-[#1F5AF6]/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-24 h-24 bg-[#00D4B3]/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[#1F5AF6]/20 text-[#1F5AF6]">
              <Sparkles size={20} />
            </div>
            <div>
              <h3 className="text-gray-900 dark:text-white font-bold text-lg">
                Buscar con ChatGPT
              </h3>
              <span className="text-[10px] bg-[#1F5AF6]/20 text-[#1F5AF6] px-2 py-0.5 rounded font-bold uppercase tracking-wider">
                Recomendado
              </span>
            </div>
          </div>

          <p className="text-gray-600 dark:text-[#94A3B8] text-sm leading-relaxed mb-6 max-w-lg">
            Usa nuestro GPT especializado para encontrar fuentes verificadas y
            relevantes. El contexto del taller se copiara automaticamente al
            portapapeles.
          </p>

          <div className="flex flex-wrap gap-3 mb-6">
            {["Fuentes Verificadas", "Revision Humana", "Envio Automatico"].map(
              (tag) => (
                <span
                  key={tag}
                  className="text-[10px] bg-white dark:bg-[#151A21] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-3 py-1.5 rounded-full font-medium flex items-center gap-1.5"
                >
                  <CheckCircle2 size={10} className="text-[#00D4B3]" />
                  {tag}
                </span>
              ),
            )}
          </div>

          <button
            onClick={onOpenGPT}
            disabled={!hasTemario}
            className={`w-full py-4 rounded-xl font-bold text-lg flex items-center justify-center gap-3 transition-all relative overflow-hidden ${
              hasTemario
                ? "bg-[#1F5AF6] hover:bg-[#1548c7] text-white shadow-lg shadow-[#1F5AF6]/25 hover:shadow-[#1F5AF6]/40 hover:-translate-y-0.5"
                : "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
            }`}
          >
            {copiedToClipboard ? (
              <>
                <CheckCircle2 size={20} />
                Copiado. Abriendo ChatGPT...
              </>
            ) : (
              <>
                <ExternalLink size={20} />
                Buscar fuentes con ChatGPT
              </>
            )}
          </button>

          <div className="mt-6 flex flex-col justify-center items-center gap-3 border-t border-[#1F5AF6]/10 pt-6">
            <p className="text-gray-600 dark:text-[#94A3B8] text-sm text-center font-medium">
              El asistente termino de generar las fuentes?
            </p>
            <button
              onClick={onRefresh}
              className="px-6 py-2.5 bg-white dark:bg-[#10151A] border border-gray-200 dark:border-[#334155] text-gray-700 dark:text-gray-300 rounded-xl shadow-sm hover:border-[#1F5AF6]/50 hover:text-[#1F5AF6] dark:hover:text-[#1F5AF6] transition-all flex items-center justify-center gap-2 group"
            >
              <RefreshCw
                size={16}
                className="group-hover:rotate-180 transition-transform duration-500"
              />
              Actualizar y ver resultados
            </button>
          </div>

          {!hasTemario && (
            <p className="text-center text-amber-500 text-xs mt-3 flex items-center justify-center gap-1">
              <AlertCircle size={12} />
              Necesitas completar el temario primero (Paso 2)
            </p>
          )}

          {hasTemario && (
            <p className="text-center text-gray-500 dark:text-[#6C757D] text-xs mt-3">
              Se copiara el contexto del taller ({lessonsCount} lecciones) al
              portapapeles.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden shadow-md shadow-black/5 dark:shadow-black/20 transition-all duration-300">
        <button
          onClick={() => setShowJsonImport(!showJsonImport)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-[#1A2027] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#8B5CF6]/10 text-[#8B5CF6]">
              <FileText size={18} />
            </div>
            <div>
              <h3 className="text-gray-900 dark:text-white font-semibold text-sm">
                Ya tienes el JSON del GPT?
              </h3>
              <p className="text-gray-500 dark:text-[#6C757D] text-xs">
                Pega aqui el resultado que genero ChatGPT
              </p>
            </div>
          </div>
          {showJsonImport ? (
            <ChevronUp size={20} className="text-gray-400" />
          ) : (
            <ChevronDown size={20} className="text-gray-400" />
          )}
        </button>

        {showJsonImport && (
          <div className="p-6 pt-0 animate-in fade-in slide-in-from-top-2 duration-300 border-t border-gray-100 dark:border-[#2D333B]">
            <div className="mb-4">
              <label className="text-gray-700 dark:text-gray-300 font-medium text-sm flex items-center gap-2 mb-2">
                <Clipboard size={14} className="text-[#8B5CF6]" />
                Pega el JSON completo
              </label>
              <textarea
                value={jsonInput}
                onChange={(event) => onJsonInputChange(event.target.value)}
                className={`w-full h-48 bg-gray-50 dark:bg-[#0F1419] border rounded-xl p-4 text-sm font-mono leading-relaxed focus:outline-none transition-colors resize-none ${
                  jsonError
                    ? "border-[#EF4444]/50 focus:border-[#EF4444]"
                    : jsonPreview
                      ? "border-[#00D4B3]/50 focus:border-[#00D4B3]"
                      : "border-gray-300 dark:border-[#6C757D]/30 focus:border-[#8B5CF6]"
                } text-gray-900 dark:text-gray-300`}
                placeholder='{\n  "course_id": "IA-3269",\n  "sources": [\n    {\n      "title": "...",\n      "url": "https://...",\n      "type": "documentation",\n      "lesson_id": "les-1-1",\n      "lesson_title": "...",\n      "summary": "...",\n      "validated": true\n    }\n  ]\n}'
                disabled={isProcessingJson}
              />
            </div>

            {jsonError && (
              <div className="mb-4 flex items-start gap-2 bg-[#EF4444]/10 border border-[#EF4444]/20 rounded-lg p-3">
                <AlertCircle
                  size={16}
                  className="text-[#EF4444] mt-0.5 flex-shrink-0"
                />
                <p className="text-[#EF4444] text-sm">{jsonError}</p>
              </div>
            )}

            {jsonPreview && (
              <div className="mb-4 bg-[#00D4B3]/5 border border-[#00D4B3]/20 rounded-lg p-3">
                <div className="flex items-center gap-2 mb-2">
                  <CheckCircle2 size={14} className="text-[#00D4B3]" />
                  <span className="text-[#00D4B3] text-sm font-medium">
                    {jsonPreview.count} fuentes detectadas
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {jsonPreview.lessons.slice(0, 8).map((lesson) => (
                    <span
                      key={lesson}
                      className="text-[10px] bg-white dark:bg-[#151A21] text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded"
                    >
                      {lesson.length > 40
                        ? `${lesson.substring(0, 40)}...`
                        : lesson}
                    </span>
                  ))}
                  {jsonPreview.lessons.length > 8 && (
                    <span className="text-[10px] text-gray-500 dark:text-gray-400 px-2 py-1">
                      +{jsonPreview.lessons.length - 8} mas
                    </span>
                  )}
                </div>
              </div>
            )}

            <button
              onClick={onImportJson}
              disabled={!jsonInput.trim() || Boolean(jsonError) || isProcessingJson}
              className={`w-full py-3 rounded-xl font-bold text-base flex items-center justify-center gap-3 transition-all ${
                !jsonInput.trim() || Boolean(jsonError) || isProcessingJson
                  ? "bg-gray-300 dark:bg-gray-700 text-gray-500 dark:text-gray-400 cursor-not-allowed"
                  : "bg-[#8B5CF6] hover:bg-[#7C3AED] text-white shadow-md shadow-[#8B5CF6]/20"
              }`}
            >
              {isProcessingJson ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Procesando...
                </>
              ) : (
                <>
                  <Upload size={18} />
                  Importar Fuentes
                </>
              )}
            </button>

            <p className="text-center text-gray-500 dark:text-[#6C757D] text-xs mt-3">
              Las fuentes existentes generadas por GPT seran reemplazadas.
            </p>
          </div>
        )}
      </div>

      <div className="flex items-center gap-4">
        <div className="flex-1 h-px bg-gray-200 dark:bg-[#2D333B]" />
        <span className="text-xs text-gray-400 dark:text-[#6C757D] font-medium">
          o
        </span>
        <div className="flex-1 h-px bg-gray-200 dark:bg-[#2D333B]" />
      </div>

      <div className="bg-white dark:bg-[#151A21] border border-gray-200 dark:border-[#6C757D]/10 rounded-2xl overflow-hidden shadow-md shadow-black/5 dark:shadow-black/20 transition-all duration-300">
        <button
          onClick={() => setShowAutomaticFlow(!showAutomaticFlow)}
          className="w-full p-4 flex items-center justify-between text-left hover:bg-gray-50 dark:hover:bg-[#1A2027] transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-[#00D4B3]/10 text-[#00D4B3]">
              <Settings2 size={18} />
            </div>
            <div>
              <h3 className="text-gray-900 dark:text-white font-semibold text-sm">
                Busqueda Automatica
              </h3>
              <p className="text-gray-500 dark:text-[#6C757D] text-xs">
                Usa el sistema de curaduria automatica con IA
              </p>
            </div>
          </div>
          {showAutomaticFlow ? (
            <ChevronUp size={20} className="text-gray-400" />
          ) : (
            <ChevronDown size={20} className="text-gray-400" />
          )}
        </button>

        {showAutomaticFlow && (
          <div className="p-6 pt-0 animate-in fade-in slide-in-from-top-2 duration-300 border-t border-gray-100 dark:border-[#2D333B]">
            <div className="mb-6 bg-gray-50 dark:bg-[#0F1419] border border-gray-200 dark:border-[#6C757D]/10 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-3">
                <Settings2 size={14} className="text-[#00D4B3]" />
                <h4 className="text-gray-700 dark:text-gray-300 font-medium text-sm">
                  Prompt por defecto
                </h4>
              </div>
              <p className="text-gray-600 dark:text-[#94A3B8] text-sm leading-relaxed">
                {DEFAULT_PROMPT_PREVIEW}
              </p>
              <div className="flex flex-wrap gap-2 mt-3">
                {["Google Search", "Validacion URL", "Anti-Hallucination"].map(
                  (tag) => (
                    <span
                      key={tag}
                      className="text-[10px] bg-white dark:bg-[#151A21] text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-700 px-2 py-1 rounded font-bold uppercase tracking-wider"
                    >
                      {tag}
                    </span>
                  ),
                )}
              </div>
            </div>

            <button
              onClick={onGenerate}
              className="w-full py-3 rounded-xl font-bold text-base flex items-center justify-center gap-3 transition-all bg-[#00D4B3] hover:bg-[#00bda0] text-[#0A2540] shadow-md shadow-[#00D4B3]/20"
            >
              <Play size={18} fill="currentColor" />
              Iniciar Curaduria Automatica
            </button>

            <p className="text-center text-gray-500 dark:text-[#6C757D] text-xs mt-3">
              La curaduria validara la disponibilidad de enlaces externamente.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
