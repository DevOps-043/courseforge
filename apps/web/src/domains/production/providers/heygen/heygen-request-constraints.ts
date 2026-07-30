import type { HeygenAvatarVideoResolution } from "./heygen.types";

export const HEYGEN_MAX_TEXT_INPUT_CHARACTERS = 5000;

export class HeygenRequestValidationError extends Error {
  readonly status: number;

  constructor(message: string, status = 422) {
    super(message);
    this.name = "HeygenRequestValidationError";
    this.status = status;
  }
}

export function assertHeygenTextInputWithinLimits(params: {
  label: string;
  text: string;
}) {
  const length = params.text.trim().length;
  if (length <= HEYGEN_MAX_TEXT_INPUT_CHARACTERS) {
    return;
  }

  throw new HeygenRequestValidationError(
    `${params.label} tiene ${length} caracteres. HeyGen acepta maximo ${HEYGEN_MAX_TEXT_INPUT_CHARACTERS} caracteres por video; divide el guion en escenas mas pequenas o usa menos texto.`,
  );
}

export function buildResolutionRejectionHint(resolution: HeygenAvatarVideoResolution) {
  if (resolution === "720p") {
    return "HeyGen rechazo la solicitud. Revisa que el avatar, voz y guion sean validos para la cuenta configurada.";
  }

  return `HeyGen rechazo la solicitud. Si el mensaje menciona resolucion o plan, prueba con 720p o valida que la cuenta tenga permiso para exportar en ${resolution}.`;
}
