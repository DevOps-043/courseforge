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
