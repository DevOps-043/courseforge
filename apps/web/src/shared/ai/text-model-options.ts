// Catálogo compartido de modelos de texto para la configuración del pipeline.
export const TEXT_MODEL_OPTIONS = [
  // Modelos Google Gemini vigentes
  {
    value: "gemini-3.6-flash",
    label: "Gemini 3.6 Flash",
    description: "Modelo Flash actual para tareas agenticas y multimodales",
  },
  {
    value: "gemini-3.5-flash",
    label: "Gemini 3.5 Flash",
    description: "Alto rendimiento sostenido para tareas agenticas y de codigo",
  },
  {
    value: "gemini-3.5-flash-lite",
    label: "Gemini 3.5 Flash-Lite",
    description: "Opcion actual de alto volumen y menor costo",
  },
  {
    value: "gemini-3.1-flash-lite",
    label: "Gemini 3.1 Flash-Lite",
    description: "Modelo estable y eficiente para ejecucion de alto volumen",
  },
  {
    value: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro (Preview)",
    description: "Razonamiento multimodal avanzado; usar con cautela por ser preview",
  },
  {
    value: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    description: "Opcion vigente con buen balance de razonamiento, latencia y costo",
  },
  {
    value: "gemini-2.5-flash-lite",
    label: "Gemini 2.5 Flash-Lite",
    description: "Modelo vigente, rapido y economico para alto volumen",
  },
  {
    value: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    description: "Modelo vigente para razonamiento y tareas complejas",
  },
  {
    value: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    description: "Modelo OpenAI para redacción y razonamiento visual",
  },
  {
    value: "gpt-6.2-sol",
    label: "GPT-6.2 Sol",
    description: "Modelo OpenAI para flujos de varios pasos",
  },
  // Modelos de la familia GPT-5
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
