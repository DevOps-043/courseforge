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

export function buildResolutionRejectionHint(
  resolution: HeygenAvatarVideoResolution,
  providerError?: { message?: string; providerCode?: string },
) {
  const providerText = `${providerError?.providerCode || ""} ${providerError?.message || ""}`
    .toLowerCase();
  const isResolutionRejection = [
    "resolution",
    "1080",
    "4k",
    "upgrade",
    "subscription",
    "plan",
  ].some((token) => providerText.includes(token));

  if (resolution !== "720p" && isResolutionRejection) {
    return `HeyGen indico una restriccion de resolucion o plan. Prueba con 720p o valida que la cuenta pueda exportar en ${resolution}.`;
  }

  return "Revisa que el avatar, la voz y el guion sean validos para la cuenta configurada.";
}
