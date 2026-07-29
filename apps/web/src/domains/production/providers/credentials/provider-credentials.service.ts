import { decrypt, encrypt } from "../../../../lib/server/crypto";
import { HeygenApiError, HeygenClient } from "../heygen/heygen.client";
import { ProductionProviderCredentialsRepository } from "./provider-credentials.repository";
import type {
  ProductionCredentialProvider,
  ProductionProviderCredentialRow,
  ProductionProviderCredentialStatus,
  ProductionProviderCredentialsSupabaseClient,
} from "./provider-credentials.types";

export class ProductionProviderCredentialError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status = 400, code = "PROVIDER_CREDENTIAL_ERROR") {
    super(message);
    this.name = "ProductionProviderCredentialError";
    this.code = code;
    this.status = status;
  }
}

export interface ProductionProviderCredentialsServiceOptions {
  repository?: ProductionProviderCredentialsRepository;
  supabase?: ProductionProviderCredentialsSupabaseClient;
}

export class ProductionProviderCredentialsService {
  private readonly repository: ProductionProviderCredentialsRepository;

  constructor(options: ProductionProviderCredentialsServiceOptions) {
    if (!options.repository && !options.supabase) {
      throw new Error(
        "ProductionProviderCredentialsService requiere repository o supabase.",
      );
    }

    this.repository =
      options.repository ||
      new ProductionProviderCredentialsRepository(
        options.supabase as ProductionProviderCredentialsSupabaseClient,
      );
  }

  async getCredentialStatus(params: {
    organizationId: string;
    provider: ProductionCredentialProvider;
  }): Promise<ProductionProviderCredentialStatus> {
    const credential = await this.repository.getActiveCredentialMetadata(params);
    return toCredentialStatus(params.provider, credential);
  }

  async getDecryptedSecret(params: {
    organizationId: string;
    provider: ProductionCredentialProvider;
  }) {
    const credential = await this.repository.getActiveEncryptedSecret(params);
    if (!credential?.encrypted_secret) return null;

    return {
      last4: credential.secret_last4 || null,
      secret: decrypt(credential.encrypted_secret),
      validationStatus: credential.validation_status,
    };
  }

  async upsertHeygenApiKey(params: {
    apiKey: string;
    createdBy: string;
    organizationId: string;
  }): Promise<ProductionProviderCredentialStatus> {
    const normalizedApiKey = normalizeApiKey(params.apiKey);
    await validateHeygenApiKey(normalizedApiKey);

    const saved = await this.repository.upsertActiveCredential({
      createdBy: params.createdBy,
      encryptedSecret: encrypt(normalizedApiKey),
      last4: readLast4(normalizedApiKey),
      metadata: { validation_provider: "heygen" },
      organizationId: params.organizationId,
      provider: "heygen",
      validatedAt: new Date().toISOString(),
    });

    return toCredentialStatus("heygen", saved);
  }

  async validateActiveHeygenCredential(params: {
    organizationId: string;
  }): Promise<ProductionProviderCredentialStatus> {
    const credential = await this.getDecryptedSecret({
      organizationId: params.organizationId,
      provider: "heygen",
    });

    if (!credential?.secret) {
      throw new ProductionProviderCredentialError(
        "Configura una API key de HeyGen para esta empresa.",
        409,
        "HEYGEN_ORGANIZATION_CREDENTIAL_REQUIRED",
      );
    }

    try {
      await validateHeygenApiKey(credential.secret);
      const validatedAt = new Date().toISOString();
      await this.repository.markCredentialValidationSucceeded({
        metadata: { validation_provider: "heygen" },
        organizationId: params.organizationId,
        provider: "heygen",
        validatedAt,
      });
    } catch (error) {
      await this.repository.markCredentialValidationFailed({
        errorMessage: buildSafeValidationError(error),
        organizationId: params.organizationId,
        provider: "heygen",
      });
      throw error;
    }

    return this.getCredentialStatus({
      organizationId: params.organizationId,
      provider: "heygen",
    });
  }

  async revokeCredential(params: {
    organizationId: string;
    provider: ProductionCredentialProvider;
  }): Promise<ProductionProviderCredentialStatus> {
    await this.repository.revokeActiveCredential(params);
    return toCredentialStatus(params.provider, null);
  }
}

function normalizeApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 12) {
    throw new ProductionProviderCredentialError(
      "La API key de HeyGen parece incompleta.",
      400,
      "HEYGEN_API_KEY_INVALID_FORMAT",
    );
  }

  return normalized;
}

async function validateHeygenApiKey(apiKey: string) {
  try {
    await new HeygenClient({ apiKey }).listAvatarLooks();
  } catch (error) {
    if (error instanceof HeygenApiError) {
      throw new ProductionProviderCredentialError(
        error.status === 401 || error.status === 403
          ? "La API key de HeyGen no es valida o no tiene permisos."
          : "No se pudo validar la API key con HeyGen.",
        error.status === 429 ? 429 : 400,
        "HEYGEN_API_KEY_VALIDATION_FAILED",
      );
    }

    throw error;
  }
}

function toCredentialStatus(
  provider: ProductionCredentialProvider,
  credential: ProductionProviderCredentialRow | null,
): ProductionProviderCredentialStatus {
  return {
    connected: Boolean(credential && credential.status === "ACTIVE"),
    last4: credential?.secret_last4 || null,
    lastValidatedAt: credential?.last_validated_at || null,
    lastValidationError: credential?.last_validation_error || null,
    provider,
    status: credential?.status || null,
    validationStatus: credential?.validation_status || null,
  };
}

function readLast4(value: string) {
  return value.slice(-4);
}

function buildSafeValidationError(error: unknown) {
  if (error instanceof ProductionProviderCredentialError) return error.message;
  if (error instanceof Error) return error.message;
  return "No se pudo validar la credencial.";
}
