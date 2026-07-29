import { getOptionalServerEnvValue } from "../../../../lib/server/env";
import { ProductionProviderCredentialsService } from "../credentials/provider-credentials.service";
import type { ProductionProviderCredentialsSupabaseClient } from "../credentials/provider-credentials.types";
import { HeygenClient } from "./heygen.client";

export class HeygenCredentialResolverError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status = 409, code = "HEYGEN_CREDENTIAL_REQUIRED") {
    super(message);
    this.name = "HeygenCredentialResolverError";
    this.code = code;
    this.status = status;
  }
}

export async function getHeygenClientForOrganization(params: {
  allowGlobalFallback?: boolean;
  organizationId: string;
  supabase: ProductionProviderCredentialsSupabaseClient;
}) {
  const credentialService = new ProductionProviderCredentialsService({
    supabase: params.supabase,
  });
  const credential = await credentialService.getDecryptedSecret({
    organizationId: params.organizationId,
    provider: "heygen",
  });

  if (credential?.secret) {
    return {
      authMode: "organization_api_key" as const,
      client: new HeygenClient({ apiKey: credential.secret }),
      credentialLast4: credential.last4,
    };
  }

  const globalApiKey = getOptionalServerEnvValue("HEYGEN_API_KEY");
  if (params.allowGlobalFallback && typeof globalApiKey === "string" && globalApiKey.trim()) {
    return {
      authMode: "global_api_key" as const,
      client: new HeygenClient({ apiKey: globalApiKey }),
      credentialLast4: null,
    };
  }

  throw new HeygenCredentialResolverError(
    "Configura una API key de HeyGen para esta empresa antes de continuar.",
    409,
    "HEYGEN_ORGANIZATION_CREDENTIAL_REQUIRED",
  );
}
