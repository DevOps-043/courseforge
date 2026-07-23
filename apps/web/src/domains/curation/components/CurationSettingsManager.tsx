"use client";

import { useEffect, useState } from "react";
import {
  Box,
  BrainCircuit,
  CheckCircle2,
  Loader2,
  Save,
  Search,
  Settings2,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import { PremiumSelect } from "@/shared/components/PremiumSelect";
import {
  getModelSettingsAction,
  updateModelSettingsAction,
} from "@/app/admin/settings/actions";
import type { ModelSettingsRecord } from "@/app/admin/settings/actions";

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

const GEMINI_MODEL_OPTIONS = [
  {
    value: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Frontier estable",
  },
  {
    value: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro Preview",
    description: "Razonamiento avanzado",
  },
  {
    value: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    description: "Alta eficiencia",
  },
  {
    value: "gemini-3-flash-preview",
    label: "Gemini 3 Flash Preview",
    description: "Preview veloz",
  },
  {
    value: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Razonamiento avanzado",
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Balance costo/velocidad",
  },
  {
    value: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    description: "Alta escala / economico",
  },
  {
    value: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    description: "Rapido y estable",
  },
];

const OPENAI_CURATION_MODEL_OPTIONS = [
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
    value: "gpt-5.6-sol",
    label: "GPT-5.6 Sol",
    description: "Maxima calidad",
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

function getModelOptions(settingType: string) {
  return settingType === "CURATION"
    ? OPENAI_CURATION_MODEL_OPTIONS
    : GEMINI_MODEL_OPTIONS;
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

export function CurationSettingsManager() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsList, setSettingsList] = useState<CurationConfig[]>([]);

  useEffect(() => {
    async function loadSettings() {
      const res = await getModelSettingsAction();

      if (res.success && res.settings) {
        const filtered = res.settings.filter(
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
        console.error("Error loading settings:", res.error);
        toast.error("Error al cargar la configuracion de modelos");
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

  const renderConfigSection = (setting: CurationConfig) => {
    const metadata = getMetadata(setting.setting_type);
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
