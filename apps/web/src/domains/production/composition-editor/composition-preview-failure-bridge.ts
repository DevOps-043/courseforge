import {
  COMPOSITION_PREVIEW_PROTOCOL_VERSION,
  compositionPreviewLoadErrorCodeSchema,
  type CompositionPreviewLoadErrorCode,
} from "./composition-preview-protocol";
import { COMPOSITION_PREVIEW_MAX_GENERATION, isCompositionDocumentHash } from "./composition-preview-comparison";

/** Minimal iframe document that reports a fixed error code without exposing server details. */
export function buildCompositionPreviewFailureBridge(input: {
  code: CompositionPreviewLoadErrorCode;
  documentHash: string;
  nonce: string;
  previewGeneration: number;
}) {
  if (!compositionPreviewLoadErrorCodeSchema.safeParse(input.code).success
    || !isCompositionDocumentHash(input.documentHash)
    || !/^[a-f0-9-]{36}$/i.test(input.nonce)
    || !Number.isInteger(input.previewGeneration)
    || input.previewGeneration < 0
    || input.previewGeneration > COMPOSITION_PREVIEW_MAX_GENERATION) {
    throw new Error("Invalid preview failure bridge input.");
  }
  const message = {
    code: input.code,
    documentHash: input.documentHash.toLowerCase(),
    protocolVersion: COMPOSITION_PREVIEW_PROTOCOL_VERSION,
    previewGeneration: input.previewGeneration,
    type: "courseforge-composition-load-error",
  };
  const html = `<!doctype html><html lang="es"><meta charset="utf-8"><body><p>No se pudo cargar el preview.</p><script nonce="${input.nonce}">window.parent.postMessage(${JSON.stringify(message)}, "*");</script></body></html>`;
  return {
    contentSecurityPolicy: `default-src 'none'; script-src 'nonce-${input.nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'`,
    html,
  };
}
