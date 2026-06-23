"use server";

import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  deleteCloudStorageCredentials,
  decryptCredentialToken,
  getCloudStorageCredentials,
} from "@/domains/production/cloud-storage/credentials.repository";
import type {
  CloudStorageConnection,
  CloudStorageProvider,
} from "@/domains/production/cloud-storage/types";

export async function getCloudStorageConnectionsForTenant(params: {
  organizationId: string;
  userId: string;
}): Promise<CloudStorageConnection[]> {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("user_cloud_storage_credentials")
    .select("provider, account_email, organization_id")
    .eq("user_id", params.userId)
    .or(`organization_id.eq.${params.organizationId},organization_id.is.null`);

  if (error) {
    console.error("[CloudStorageConnections] Error:", error);
    return [];
  }

  const scopedConnections = (data || []).filter(
    (row: any) => row.organization_id === params.organizationId,
  );
  const legacyConnections = new Set(
    (data || [])
      .filter((row: any) => !row.organization_id)
      .map((row: any) => row.provider as CloudStorageProvider),
  );
  const connectedByProvider = new Map(
    scopedConnections.map((row: any) => [
      row.provider as CloudStorageProvider,
      row.account_email as string,
    ]),
  );

  return (["google_drive", "onedrive"] as CloudStorageProvider[]).map((provider) => ({
    connected: connectedByProvider.has(provider),
    email: connectedByProvider.get(provider) || null,
    needsReconnect: !connectedByProvider.has(provider) && legacyConnections.has(provider),
    provider,
  }));
}

export async function getCloudStorageConnectionsAction(): Promise<{
  connections: CloudStorageConnection[];
}> {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return { connections: [] };
    }

    const tenant = await resolveActiveTenantContext();
    if (!tenant) {
      return { connections: [] };
    }

    return {
      connections: await getCloudStorageConnectionsForTenant({
        organizationId: tenant.organizationId,
        userId: user.userId,
      }),
    };
  } catch (error) {
    console.error("[CloudStorageConnections] Unexpected error:", error);
    return { connections: [] };
  }
}

export async function disconnectCloudStorageAction(provider: CloudStorageProvider) {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) return { success: false, error: "No autorizado" };

    const tenant = await resolveActiveTenantContext();
    if (!tenant) return { success: false, error: "Empresa no valida o no autorizada" };

    const creds = await getCloudStorageCredentials(user.userId, tenant.organizationId, provider);
    if (creds) {
      const tokenToRevoke = decryptCredentialToken(creds.refresh_token || creds.access_token);
      try {
        if (provider === "google_drive") {
          await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(tokenToRevoke)}`, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
          });
        }
      } catch (revokeErr) {
        console.warn("[CloudStorageDisconnect] Token revocation failed:", revokeErr);
      }

      await deleteCloudStorageCredentials(user.userId, tenant.organizationId, provider);

    }

    return { success: true };
  } catch (error: any) {
    console.error("[CloudStorageDisconnect] Error:", error);
    return { success: false, error: error.message || "Error al desvincular la integracion" };
  }
}
