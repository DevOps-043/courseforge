import type { CompositionPreviewLoadErrorCode } from "./composition-preview-protocol";

export type CompositionPreviewLoadErrorAction = "LOGIN" | "RELOAD_EDITOR" | "RETRY_PREVIEW" | "NONE";

interface CompositionPreviewLoadErrorPresentation {
  action: CompositionPreviewLoadErrorAction;
  actionLabel: string | null;
  message: string;
}

const PRESENTATIONS: Record<CompositionPreviewLoadErrorCode, CompositionPreviewLoadErrorPresentation> = {
  ACCESS_DENIED: {
    action: "NONE",
    actionLabel: null,
    message: "No tienes acceso a este preview en la empresa activa. Solicita permisos al administrador.",
  },
  AUTH_REQUIRED: {
    action: "LOGIN",
    actionLabel: "Iniciar sesión",
    message: "Tu sesión expiró. Inicia sesión para volver a cargar el preview.",
  },
  COMPILATION_FAILED: {
    action: "RETRY_PREVIEW",
    actionLabel: "Reintentar preview",
    message: "No se pudo compilar el preview de esta versión. Reintenta cargarlo.",
  },
  DEPENDENCY_FAILED: {
    action: "RETRY_PREVIEW",
    actionLabel: "Reintentar preview",
    message: "No se pudieron preparar los recursos del preview. Reintenta cargarlo.",
  },
  DOCUMENT_UNAVAILABLE: {
    action: "RELOAD_EDITOR",
    actionLabel: "Recargar editor",
    message: "La versión guardada del preview ya no está disponible. Recarga el editor.",
  },
  UNKNOWN: {
    action: "RETRY_PREVIEW",
    actionLabel: "Reintentar preview",
    message: "No se pudo preparar el preview. Reintenta cargarlo.",
  },
};

export function resolveCompositionPreviewLoadErrorPresentation(code: CompositionPreviewLoadErrorCode | null) {
  return code ? PRESENTATIONS[code] : null;
}
