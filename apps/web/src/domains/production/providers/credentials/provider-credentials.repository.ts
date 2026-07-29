import type {
  ProductionCredentialProvider,
  ProductionProviderCredentialRow,
  ProductionProviderCredentialsSupabaseClient,
} from "./provider-credentials.types";

export class ProductionProviderCredentialsRepository {
  constructor(
    private readonly supabase: ProductionProviderCredentialsSupabaseClient,
  ) {}

  async getActiveCredentialMetadata(params: {
    organizationId: string;
    provider: ProductionCredentialProvider;
  }) {
    const { data, error } = await this.supabase
      .from("production_provider_credentials")
      .select(
        [
          "id",
          "organization_id",
          "provider",
          "secret_last4",
          "status",
          "validation_status",
          "last_validated_at",
          "last_validation_error",
          "metadata",
        ].join(", "),
      )
      .eq("organization_id", params.organizationId)
      .eq("provider", params.provider)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (error) throw error;
    return (data || null) as ProductionProviderCredentialRow | null;
  }

  async getActiveEncryptedSecret(params: {
    organizationId: string;
    provider: ProductionCredentialProvider;
  }) {
    const { data, error } = await this.supabase
      .from("production_provider_credentials")
      .select("id, encrypted_secret, secret_last4, validation_status")
      .eq("organization_id", params.organizationId)
      .eq("provider", params.provider)
      .eq("status", "ACTIVE")
      .maybeSingle();

    if (error) throw error;
    return (data || null) as ProductionProviderCredentialRow | null;
  }

  async upsertActiveCredential(params: {
    createdBy: string;
    encryptedSecret: string;
    last4: string;
    metadata?: Record<string, unknown>;
    organizationId: string;
    provider: ProductionCredentialProvider;
    validatedAt: string;
  }) {
    const now = new Date().toISOString();
    await this.revokeActiveCredential({
      organizationId: params.organizationId,
      provider: params.provider,
      revokedAt: now,
    });

    const { data, error } = await this.supabase
      .from("production_provider_credentials")
      .insert({
        created_by: params.createdBy,
        encrypted_secret: params.encryptedSecret,
        last_validated_at: params.validatedAt,
        last_validation_error: null,
        metadata: params.metadata || {},
        organization_id: params.organizationId,
        provider: params.provider,
        secret_last4: params.last4,
        status: "ACTIVE",
        updated_at: now,
        validation_status: "VALID",
      })
      .select(
        "id, organization_id, provider, secret_last4, status, validation_status, last_validated_at, last_validation_error, metadata",
      )
      .single();

    if (error) throw error;
    return data as ProductionProviderCredentialRow;
  }

  async markCredentialValidationFailed(params: {
    errorMessage: string;
    organizationId: string;
    provider: ProductionCredentialProvider;
  }) {
    const { error } = await this.supabase
      .from("production_provider_credentials")
      .update({
        last_validation_error: params.errorMessage.slice(0, 500),
        updated_at: new Date().toISOString(),
        validation_status: "INVALID",
      })
      .eq("organization_id", params.organizationId)
      .eq("provider", params.provider)
      .eq("status", "ACTIVE");

    if (error) throw error;
  }

  async markCredentialValidationSucceeded(params: {
    metadata?: Record<string, unknown>;
    organizationId: string;
    provider: ProductionCredentialProvider;
    validatedAt: string;
  }) {
    const { error } = await this.supabase
      .from("production_provider_credentials")
      .update({
        last_validated_at: params.validatedAt,
        last_validation_error: null,
        metadata: params.metadata || {},
        updated_at: new Date().toISOString(),
        validation_status: "VALID",
      })
      .eq("organization_id", params.organizationId)
      .eq("provider", params.provider)
      .eq("status", "ACTIVE");

    if (error) throw error;
  }

  async revokeActiveCredential(params: {
    organizationId: string;
    provider: ProductionCredentialProvider;
    revokedAt?: string;
  }) {
    const revokedAt = params.revokedAt || new Date().toISOString();
    const { error } = await this.supabase
      .from("production_provider_credentials")
      .update({
        revoked_at: revokedAt,
        status: "REVOKED",
        updated_at: revokedAt,
      })
      .eq("organization_id", params.organizationId)
      .eq("provider", params.provider)
      .eq("status", "ACTIVE");

    if (error) throw error;
  }
}
