export type VideoStudioModelProvider = "gemini" | "openai";

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
  { value: "gemini-3.6-flash", label: "Gemini 3.6 Flash", provider: "gemini", description: "Tareas agénticas y multimodales." },
  { value: "gemini-3.5-flash", label: "Gemini 3.5 Flash", provider: "gemini", description: "Rendimiento sostenido para edición y código." },
  { value: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", provider: "gemini", description: "Alto volumen y menor costo." },
  { value: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", provider: "gemini", description: "Estable y eficiente para alto volumen." },
  { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro (Preview)", provider: "gemini", description: "Razonamiento multimodal avanzado; versión preview." },
  { value: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "gemini", description: "Balance de razonamiento, latencia y costo." },
  { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash-Lite", provider: "gemini", description: "Rápido y económico para alto volumen." },
  { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro", provider: "gemini", description: "Razonamiento y ajustes complejos." },
  { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "gemini", description: "Opción compatible con configuraciones anteriores." },
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
  return /^(?:o\d|gpt-5)/i.test(model.trim());
}
