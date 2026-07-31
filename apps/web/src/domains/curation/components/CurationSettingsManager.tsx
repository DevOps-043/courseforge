"use client";

import { useEffect, useState } from "react";
import {
  Box,
  BrainCircuit,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  History,
  Loader2,
  MessageSquareCode,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PremiumSelect } from "@/shared/components/PremiumSelect";
import {
  getModelSettingsAction,
  getSystemPromptHistoryAction,
  getSystemPromptsAction,
  resetPromptToDefaultAction,
  restorePromptVersionAction,
  updateModelSettingsAction,
  updateSystemPromptAction,
} from "@/app/admin/settings/actions";
import type { ModelSettingsRecord } from "@/app/admin/settings/actions";
import type { SystemPrompt } from "@/domains/prompts/types";

type CurationConfig = ModelSettingsRecord;

const OBSOLETE_SETTING_TYPES = new Set(["LIA MODEL", "LIA_MODEL", "COMPUTER"]);

const SETTING_ORDER = [
  "ARTIFACT_BASE",
  "SYLLABUS",
  "INSTRUCTIONAL_PLAN",
  "CURATION",
  "MATERIALS",
  "SEARCH",
  "DEFAULT",
];

const SETTING_METADATA: Record<
  string,
  { title: string; icon: React.ReactNode; accent: "green" | "teal" }
> = {
  ARTIFACT_BASE: {
    title: "Generacion de Base del Curso (Fase 1)",
    icon: <Zap size={16} />,
    accent: "teal",
  },
  SYLLABUS: {
    title: "Generacion de Syllabus (Fase 2)",
    icon: <BrainCircuit size={16} />,
    accent: "teal",
  },
  INSTRUCTIONAL_PLAN: {
    title: "Plan Instruccional (Fase 3)",
    icon: <Settings2 size={16} />,
    accent: "teal",
  },
  CURATION: {
    title: "Curaduria y Validacion de Fuentes (Fase 4)",
    icon: <CheckCircle2 size={16} />,
    accent: "green",
  },
  MATERIALS: {
    title: "Generacion de Materiales Educativos (Fase 5)",
    icon: <Box size={16} />,
    accent: "teal",
  },
  SEARCH: {
    title: "Busqueda y Recuperacion",
    icon: <Search size={16} />,
    accent: "teal",
  },
  DEFAULT: {
    title: "Configuracion General",
    icon: <Settings2 size={16} />,
    accent: "teal",
  },
};

const PROMPT_CODE_MATCHERS: Record<string, (code: string) => boolean> = {
  ARTIFACT_BASE: (code) =>
    code.includes("ARTIFACT_BASE") ||
    code.includes("COURSE_BASE") ||
    code.includes("BASE_COURSE"),
  SYLLABUS: (code) => code.includes("SYLLABUS"),
  INSTRUCTIONAL_PLAN: (code) => code.includes("INSTRUCTIONAL_PLAN"),
  CURATION: (code) =>
    code.includes("CURATION") ||
    code.includes("SOURCE") ||
    code.includes("SOURCES") ||
    code.includes("FUENTES"),
  MATERIALS: (code) =>
    code.includes("MATERIAL") ||
    code.includes("CLIP_GENERATION") ||
    code.includes("BROLL") ||
    code.includes("B_ROLL") ||
    code.includes("VIDEO_PROMPT") ||
    code.includes("PRODUCTION"),
};

const LEGACY_PROMPT_CODES = new Set([
  "CURATION_PLAN",
  "MATERIALS_GENERATION",
  "VIDEO_BROLL_PROMPTS",
]);

const PROMPT_HELP_TEXT: Record<string, string> = {
  ARTIFACT_BASE_RESEARCH:
    "Funcion: investiga tendencias y contexto reciente antes de crear la base del curso. Estructura: usa {{courseTitle}}, {{courseDescription}} y {{feedbackBlock}} para armar la consulta de investigacion.",
  ARTIFACT_BASE:
    "Funcion: genera nombres, objetivos Bloom y descripcion base del curso. Estructura: combina {{researchContext}}, {{courseTitle}}, {{courseDescription}}, {{bloomVerbs}} y {{feedbackBlock}}.",
  SYLLABUS_RESEARCH:
    "Funcion: investiga el tema y objetivos antes de construir el temario. Estructura: usa {{ideaCentral}} y {{objetivos}} para pedir tendencias, conceptos clave y estructura recomendada.",
  SYLLABUS:
    "Funcion: genera modulos y lecciones del temario. Estructura: usa {{ideaCentral}}, {{objetivos}} y {{routeContext}}; debe devolver JSON con modules y lessons.",
  INSTRUCTIONAL_PLAN:
    "Funcion: genera el plan instruccional por leccion. Estructura: usa variables como ${courseName}, ${ideaCentral}, ${lessonCount} y ${lessonsText}; debe orientar OA, Bloom, criterios y componentes.",
  INSTRUCTIONAL_PLAN_SYSTEM:
    "Funcion: define las reglas globales de diseno instruccional para la fase 3. Estructura: explica calidad esperada, componentes permitidos, criterios Bloom y formato JSON que debe respetar el plan.",
  CURATION:
    "Funcion: guia la busqueda automatica de fuentes por leccion. Estructura: define criterios de candidatos, tipos de fuentes permitidas y restricciones; el sistema anade contexto del curso y lecciones.",
  MATERIALS_SYSTEM:
    "Funcion: reglas globales para generar materiales educativos. Estructura: define formato JSON, restricciones, accesibilidad, coherencia Bloom y uso de fuentes.",
  MATERIALS_DIALOGUE:
    "Funcion: configura actividades conversacionales de SofLIA. Estructura: define objetivo, escenario, criterios, evidencia esperada, pistas, rescate, rubrica y politica del runtime.",
  MATERIALS_READING:
    "Funcion: genera lecturas de refuerzo. Estructura: indica secciones, longitud, HTML permitido, puntos clave y pregunta reflexiva.",
  MATERIALS_QUIZ:
    "Funcion: genera cuestionarios formativos. Estructura: define cantidad de preguntas, tipos, opciones limpias, respuesta correcta, explicacion y passing_score.",
  MATERIALS_VIDEO_THEORETICAL:
    "Funcion: genera guion y storyboard de video teorico. Estructura: define secciones, timecodes, narracion literal, texto en pantalla y visuales.",
  MATERIALS_VIDEO_DEMO:
    "Funcion: genera guion y storyboard de demostracion. Estructura: define entorno, pasos en pantalla, buenas practicas, errores comunes y narracion literal.",
  MATERIALS_VIDEO_GUIDE:
    "Funcion: genera video guia para practica paso a paso. Estructura: define preparacion, ejecucion, revision, criterios visibles, storyboard y ejercicio paralelo.",
  MATERIALS_DEMO_GUIDE:
    "Funcion: genera guia demo paso a paso. Estructura: define prerequisitos, pasos, placeholders de screenshots, tips, warnings, video_script y ejercicio paralelo.",
  MATERIALS_EXERCISE:
    "Funcion: genera ejercicios practicos independientes. Estructura: define instrucciones, HTML, resultado esperado y condiciones reproducibles en pantalla.",
  CLIP_GENERATION_PROMPTS:
    "Funcion: convierte escenas de storyboard en terminos de busqueda para clips externos. Estructura: devuelve JSON con prompts, scene_index, original_description y generated_prompt.",
};

const ALL_MODEL_OPTIONS = [
  // Modelos Google Gemini
  {
    value: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    description: "Rapido, estable y recomendado para la mayoria de pasos",
  },
  {
    value: "gemini-1.5-flash",
    label: "Gemini 1.5 Flash",
    description: "Eficiente y veloz",
  },
  {
    value: "gemini-1.5-pro",
    label: "Gemini 1.5 Pro",
    description: "Razonamiento complejo y analisis profundo",
  },
  {
    value: "gemini-2.0-flash-lite",
    label: "Gemini 2.0 Flash Lite",
    description: "Alta escala y muy economico",
  },
  // Modelos OpenAI GPT-5 & Next-Gen
  {
    value: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Maxima calidad y capacidad analitica",
  },
  {
    value: "gpt-5.6-luna",
    label: "GPT-5.6 Luna",
    description: "Alta capacidad / costo eficiente",
  },
  {
    value: "gpt-5.6-terra",
    label: "GPT-5.6 Terra",
    description: "Balance calidad/costo",
  },
  {
    value: "gpt-5.5",
    label: "GPT-5.5",
    description: "Frontier / menor costo que 5.6",
  },
  {
    value: "gpt-5.5-pro",
    label: "GPT-5.5 Pro",
    description: "Mas preciso / mayor costo",
  },
  {
    value: "gpt-5.4",
    label: "GPT-5.4",
    description: "Profesional / mas economico",
  },
  {
    value: "gpt-5.4-pro",
    label: "GPT-5.4 Pro",
    description: "Mayor calidad / trabajos dificiles",
  },
  {
    value: "gpt-5.4-mini",
    label: "GPT-5.4 mini",
    description: "Rapido / alto volumen",
  },
  {
    value: "gpt-5.4-nano",
    label: "GPT-5.4 nano",
    description: "Minimo costo / tareas simples",
  },
  // Modelos OpenAI GPT Standard
  {
    value: "gpt-4o",
    label: "GPT-4o (OpenAI)",
    description: "Modelo insignia multimodal de alta capacidad",
  },
  {
    value: "gpt-4o-mini",
    label: "GPT-4o Mini (OpenAI)",
    description: "Rapido, inteligente y altamente costo-eficiente",
  },
  {
    value: "o3-mini",
    label: "o3-mini (OpenAI)",
    description: "Modelo de razonamiento logico y codigo",
  },
  {
    value: "o1",
    label: "o1 (OpenAI)",
    description: "Razonamiento avanzado para problemas complejos",
  },
  {
    value: "gpt-4-turbo",
    label: "GPT-4 Turbo (OpenAI)",
    description: "Modelo GPT-4 analitico tradicional",
  },
];

const REASONING_LEVEL_OPTIONS = [
  { value: "minimal", label: "Minimal", description: "Rapido" },
  { value: "low", label: "Low", description: "Rapido y balanceado" },
  { value: "medium", label: "Medium", description: "Analitico" },
  { value: "high", label: "High", description: "Profundo" },
];

const OPENAI_REASONING_LEVEL_OPTIONS = [
  { value: "none", label: "None", description: "Sin razonamiento extra" },
  { value: "low", label: "Low", description: "Rapido y balanceado" },
  { value: "medium", label: "Medium", description: "Analitico" },
  { value: "high", label: "High", description: "Profundo" },
  { value: "xhigh", label: "XHigh", description: "Muy profundo" },
  { value: "max", label: "Max", description: "Maxima exploracion" },
];

function getModelOptions(_settingType: string) {
  return ALL_MODEL_OPTIONS;
}

function getReasoningOptions(settingType: string) {
  return settingType === "CURATION"
    ? OPENAI_REASONING_LEVEL_OPTIONS
    : REASONING_LEVEL_OPTIONS;
}

function getMetadata(settingType: string) {
  return (
    SETTING_METADATA[settingType] || {
      title: `Configuracion de ${settingType}`,
      icon: <Settings2 size={16} />,
      accent: "teal" as const,
    }
  );
}

function getPromptsForSetting(settingType: string, prompts: SystemPrompt[]) {
  const matcher = PROMPT_CODE_MATCHERS[settingType];

  if (!matcher) {
    return [];
  }

  return prompts
    .filter((prompt) => {
      const code = prompt.code.toUpperCase();
      return !LEGACY_PROMPT_CODES.has(code) && matcher(code);
    })
    .sort((left, right) => left.code.localeCompare(right.code));
}

function getPromptHelpText(prompt: SystemPrompt) {
  return (
    PROMPT_HELP_TEXT[prompt.code.toUpperCase()] ||
    "Funcion: prompt configurable de esta fase del pipeline. Estructura: conserva las variables entre {{ }} o ${ } porque el sistema las reemplaza al ejecutar el flujo."
  );
}

function PromptHelpTooltip({ text }: { text: string }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        aria-label="Ver ayuda del prompt"
        className="w-5 h-5 rounded-full border border-gray-300 dark:border-[#6C757D]/40 text-[11px] font-bold text-gray-500 dark:text-[#94A3B8] hover:border-[#00D4B3] hover:text-[#00D4B3] focus:outline-none focus:ring-2 focus:ring-[#00D4B3]/30 transition-colors"
      >
        ?
      </button>
      <span className="pointer-events-none absolute left-1/2 top-7 z-30 hidden w-80 -translate-x-1/2 rounded-lg border border-gray-200 bg-white p-3 text-left text-xs font-normal leading-relaxed text-gray-600 shadow-xl shadow-black/10 group-hover:block group-focus-within:block dark:border-[#6C757D]/20 dark:bg-[#151A21] dark:text-gray-300">
        {text}
      </span>
    </span>
  );
}

function PhasePromptEditor({
  prompt,
  history,
  historyLoading,
  saving,
  resetting,
  restoringId,
  onLoadHistory,
  onRestoreVersion,
  onSave,
  onReset,
}: {
  prompt: SystemPrompt;
  history?: SystemPrompt[];
  historyLoading: boolean;
  saving: boolean;
  resetting: boolean;
  restoringId: string | null;
  onLoadHistory: (prompt: SystemPrompt) => void;
  onRestoreVersion: (prompt: SystemPrompt) => void;
  onSave: (prompt: SystemPrompt, content: string) => void;
  onReset: (prompt: SystemPrompt) => void;
}) {
  const [draft, setDraft] = useState(prompt.content);
  const [isOpen, setIsOpen] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  useEffect(() => {
    setDraft(prompt.content);
  }, [prompt.id, prompt.content]);

  const hasChanges = draft !== prompt.content;
  const handleToggleHistory = () => {
    const nextShowHistory = !showHistory;
    setShowHistory(nextShowHistory);
    setIsOpen(true);
    if (nextShowHistory && !history) {
      onLoadHistory(prompt);
    }
  };

  return (
    <div className="border border-gray-200 dark:border-[#6C757D]/10 rounded-xl overflow-hidden bg-gray-50 dark:bg-[#0F1419]/50">
      <div className="px-4 py-3 border-b border-gray-200 dark:border-[#6C757D]/10 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div
          role="button"
          tabIndex={0}
          onClick={() => setIsOpen((current) => !current)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              setIsOpen((current) => !current);
            }
          }}
          className="min-w-0 flex flex-1 items-start gap-2 text-left"
        >
          {isOpen ? (
            <ChevronDown size={16} className="mt-0.5 text-gray-400" />
          ) : (
            <ChevronRight size={16} className="mt-0.5 text-gray-400" />
          )}
          <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquareCode size={15} className="text-[#00D4B3]" />
            <h5 className="text-sm font-semibold text-gray-900 dark:text-white truncate">
              {prompt.code} v{prompt.version}
            </h5>
            <PromptHelpTooltip text={getPromptHelpText(prompt)} />
            {prompt.is_org_override && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                {prompt.is_restored_default ? "Default restaurado" : "Personalizado"}
              </span>
            )}
            {prompt.is_active && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
                Activo
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 dark:text-[#94A3B8] mt-1 truncate">
            {prompt.description || "Sin descripcion"}
          </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleToggleHistory}
            disabled={historyLoading || saving || resetting}
            className="px-3 py-2 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-[#6C757D]/20 hover:bg-white dark:hover:bg-white/5 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {historyLoading ? <Loader2 size={13} className="animate-spin" /> : <History size={13} />}
            Historial
          </button>
          {prompt.is_org_override && (
            <button
              type="button"
              onClick={() => onReset(prompt)}
              disabled={resetting || saving}
              className="px-3 py-2 rounded-lg text-xs font-semibold text-amber-600 dark:text-amber-400 border border-amber-500/30 hover:bg-amber-500/10 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {resetting ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <RotateCcw size={13} />
              )}
              Restaurar
            </button>
          )}
          <button
            type="button"
            onClick={() => onSave(prompt, draft)}
            disabled={saving || resetting || !hasChanges}
            className="px-3 py-2 rounded-lg text-xs font-semibold bg-[#00D4B3] text-white dark:text-black hover:bg-[#00D4B3]/90 transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
            Guardar
          </button>
        </div>
      </div>

      {isOpen && (
        <>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            className="w-full min-h-72 bg-white dark:bg-[#0F1419] text-gray-900 dark:text-gray-300 font-mono text-sm p-4 resize-y focus:outline-none focus:ring-1 focus:ring-[#00D4B3]/30 leading-relaxed"
            spellCheck={false}
            placeholder="Contenido del prompt"
          />

          {showHistory && (
            <div className="border-t border-gray-200 dark:border-[#6C757D]/10 bg-white dark:bg-[#0B1118] p-4">
              <div className="mb-3 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gray-500 dark:text-[#94A3B8]">
                <History size={14} />
                Historial de versiones
              </div>
              {historyLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-500">
                  <Loader2 size={13} className="animate-spin" />
                  Cargando historial...
                </div>
              ) : history && history.length > 0 ? (
                <div className="space-y-2">
                  {history.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-lg border border-gray-200 dark:border-[#6C757D]/10 bg-gray-50 dark:bg-[#0F1419]/60 p-3"
                    >
                      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-gray-900 dark:text-white">
                              v{item.version}
                            </span>
                            <span className="text-[10px] uppercase tracking-wider text-gray-500 dark:text-[#94A3B8]">
                              {item.organization_id ? "Organizacion" : "Global"}
                            </span>
                            {item.is_active && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-500/20">
                                Activa
                              </span>
                            )}
                            {item.source && (
                              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-gray-200/70 text-gray-600 dark:bg-white/5 dark:text-gray-300">
                                {item.source}
                              </span>
                            )}
                          </div>
                          <p className="mt-1 text-[11px] text-gray-500 dark:text-[#94A3B8]">
                            {new Date(item.created_at).toLocaleString()}
                            {item.change_summary ? ` - ${item.change_summary}` : ""}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => onRestoreVersion(item)}
                          disabled={item.id === prompt.id || Boolean(restoringId) || saving || resetting}
                          className="px-3 py-2 rounded-lg text-xs font-semibold text-[#00D4B3] border border-[#00D4B3]/30 hover:bg-[#00D4B3]/10 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                          {restoringId === item.id ? <Loader2 size={13} className="animate-spin" /> : <RotateCcw size={13} />}
                          Restaurar esta version
                        </button>
                      </div>
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[11px] font-semibold text-gray-500 hover:text-gray-900 dark:text-[#94A3B8] dark:hover:text-white">
                          Ver contenido
                        </summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-white p-3 text-[11px] text-gray-700 dark:bg-[#070A0F] dark:text-gray-300">
                          {item.content}
                        </pre>
                      </details>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-gray-500 dark:text-[#94A3B8]">
                  No hay historial para este prompt.
                </p>
              )}
            </div>
          )}

          <div className="px-4 py-2 border-t border-gray-200 dark:border-[#6C757D]/10 text-xs text-gray-500 dark:text-[#94A3B8] flex flex-col gap-1 md:flex-row md:justify-between">
            <span>
              {prompt.is_org_override
                ? "Version activa para esta organizacion"
                : "Version global default activa"}
            </span>
            <span>Ultima actualizacion: {new Date(prompt.updated_at).toLocaleDateString()}</span>
          </div>
        </>
      )}
    </div>
  );
}

export function CurationSettingsManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsList, setSettingsList] = useState<CurationConfig[]>([]);
  const [prompts, setPrompts] = useState<SystemPrompt[]>([]);
  const [promptSavingId, setPromptSavingId] = useState<string | null>(null);
  const [promptResettingCode, setPromptResettingCode] = useState<string | null>(null);
  const [promptHistories, setPromptHistories] = useState<Record<string, SystemPrompt[]>>({});
  const [promptHistoryLoadingCode, setPromptHistoryLoadingCode] = useState<string | null>(null);
  const [promptRestoringId, setPromptRestoringId] = useState<string | null>(null);

  useEffect(() => {
    async function loadSettings() {
      const [settingsRes, promptsRes] = await Promise.all([
        getModelSettingsAction(),
        getSystemPromptsAction(),
      ]);

      if (settingsRes.success && settingsRes.settings) {
        const filtered = settingsRes.settings.filter(
          (setting) => !OBSOLETE_SETTING_TYPES.has(setting.setting_type),
        );
        filtered.sort((a, b) => {
          const leftIndex = SETTING_ORDER.indexOf(a.setting_type);
          const rightIndex = SETTING_ORDER.indexOf(b.setting_type);
          return (
            (leftIndex === -1 ? 999 : leftIndex) -
            (rightIndex === -1 ? 999 : rightIndex)
          );
        });
        setSettingsList(filtered);
      } else {
        console.error("Error loading settings:", settingsRes.error);
        toast.error("Error al cargar la configuracion de modelos");
      }

      if (promptsRes.success && promptsRes.prompts) {
        setPrompts(promptsRes.prompts);
      } else {
        console.error("Error loading prompts:", promptsRes.error);
        toast.error("Error al cargar los prompts");
      }

      setLoading(false);
    }

    loadSettings();
  }, []);

  const handleUpdate = <Key extends keyof CurationConfig>(
    id: number,
    key: Key,
    value: CurationConfig[Key],
  ) => {
    setSettingsList((previous) =>
      previous.map((item) =>
        item.id === id ? { ...item, [key]: value } : item,
      ),
    );
  };

  const saveSettings = async () => {
    setSaving(true);
    const res = await updateModelSettingsAction(settingsList);

    if (!res.success) {
      toast.error(res.error || "Error guardando algunas configuraciones");
    } else {
      toast.success("Configuraciones de modelos guardadas correctamente");
    }

    setSaving(false);
  };

  const refreshPrompts = async () => {
    const promptsRes = await getSystemPromptsAction();
    if (promptsRes.success && promptsRes.prompts) {
      setPrompts(promptsRes.prompts);
    }
  };

  const loadPromptHistory = async (prompt: SystemPrompt) => {
    setPromptHistoryLoadingCode(prompt.code);
    const res = await getSystemPromptHistoryAction(prompt.code);

    if (res.success && res.prompts) {
      setPromptHistories((previous) => ({
        ...previous,
        [prompt.code]: res.prompts!,
      }));
    } else {
      toast.error(res.error || "Error al cargar historial del prompt");
    }

    setPromptHistoryLoadingCode(null);
  };

  const savePrompt = async (prompt: SystemPrompt, content: string) => {
    setPromptSavingId(prompt.id);

    const res = await updateSystemPromptAction({
      id: prompt.id,
      content,
    });

    if (res.success && res.prompt) {
      await refreshPrompts();
      if (promptHistories[prompt.code]) {
        await loadPromptHistory(prompt);
      }
      toast.success(`Prompt guardado como v${res.prompt.version}`);
    } else {
      toast.error(res.error || "Error al guardar el prompt");
    }

    setPromptSavingId(null);
  };

  const resetPrompt = async (prompt: SystemPrompt) => {
    setPromptResettingCode(prompt.code);

    const res = await resetPromptToDefaultAction(prompt.code);

    if (res.success) {
      await refreshPrompts();
      if (promptHistories[prompt.code]) {
        await loadPromptHistory(prompt);
      }
      toast.success("Prompt restaurado al default global");
    } else {
      toast.error(res.error || "Error al restaurar el prompt");
    }

    setPromptResettingCode(null);
  };

  const restorePromptVersion = async (prompt: SystemPrompt) => {
    setPromptRestoringId(prompt.id);
    const res = await restorePromptVersionAction(prompt.id);

    if (res.success && res.prompt) {
      await refreshPrompts();
      await loadPromptHistory(prompt);
      toast.success(`Version restaurada como v${res.prompt.version}`);
    } else {
      toast.error(res.error || "Error al restaurar version");
    }

    setPromptRestoringId(null);
  };

  const renderConfigSection = (setting: CurationConfig) => {
    const metadata = getMetadata(setting.setting_type);
    const phasePrompts = getPromptsForSetting(setting.setting_type, prompts);
    const isGreen = metadata.accent === "green";
    const modelOptions = getModelOptions(setting.setting_type);
    const reasoningOptions = getReasoningOptions(setting.setting_type);
    const accentText = isGreen ? "text-[#10B981]" : "text-[#00D4B3]";
    const accentBg = isGreen
      ? "bg-[#10B981]/10 text-[#10B981]"
      : "bg-[#00D4B3]/10 text-[#00D4B3]";

    return (
      <div
        key={setting.id}
        className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500"
      >
        <div className="flex items-center gap-2 mb-4">
          <div className={`p-2 rounded-lg ${accentBg}`}>{metadata.icon}</div>
          <h4 className="text-sm font-bold text-gray-500 dark:text-gray-300 uppercase tracking-wider">
            {metadata.title}
          </h4>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
          <PremiumSelect
            label="Modelo Principal"
            icon={<Zap size={12} className={accentText} />}
            value={setting.model_name ?? ""}
            onChange={(value) => handleUpdate(setting.id, "model_name", value)}
            options={modelOptions}
          />

          <PremiumSelect
            label="Modelo Fallback"
            icon={
              <span className="w-3 h-3 rounded-full border border-gray-400 dark:border-[#6C757D] flex items-center justify-center text-[8px] text-gray-400 dark:text-[#6C757D]">
                ?
              </span>
            }
            value={setting.fallback_model ?? ""}
            onChange={(value) =>
              handleUpdate(setting.id, "fallback_model", value)
            }
            options={modelOptions}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 relative z-0">
          <PremiumSelect
            label="Nivel de Pensamiento"
            icon={<BrainCircuit size={12} className="text-[#1F5AF6]" />}
            value={setting.thinking_level ?? "medium"}
            onChange={(value) =>
              handleUpdate(setting.id, "thinking_level", value)
            }
            options={reasoningOptions}
          />

          <div className="space-y-4">
            <div className="flex justify-between items-center">
              <label className="text-[10px] font-bold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
                Temperatura (Creatividad)
              </label>
              <span
                className={`text-xs font-mono font-bold px-2 py-0.5 rounded border ${
                  isGreen
                    ? "text-[#10B981] bg-[#10B981]/10 border-[#10B981]/20"
                    : "text-[#00D4B3] bg-[#00D4B3]/10 border-[#00D4B3]/20"
                }`}
              >
                {setting.temperature}
              </span>
            </div>
            <div className="relative pt-2">
              <input
                type="range"
                min="0.1"
                max="1.0"
                step="0.1"
                value={setting.temperature ?? 0.7}
                onChange={(event) =>
                  handleUpdate(
                    setting.id,
                    "temperature",
                    Number.parseFloat(event.target.value),
                  )
                }
                className={`w-full h-2 bg-gray-200 dark:bg-[#0A0D12] rounded-lg appearance-none cursor-pointer hover:opacity-100 relative z-20 ${
                  isGreen ? "accent-[#10B981]" : "accent-[#00D4B3]"
                }`}
              />
              <div className="absolute top-1/2 left-0 right-0 h-px bg-gray-300 dark:bg-[#1E2329] -translate-y-1/2 z-0" />
            </div>
            <div className="flex justify-between text-[10px] text-gray-400 dark:text-[#6C757D]">
              <span>Preciso (0.1)</span>
              <span>Creativo (1.0)</span>
            </div>
          </div>
        </div>

        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <MessageSquareCode size={15} className={accentText} />
            <h5 className="text-xs font-bold text-gray-500 dark:text-[#94A3B8] uppercase tracking-wider">
              Prompts de la fase
            </h5>
          </div>

          {phasePrompts.length > 0 ? (
            <div className="space-y-4">
              {phasePrompts.map((prompt) => (
                <PhasePromptEditor
                  key={`${prompt.code}-${prompt.version}-${prompt.id}`}
                  prompt={prompt}
                  history={promptHistories[prompt.code]}
                  historyLoading={promptHistoryLoadingCode === prompt.code}
                  saving={promptSavingId === prompt.id}
                  resetting={promptResettingCode === prompt.code}
                  restoringId={promptRestoringId}
                  onLoadHistory={loadPromptHistory}
                  onRestoreVersion={restorePromptVersion}
                  onSave={savePrompt}
                  onReset={resetPrompt}
                />
              ))}
            </div>
          ) : (
            <div className="border border-dashed border-gray-200 dark:border-[#6C757D]/20 rounded-xl p-4 text-sm text-gray-500 dark:text-[#94A3B8] bg-gray-50 dark:bg-[#0F1419]/40">
              No hay prompts configurables asociados a esta fase.
            </div>
          )}
        </div>

        {settingsList.indexOf(setting) < settingsList.length - 1 && (
          <div className="h-px bg-gray-100 dark:bg-[#6C757D]/10 mt-8 mb-8" />
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div className="p-8 flex justify-center text-[#00D4B3]">
        <Loader2 className="animate-spin" />
      </div>
    );
  }

  if (settingsList.length === 0) {
    return (
      <div className="p-12 text-center text-gray-500 dark:text-gray-400">
        <Settings2 className="mx-auto mb-4 opacity-50" size={48} />
        <p>No se encontraron configuraciones de modelos activas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-12">
      {settingsList.map((setting) => renderConfigSection(setting))}

      <div className="pt-4 flex justify-end border-t border-gray-100 dark:border-[#6C757D]/10 mt-6">
        <button
          onClick={saveSettings}
          disabled={saving}
          className="px-6 py-2.5 bg-[#0A2540] text-white hover:bg-[#0A2540]/90 dark:bg-[#00D4B3] dark:text-[#0A0D12] text-sm font-bold rounded-xl dark:hover:bg-[#00bda0] disabled:opacity-50 transition-all flex items-center gap-2 shadow-lg shadow-[#0A2540]/20 dark:shadow-[#00D4B3]/20"
        >
          {saving ? (
            <Loader2 size={16} className="animate-spin" />
          ) : (
            <Save size={16} />
          )}
          Guardar Configuracion
        </button>
      </div>
    </div>
  );
}
