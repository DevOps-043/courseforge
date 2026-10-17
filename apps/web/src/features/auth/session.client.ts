import { authSessionResponseSchema, type AuthSessionUser } from "./session.contract";

const SESSION_REQUEST_TIMEOUT_MS = 10_000;
export const AUTH_SESSION_LOAD_ERROR = "No se pudo comprobar la sesión. Vuelve a intentarlo.";

export async function loadAuthSessionUser(request: typeof fetch = fetch): Promise<AuthSessionUser | null> {
  const response = await request("/api/auth/session", {
    cache: "no-store", credentials: "same-origin",
    signal: AbortSignal.timeout(SESSION_REQUEST_TIMEOUT_MS),
  });
  if (response.status === 401) return null;
  if (!response.ok) throw new Error(AUTH_SESSION_LOAD_ERROR);
  const result = authSessionResponseSchema.safeParse(await response.json());
  if (!result.success) throw new Error(AUTH_SESSION_LOAD_ERROR);
  return result.data.user;
}
