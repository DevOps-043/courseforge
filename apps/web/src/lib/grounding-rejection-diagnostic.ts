const REJECTIONS = {
  UNSUPPORTED_OUTPUT: "La revisión detectó contenido sin respaldo suficiente en las fuentes.",
  SOURCE_NOT_IN_CONTEXT: "La revisión citó una fuente ajena al contexto de generación.",
  QUOTE_NOT_IN_SOURCE: "Una cita de la revisión no coincide literalmente con la fuente.",
  CLAIM_NOT_IN_OUTPUT: "La revisión citó una afirmación que no coincide con el componente.",
} as const;

/** Solo códigos conocidos y texto fijo: jamás copiar citas ni explicación libre del auditor. */
export function groundingRejectionDiagnostic(reason: unknown) {
  if (typeof reason !== "string" || !Object.hasOwn(REJECTIONS, reason)) return null;
  const code = reason as keyof typeof REJECTIONS;
  return { code, message: REJECTIONS[code] };
}
