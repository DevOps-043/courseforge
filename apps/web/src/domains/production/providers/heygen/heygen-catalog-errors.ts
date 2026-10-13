export type HeygenCatalogSyncStage =
  | "provider_catalog"
  | "normalize_catalog"
  | "reconcile_catalog"
  | "read_presets"
  | "select_defaults";

const STAGE_LABELS: Record<HeygenCatalogSyncStage, string> = {
  provider_catalog: "consultar el catálogo de HeyGen",
  normalize_catalog: "validar el catálogo de HeyGen",
  reconcile_catalog: "guardar el catálogo en Supabase",
  read_presets: "leer los presets sincronizados",
  select_defaults: "seleccionar los presets predeterminados",
};

export class HeygenCatalogSyncFailureError extends Error {
  readonly code: string | null;
  readonly stage: HeygenCatalogSyncStage;

  constructor(failure: ReturnType<typeof describeHeygenCatalogSyncFailure>) {
    super(failure.message);
    this.name = "HeygenCatalogSyncFailureError";
    this.code = failure.code;
    this.stage = failure.stage;
  }
}

/** Persist only an actionable summary and code, never SQL details or row values. */
export function describeHeygenCatalogSyncFailure(error: unknown, stage: HeygenCatalogSyncStage) {
  const candidate = error && typeof error === "object" && "code" in error
    ? error.code
    : undefined;
  const providerCode = error && typeof error === "object" && "providerCode" in error
    ? error.providerCode
    : undefined;
  const rawCode = candidate || providerCode;
  const code = typeof rawCode === "string" && /^[A-Z0-9_]{1,64}$/i.test(rawCode)
    ? rawCode
    : null;
  let reason = "Revisa el registro de la ejecución antes de reintentar.";
  if (code === "42883" || code === "PGRST202") {
    reason = "Falta una función de base de datos requerida. Aplica las migraciones de HeyGen pendientes.";
  } else if (code === "42501") {
    reason = "La conexión no tiene permisos para completar esta operación.";
  } else if (code === "23505") {
    reason = "Hay un conflicto de unicidad en el catálogo.";
  } else if (code === "23514") {
    reason = "El catálogo no cumple una restricción de base de datos.";
  }
  return {
    code,
    message: `No se pudo ${STAGE_LABELS[stage]}${code ? ` (${code})` : ""}. ${reason}`,
    stage,
  };
}
