export class TenantContextLookupError extends Error {
  readonly code = "TENANT_LOOKUP_UNAVAILABLE";
  readonly retryable = true;

  constructor() {
    super("No se pudo verificar temporalmente la empresa y sus permisos. Intenta de nuevo.");
    this.name = "TenantContextLookupError";
  }
}
