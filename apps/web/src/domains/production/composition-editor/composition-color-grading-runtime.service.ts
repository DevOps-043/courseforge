import { createHash } from "node:crypto";

export const COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT = {
  name: "hyperframes-color-grading-runtime",
  version: 1,
} as const;

export const COMPOSITION_COLOR_GRADING_RUNTIME_ARTIFACT =
  "hyperframe.color-grading.runtime.iife.js";

export const COMPOSITION_COLOR_GRADING_RUNTIME_MAX_BYTES = 160 * 1024;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCompositionColorGradingRuntimeArtifact(params: {
  manifestRaw: string;
  source: string;
}): { bytes: number; sha256: string; source: string } {
  const bytes = Buffer.byteLength(params.source, "utf8");
  if (bytes === 0) throw new Error("El runtime de color está vacío.");
  if (bytes > COMPOSITION_COLOR_GRADING_RUNTIME_MAX_BYTES) {
    throw new Error(
      `El runtime de color excede el presupuesto de ${COMPOSITION_COLOR_GRADING_RUNTIME_MAX_BYTES} bytes.`,
    );
  }

  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(params.manifestRaw);
  } catch {
    throw new Error("El manifiesto de HyperFrames no es JSON válido.");
  }
  if (!isRecord(manifestValue) || !isRecord(manifestValue.colorGrading)) {
    throw new Error("El manifiesto no declara el runtime de corrección de color.");
  }
  const colorGrading = manifestValue.colorGrading;
  const contract = isRecord(colorGrading.contract) ? colorGrading.contract : null;
  if (
    contract?.name !== COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT.name ||
    contract.version !== COMPOSITION_COLOR_GRADING_RUNTIME_CONTRACT.version
  ) {
    throw new Error("El contrato del runtime de color no es compatible con Courseforge.");
  }
  const artifacts = isRecord(colorGrading.artifacts) ? colorGrading.artifacts : null;
  if (artifacts?.iife !== COMPOSITION_COLOR_GRADING_RUNTIME_ARTIFACT) {
    throw new Error("El manifiesto apunta a un artefacto de color inesperado.");
  }
  const hashes = isRecord(colorGrading.sha256) ? colorGrading.sha256 : null;
  const sha256 = createHash("sha256").update(params.source, "utf8").digest("hex");
  if (hashes?.iife !== sha256) {
    throw new Error("El hash del runtime de color no coincide con el manifiesto.");
  }
  const declaredBytes = isRecord(colorGrading.bytes) ? colorGrading.bytes.iife : null;
  if (declaredBytes !== bytes) {
    throw new Error("El tamaño del runtime de color no coincide con el manifiesto.");
  }
  return { bytes, sha256, source: params.source };
}
