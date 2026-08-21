import { decryptAes256Gcm } from "./crypto.ts";
import { getEncryptionKeyHex } from "./env.ts";
import { getAdminClient } from "./supabase.ts";

export async function getOrganizationHeygenApiKey(organizationId: string): Promise<string> {
  const { data, error } = await getAdminClient()
    .from("production_provider_credentials")
    .select("encrypted_secret")
    .eq("organization_id", organizationId)
    .eq("provider", "heygen")
    .eq("status", "ACTIVE")
    .maybeSingle();
  if (error) throw new Error(`Credential lookup failed: ${error.message}`);
  if (!data?.encrypted_secret) throw new Error("No active HeyGen credential for organization.");
  return decryptAes256Gcm(data.encrypted_secret, getEncryptionKeyHex());
}
