import {
  ProductionProviderCredentialError,
  ProductionProviderCredentialsService,
} from "../providers/credentials/provider-credentials.service";
import type { ProductionProviderCredentialsSupabaseClient } from "../providers/credentials/provider-credentials.types";
import { HyperframesCloudApiError, HyperframesCloudClient } from "./hyperframes-cloud.client";

/** Owns the HyperFrames Cloud credential lifecycle and its provider-specific probe. */
export class HyperframesConnectionService {
  private readonly credentials: ProductionProviderCredentialsService;

  constructor(supabase: ProductionProviderCredentialsSupabaseClient) {
    this.credentials = new ProductionProviderCredentialsService({ supabase });
  }

  async getStatus(organizationId: string) {
    return this.credentials.getCredentialStatus({ organizationId, provider: "hyperframes_cloud" });
  }

  async saveApiKey(params: { apiKey: string; createdBy: string; organizationId: string }) {
    const apiKey = normalizeApiKey(params.apiKey);
    await validateHyperframesCloudApiKey(apiKey);
    return this.credentials.upsertValidatedSecret({
      createdBy: params.createdBy,
      metadata: { validation_provider: "hyperframes_cloud" },
      organizationId: params.organizationId,
      provider: "hyperframes_cloud",
      secret: apiKey,
    });
  }

  async validateActiveApiKey(organizationId: string) {
    const credential = await this.credentials.getDecryptedSecret({ organizationId, provider: "hyperframes_cloud" });
    if (!credential?.secret) {
      throw new ProductionProviderCredentialError("Configura una API key de HyperFrames Cloud para esta empresa.", 409, "HYPERFRAMES_ORGANIZATION_CREDENTIAL_REQUIRED");
    }
    try {
      await validateHyperframesCloudApiKey(credential.secret);
      await this.credentials.markValidationSucceeded({
        metadata: { validation_provider: "hyperframes_cloud" },
        organizationId,
        provider: "hyperframes_cloud",
      });
    } catch (error) {
      await this.credentials.markValidationFailed({
        errorMessage: error instanceof Error ? error.message : "No se pudo validar la credencial.",
        organizationId,
        provider: "hyperframes_cloud",
      });
      throw error;
    }
    return this.getStatus(organizationId);
  }
}

function normalizeApiKey(apiKey: string) {
  const normalized = apiKey.trim();
  if (normalized.length < 12) {
    throw new ProductionProviderCredentialError(
      "La API key de HyperFrames Cloud parece incompleta.",
      400,
      "HYPERFRAMES_API_KEY_INVALID_FORMAT",
    );
  }
  return normalized;
}

async function validateHyperframesCloudApiKey(apiKey: string) {
  try {
    await new HyperframesCloudClient({ apiKey }).getRender("credential-probe");
  } catch (error) {
    if (error instanceof HyperframesCloudApiError && error.status === 404) return;
    if (error instanceof HyperframesCloudApiError) {
      throw new ProductionProviderCredentialError(
        error.status === 401 || error.status === 403
          ? "La API key de HyperFrames Cloud no es válida o no tiene permisos."
          : "No se pudo validar la API key con HyperFrames Cloud.",
        error.status === 429 ? 429 : 400,
        "HYPERFRAMES_API_KEY_VALIDATION_FAILED",
      );
    }
    throw error;
  }
}
