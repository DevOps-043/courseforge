import { getOptionalServerEnvValue } from "@/lib/server/env";
import { ProductionProviderCredentialsService } from "../providers/credentials/provider-credentials.service";
import type { ProductionProviderCredentialsSupabaseClient } from "../providers/credentials/provider-credentials.types";
import { HyperframesCloudClient } from "./hyperframes-cloud.client";

export class HyperframesCredentialResolverError extends Error {
  constructor(
    message: string,
    readonly status = 409,
    readonly code = "HYPERFRAMES_CREDENTIAL_REQUIRED",
  ) {
    super(message);
  }
}

/** Resolves the assembly credential without exposing it to the browser. */
export async function getHyperframesClientForOrganization(params: {
  allowGlobalFallback?: boolean;
  organizationId: string;
  supabase: ProductionProviderCredentialsSupabaseClient;
}) {
  const credentialService = new ProductionProviderCredentialsService({
    supabase: params.supabase,
  });
  const credential = await credentialService.getDecryptedSecret({
    organizationId: params.organizationId,
    provider: "hyperframes_cloud",
  });

  if (credential?.secret) {
    return {
      authMode: "organization_api_key" as const,
      client: new HyperframesCloudClient({ apiKey: credential.secret }),
      credentialLast4: credential.last4,
    };
  }

  const globalApiKey = getOptionalServerEnvValue("HYPERFRAMES_CLOUD_API_KEY");
  if (params.allowGlobalFallback && globalApiKey?.trim()) {
    return {
      authMode: "global_api_key" as const,
      client: new HyperframesCloudClient({ apiKey: globalApiKey }),
      credentialLast4: null,
    };
  }

  throw new HyperframesCredentialResolverError(
    "Configura una API key de HyperFrames Cloud para esta empresa antes de renderizar.",
    409,
    "HYPERFRAMES_ORGANIZATION_CREDENTIAL_REQUIRED",
  );
}
