import type { VideoDurationPolicy } from "../../video-duration/video-duration-policy";

export function buildInstructionalPlanVideoDurationInstructions(policy: VideoDurationPolicy) {
  return `POLÍTICA DE VIDEO OBLIGATORIA PARA ESTA GENERACIÓN:
Objetivo por video: ${policy.targetDurationSeconds} segundos (${policy.targetDurationSeconds / 60} minutos).
Rango permitido: ${policy.minimumDurationSeconds}–${policy.maximumDurationSeconds} segundos.
Esta política prevalece sobre los ejemplos de duración del prompt configurable.
Los summaries y production_notes deben ser coherentes con este objetivo; no describas videos más largos que el contrato.
Planifica contenido sustantivo que quepa en ese tiempo, sin inflar la duración con repeticiones.`;
}

export function buildInstructionalPlanContextPrompt(params: {
  configuredPrompt: string;
  customPrompt?: string;
  iterationInstructions?: string;
  useCustomPrompt?: boolean;
}) {
  const {
    configuredPrompt,
    customPrompt,
    iterationInstructions,
    useCustomPrompt,
  } = params;

  const basePrompt =
    useCustomPrompt && customPrompt?.trim()
      ? customPrompt.trim()
      : configuredPrompt;

  if (!iterationInstructions?.trim()) {
    return basePrompt;
  }

  return `${basePrompt}\n\nRETROALIMENTACION PARA ESTA ITERACION:\n${iterationInstructions.trim()}\nRegenera el plan completo aplicando esta retroalimentacion.`;
}
