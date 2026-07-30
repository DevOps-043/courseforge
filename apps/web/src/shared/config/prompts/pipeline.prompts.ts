export const ARTIFACT_BASE_RESEARCH_PROMPT_CODE = "ARTIFACT_BASE_RESEARCH";
export const ARTIFACT_BASE_PROMPT_CODE = "ARTIFACT_BASE";
export const SYLLABUS_RESEARCH_PROMPT_CODE = "SYLLABUS_RESEARCH";
export const SYLLABUS_PROMPT_CODE = "SYLLABUS";
export const CURATION_PROMPT_CODE = "CURATION";

export const artifactBaseResearchPromptDefault = `Investiga tendencias educativas recientes sobre:
TEMA: {{courseTitle}}
DESCRIPCION: {{courseDescription}}

Encuentra herramientas, estadisticas, obsolescencias, buenas practicas y cambios relevantes para disenar un curso actual.
{{feedbackBlock}}`;

export const artifactBasePromptDefault = `Eres un disenador instruccional experto y copywriter senior.

CONTEXTO RESEARCH:
{{researchContext}}

{{feedbackBlock}}

Tu tarea es DEFINIR LA BASE para el curso: "{{courseTitle}}".
Input del usuario: "{{courseDescription}}".

Genera:
1. 3 nombres atractivos (Hook + Promesa).
2. Entre 3 y 5 objetivos de aprendizaje claros. Deben iniciar con verbos Bloom: {{bloomVerbs}}. No generes mas de 6.
3. Descripcion vendedora y perfilamiento.

No generes temario ni modulos aun. Solo la definicion estrategica.`;

export const syllabusResearchPromptDefault = `Investiga en profundidad sobre el tema: "{{ideaCentral}}".

Objetivos del curso:
{{objetivos}}

Identifica:
1. Tendencias actuales del mercado para este tema.
2. Conceptos clave obligatorios.
3. Estructura logica recomendada.

Dame un resumen denso y tecnico.`;

export const curationPromptDefault =
  "Eres un investigador educativo. Busca candidatos reales y accesibles. No declares una fuente valida: Courseforge la validara. Evita redes sociales, foros, paywalls y URLs inventadas.";

export function renderPromptTemplate(
  template: string,
  variables: Record<string, string | number | null | undefined>,
) {
  return Object.entries(variables).reduce((rendered, [key, value]) => {
    const safeValue = value == null ? "" : String(value);
    return rendered
      .replaceAll(`{{${key}}}`, safeValue)
      .replaceAll(`\${${key}}`, safeValue);
  }, template);
}
