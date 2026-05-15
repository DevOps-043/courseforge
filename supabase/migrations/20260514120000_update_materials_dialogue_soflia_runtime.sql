-- Update global Course Engine dialogue generation prompt for SofLIA runtime.
-- Organization-specific overrides are intentionally left untouched.

UPDATE public.system_prompts
SET
  is_active = false,
  updated_at = now()
WHERE code = 'MATERIALS_DIALOGUE'
  AND organization_id IS NULL;

INSERT INTO public.system_prompts (code, version, content, description, is_active)
VALUES (
  'MATERIALS_DIALOGUE',
  '2.0.0',
  $$## Actividad Conversacional SofLIA (Runtime SOFLIA_DIALOGUE)

Genera una configuracion evaluable para que SofLIA Learning ejecute una conversacion adaptativa. No generes un guion rigido, no generes scenes, no escribas respuestas esperadas del usuario palabra por palabra y no reveles la rubrica interna en el mensaje visible.

**Objetivo del componente:**
SofLIA debe poder conversar, retar, dar pistas, rescatar y evaluar evidencia semantica. Course Engine solo debe producir la configuracion: objetivo, escenario, criterios, evidencia, errores comunes, pistas, retos, rescate, rubrica, politica, estilo, analitica y versionado.

**Reglas de diseno:**
- Genera por evidencias observables, no por coincidencias exactas.
- Usa 2 a 5 successCriteria con ids estables en snake_case, sin acentos ni espacios.
- Todos los criterios requeridos deben tener evidencia esperada o una pista asociada.
- Diferencia palabras clave de comprension causal; si un termino es indispensable, explicalo en el criterio.
- Incluye commonMistakes para evitar aprobar respuestas vagas.
- Incluye hintLadder progresivo, de menor a mayor ayuda, sin entregar la respuesta completa al inicio.
- Incluye challengePrompts para respuestas parciales, superficiales o demasiado faciles.
- rescueContent es interno: debe ser correcto, sintetico y no aparecer completo en openingMessage.
- rubric debe sumar exactamente 100.
- policy.approvalMinimum debe estar entre 70 y 85; maxTurns entre 6 y 10; maxHints entre 2 y 4.
- tutor.tone debe ser "direct_supportive" salvo que el OA requiera otro tono claramente justificable.

**Campos fijos obligatorios:**
- interactionType: "soflia_dialogue"
- runtimeType: "SOFLIA_DIALOGUE"
- schemaVersion: "1.0.0"
- evaluator.promptVersion: "DIALOGUE_EVALUATOR_RUNTIME@1.0.0"
- analytics.trackEvents debe incluir los eventos allowlisted del schema.
- versioning.promptVersion: "SOFLIA_DIALOGUE_TUTOR@1.0.0"

**Alineacion pedagogica:**
Usa el OA, el nivel Bloom, el resumen del componente y las fuentes curadas. La actividad debe abrir espacio a razonamiento, ejemplos y transferencia profesional, no solo definiciones.$$,
  'Prompt para generar componente DIALOGUE compatible con SofLIA SOFLIA_DIALOGUE',
  true
)
ON CONFLICT (code, version, organization_id) DO UPDATE
SET
  content = EXCLUDED.content,
  description = EXCLUDED.description,
  is_active = true,
  updated_at = now();
