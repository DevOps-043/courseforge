export const SOFLIA_USER_SELECT =
  "id, email, username, first_name, last_name, display_name, profile_picture_url, platform_role, is_banned";

export type SofliaAuthFailureCode =
  | "AUTH_EMAIL_NOT_CONFIRMED"
  | "AUTH_RATE_LIMITED"
  | "AUTH_SERVICE_ERROR"
  | "AUTH_USER_ID_MISMATCH"
  | "INVALID_CREDENTIALS"
  | "MISSING_AUTH_USER"
  | "MISSING_EMAIL";

export interface SofliaAuthFailure {
  code: SofliaAuthFailureCode;
  message: string;
}

interface SupabasePasswordAuthUser {
  id: string;
}

interface SupabasePasswordAuthResult {
  data?: {
    user?: SupabasePasswordAuthUser | null;
  } | null;
  error?: {
    message?: string;
    status?: number;
  } | null;
}

export interface SupabasePasswordAuthClient {
  auth: {
    signInWithPassword(credentials: {
      email: string;
      password: string;
    }): Promise<SupabasePasswordAuthResult>;
  };
}

export function mapSofliaAuthFailure(reason: string): SofliaAuthFailure {
  const normalized = reason.toLowerCase();

  if (
    normalized.includes("invalid login credentials") ||
    normalized.includes("invalid_credentials")
  ) {
    return {
      code: "INVALID_CREDENTIALS",
      message: "Credenciales invalidas",
    };
  }

  if (
    normalized.includes("rate limit") ||
    normalized.includes("too many requests") ||
    normalized.includes("over_request_rate_limit")
  ) {
    return {
      code: "AUTH_RATE_LIMITED",
      message:
        "Demasiados intentos de inicio de sesion. Espera unos minutos e intenta de nuevo.",
    };
  }

  if (normalized.includes("email not confirmed")) {
    return {
      code: "AUTH_EMAIL_NOT_CONFIRMED",
      message:
        "Tu correo aun no esta confirmado. Revisa tu bandeja de entrada para activarlo.",
    };
  }

  if (normalized.includes("auth_user_not_found")) {
    return {
      code: "MISSING_AUTH_USER",
      message:
        "Error en la configuracion de la cuenta. Por favor, contacta al soporte.",
    };
  }

  return {
    code: "AUTH_SERVICE_ERROR",
    message:
      "No se pudo iniciar sesion en este momento. Por favor, intenta de nuevo en unos minutos.",
  };
}

export async function authenticateSofliaPassword(input: {
  authClient: SupabasePasswordAuthClient;
  email: string | null;
  expectedUserId: string;
  password: string;
}): Promise<{ success: true } | { failure: SofliaAuthFailure; success: false }> {
  if (!input.email) {
    return {
      failure: {
        code: "MISSING_EMAIL",
        message:
          "Tu cuenta no tiene un correo asociado. Por favor, contacta al soporte.",
      },
      success: false,
    };
  }

  const { data, error } = await input.authClient.auth.signInWithPassword({
    email: input.email,
    password: input.password,
  });

  if (error || !data?.user) {
    return {
      failure: mapSofliaAuthFailure(error?.message || "AUTH_SIGNIN_FAILED"),
      success: false,
    };
  }

  if (data.user.id !== input.expectedUserId) {
    return {
      failure: {
        code: "AUTH_USER_ID_MISMATCH",
        message:
          "Error en la configuracion de la cuenta. Por favor, contacta al soporte.",
      },
      success: false,
    };
  }

  return { success: true };
}
