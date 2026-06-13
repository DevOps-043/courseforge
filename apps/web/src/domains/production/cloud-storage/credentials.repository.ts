import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { decrypt, encrypt } from "@/lib/server/crypto";
import type {
  CloudStorageCredentialRecord,
  CloudStorageProvider,
} from "./types";

export interface UpsertCloudStorageCredentialsInput {
  accessToken: string;
  accountEmail: string;
  expiresAt: string;
  provider: CloudStorageProvider;
  refreshToken: string;
  scopes: string[];
  userId: string;
}

export async function getCloudStorageCredentials(
  userId: string,
  provider: CloudStorageProvider,
) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("user_cloud_storage_credentials")
    .select("user_id, provider, account_email, access_token, refresh_token, expires_at, scopes")
    .eq("user_id", userId)
    .eq("provider", provider)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudieron consultar las credenciales cloud: ${error.message}`);
  }

  return (data as CloudStorageCredentialRecord | null) ?? null;
}

export async function upsertCloudStorageCredentials(
  input: UpsertCloudStorageCredentialsInput,
) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("user_cloud_storage_credentials")
    .upsert(
      {
        user_id: input.userId,
        provider: input.provider,
        account_email: input.accountEmail,
        access_token: encrypt(input.accessToken),
        refresh_token: encrypt(input.refreshToken),
        expires_at: input.expiresAt,
        scopes: input.scopes,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id,provider" },
    );

  if (error) {
    throw new Error(`No se pudieron guardar las credenciales cloud: ${error.message}`);
  }
}

export async function updateCloudStorageAccessToken(params: {
  accessToken: string;
  expiresAt: string;
  provider: CloudStorageProvider;
  refreshToken?: string;
  userId: string;
}) {
  const admin = getServiceRoleClient();
  const updatePayload: Record<string, string> = {
    access_token: encrypt(params.accessToken),
    expires_at: params.expiresAt,
    updated_at: new Date().toISOString(),
  };

  if (params.refreshToken) {
    updatePayload.refresh_token = encrypt(params.refreshToken);
  }

  const { error } = await admin
    .from("user_cloud_storage_credentials")
    .update(updatePayload)
    .eq("user_id", params.userId)
    .eq("provider", params.provider);

  if (error) {
    throw new Error(`No se pudo actualizar el token cloud: ${error.message}`);
  }
}

export async function deleteCloudStorageCredentials(
  userId: string,
  provider: CloudStorageProvider,
) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("user_cloud_storage_credentials")
    .delete()
    .eq("user_id", userId)
    .eq("provider", provider);

  if (error) {
    throw new Error(`No se pudieron eliminar las credenciales cloud: ${error.message}`);
  }
}

export function decryptCredentialToken(encryptedToken: string) {
  return decrypt(encryptedToken);
}
