export class AuthIdentityLookupError extends Error {
  readonly code = "AUTH_LOOKUP_UNAVAILABLE";
  readonly retryable = true;

  constructor() {
    super("No se pudo verificar temporalmente la identidad. Intenta de nuevo.");
    this.name = "AuthIdentityLookupError";
  }
}
