export type ModelJsonResponseErrorCode =
  | "EMPTY_MODEL_RESPONSE"
  | "INVALID_MODEL_JSON"
  | "TRUNCATED_MODEL_JSON";

export class ModelJsonResponseError extends Error {
  constructor(
    readonly code: ModelJsonResponseErrorCode,
    message: string,
  ) {
    super(`${code}: ${message}`);
    this.name = "ModelJsonResponseError";
  }
}

export function parseModelJsonResponse<Output>(params: {
  finishReason?: string | null;
  responseText?: string | null;
}): Output {
  const finishReason = params.finishReason?.trim().toUpperCase();
  if (finishReason === "MAX_TOKENS") {
    throw new ModelJsonResponseError(
      "TRUNCATED_MODEL_JSON",
      "El proveedor alcanzo el limite de salida antes de completar el JSON.",
    );
  }

  const responseText = stripJsonCodeFence(params.responseText || "");
  if (!responseText) {
    throw new ModelJsonResponseError(
      "EMPTY_MODEL_RESPONSE",
      "El proveedor no devolvio contenido.",
    );
  }

  try {
    return JSON.parse(responseText) as Output;
  } catch (error) {
    const detail = error instanceof Error ? error.message : "JSON invalido";
    throw new ModelJsonResponseError(
      "INVALID_MODEL_JSON",
      `El proveedor devolvio JSON incompleto o mal escapado. ${detail}`,
    );
  }
}

function stripJsonCodeFence(value: string) {
  const trimmed = value.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return (fencedMatch?.[1] || trimmed).trim();
}
