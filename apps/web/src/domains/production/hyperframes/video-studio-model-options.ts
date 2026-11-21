import { isOpenAiReasoningModel } from "../../../shared/ai/text-model-provider";

export type VideoStudioModelProvider = "openai";

export interface VideoStudioModelOption {
  description: string;
  label: string;
  provider: VideoStudioModelProvider;
  value: string;
}

/**
 * Catálogo compartido con Configuración por fase, limitado a modelos de texto.
 * Los modelos de imagen no se exponen porque el asistente devuelve propuestas JSON.
 */
export const VIDEO_STUDIO_MODEL_OPTIONS: readonly VideoStudioModelOption[] = [
  { value: "gpt-6.1-terra", label: "GPT-6.1 Terra", provider: "openai", description: "Redacción y razonamiento visual." },
  { value: "gpt-6.2-sol", label: "GPT-6.2 Sol", provider: "openai", description: "Razonamiento para flujos de varios pasos." },
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol", provider: "openai", description: "Máxima calidad y capacidad analítica." },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna", provider: "openai", description: "Alta capacidad con costo eficiente." },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra", provider: "openai", description: "Balance entre calidad y costo." },
  { value: "gpt-5.5", label: "GPT-5.5", provider: "openai", description: "Frontier con menor costo que GPT-5.6." },
  { value: "gpt-5.5-pro", label: "GPT-5.5 Pro", provider: "openai", description: "Mayor precisión para ajustes difíciles." },
  { value: "gpt-5.4", label: "GPT-5.4", provider: "openai", description: "Modelo profesional y económico." },
  { value: "gpt-5.4-pro", label: "GPT-5.4 Pro", provider: "openai", description: "Mayor calidad para trabajos difíciles." },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini", provider: "openai", description: "Rápido para alto volumen." },
  { value: "gpt-5.4-nano", label: "GPT-5.4 nano", provider: "openai", description: "Menor costo para tareas simples." },
  { value: "gpt-4o", label: "GPT-4o (OpenAI)", provider: "openai", description: "Modelo multimodal de alta capacidad." },
  { value: "gpt-4o-mini", label: "GPT-4o Mini (OpenAI)", provider: "openai", description: "Rápido y costo-eficiente." },
  { value: "gpt-4.1-mini", label: "GPT-4.1 mini", provider: "openai", description: "Rápido para propuestas estructuradas." },
  { value: "o3-mini", label: "o3-mini (OpenAI)", provider: "openai", description: "Razonamiento lógico y código." },
  { value: "o1", label: "o1 (OpenAI)", provider: "openai", description: "Razonamiento avanzado para cambios complejos." },
  { value: "gpt-4-turbo", label: "GPT-4 Turbo (OpenAI)", provider: "openai", description: "Modelo GPT-4 analítico tradicional." },
];

export const VIDEO_STUDIO_MODEL_IDS = VIDEO_STUDIO_MODEL_OPTIONS.map((option) => option.value) as [string, ...string[]];

export function getVideoStudioModelProvider(model: string): VideoStudioModelProvider | null {
  return VIDEO_STUDIO_MODEL_OPTIONS.find((option) => option.value === model)?.provider || null;
}

export function isVideoStudioReasoningModel(model: string) {
  return isOpenAiReasoningModel(model);
}
