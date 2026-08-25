import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Credentials are scoped to a production capability, not to the vendor name.
 * HeyGen currently powers both capabilities, but they can be rotated and
 * authorized independently without coupling avatar generation to assembly.
 */
export type ProductionCredentialProvider = "heygen_avatar" | "hyperframes_cloud";
export type ProductionCredentialStatus = "ACTIVE" | "REVOKED";
export type ProductionCredentialValidationStatus =
  | "NEVER_VALIDATED"
  | "VALID"
  | "INVALID";

export interface ProductionProviderCredentialRow {
  encrypted_secret?: string | null;
  id: string;
  last_validated_at?: string | null;
  last_validation_error?: string | null;
  metadata?: Record<string, unknown> | null;
  organization_id: string;
  provider: ProductionCredentialProvider;
  secret_last4?: string | null;
  status: ProductionCredentialStatus;
  validation_status: ProductionCredentialValidationStatus;
}

export interface ProductionProviderCredentialStatus {
  connected: boolean;
  last4: string | null;
  lastValidatedAt: string | null;
  lastValidationError: string | null;
  provider: ProductionCredentialProvider;
  status: ProductionCredentialStatus | null;
  validationStatus: ProductionCredentialValidationStatus | null;
}

export type ProductionProviderCredentialsSupabaseClient = SupabaseClient<
  any,
  "public",
  any
>;
