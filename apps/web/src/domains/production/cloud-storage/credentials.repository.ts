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
  organizationId: string;
  provider: CloudStorageProvider;
  refreshToken: string;
  scopes: string[];
  userId: string;
}

export async function getCloudStorageCredentials(
  userId: string,
  organizationId: string,
  provider: CloudStorageProvider,
) {
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("user_cloud_storage_credentials")
    .select("user_id, organization_id, provider, account_email, access_token, refresh_token, expires_at, scopes")
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
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

  const payload = {
    user_id: input.userId,
    organization_id: input.organizationId,
    provider: input.provider,
    account_email: input.accountEmail,
    access_token: encrypt(input.accessToken),
    refresh_token: encrypt(input.refreshToken),
    expires_at: input.expiresAt,
    scopes: input.scopes,
    updated_at: new Date().toISOString(),
  };

  const { data: existing, error: existingError } = await admin
    .from("user_cloud_storage_credentials")
    .select("id")
    .eq("user_id", input.userId)
    .eq("organization_id", input.organizationId)
    .eq("provider", input.provider)
    .maybeSingle();

  if (existingError) {
    throw new Error(`No se pudieron consultar las credenciales cloud: ${existingError.message}`);
  }

  const { error } = existing?.id
    ? await admin
        .from("user_cloud_storage_credentials")
        .update(payload)
        .eq("id", existing.id)
    : await admin.from("user_cloud_storage_credentials").insert(payload);

  if (error) {
    throw new Error(`No se pudieron guardar las credenciales cloud: ${error.message}`);
  }
}

export async function updateCloudStorageAccessToken(params: {
  accessToken: string;
  expiresAt: string;
  organizationId: string;
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
    .eq("organization_id", params.organizationId)
    .eq("provider", params.provider);

  if (error) {
    throw new Error(`No se pudo actualizar el token cloud: ${error.message}`);
  }
}

export async function deleteCloudStorageCredentials(
  userId: string,
  organizationId: string,
  provider: CloudStorageProvider,
) {
  const admin = getServiceRoleClient();
  const { error } = await admin
    .from("user_cloud_storage_credentials")
    .delete()
    .eq("user_id", userId)
    .eq("organization_id", organizationId)
    .eq("provider", provider);

  if (error) {
    throw new Error(`No se pudieron eliminar las credenciales cloud: ${error.message}`);
  }
}

export function decryptCredentialToken(encryptedToken: string) {
  return decrypt(encryptedToken);
}
