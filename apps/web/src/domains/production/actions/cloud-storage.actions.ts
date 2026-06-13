"use server";

import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import {
  deleteCloudStorageCredentials,
  decryptCredentialToken,
  getCloudStorageCredentials,
} from "@/domains/production/cloud-storage/credentials.repository";
import type {
  CloudStorageConnection,
  CloudStorageProvider,
} from "@/domains/production/cloud-storage/types";

export async function getCloudStorageConnectionsAction(): Promise<{
  connections: CloudStorageConnection[];
}> {
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (!user) {
      return { connections: [] };
    }

    const admin = getServiceRoleClient();
    const { data, error } = await admin
      .from("user_cloud_storage_credentials")
      .select("provider, account_email")
      .eq("user_id", user.userId);

    if (error) {
      console.error("[CloudStorageConnections] Error:", error);
      return { connections: [] };
    }

    const connectedByProvider = new Map(
      (data || []).map((row: any) => [
        row.provider as CloudStorageProvider,
        row.account_email as string,
      ]),
    );

    return {
      connections: (["google_drive", "onedrive"] as CloudStorageProvider[]).map((provider) => ({
        connected: connectedByProvider.has(provider),
        email: connectedByProvider.get(provider) || null,
        provider,
      })),
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

    const creds = await getCloudStorageCredentials(user.userId, provider);
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

      await deleteCloudStorageCredentials(user.userId, provider);

      if (provider === "google_drive") {
        await getServiceRoleClient()
          .from("user_google_credentials")
          .delete()
          .eq("user_id", user.userId);
      }
    }

    return { success: true };
  } catch (error: any) {
    console.error("[CloudStorageDisconnect] Error:", error);
    return { success: false, error: error.message || "Error al desvincular la integracion" };
  }
}
