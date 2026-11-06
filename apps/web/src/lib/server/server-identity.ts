import { cache } from "react";
import { getAuthBridgeSession, type AuthBridgeUser } from "@/utils/auth/session";
import { createClient } from "@/utils/supabase/server";
import { AuthIdentityLookupError } from "./auth-identity-error";

interface VerifiedUser { id: string; email?: string | null }
interface ProviderError { status?: number; message?: string | null }
export interface SupabaseIdentityClient {
  auth: {
    getUser(token?: string): Promise<{ data: { user: VerifiedUser | null }; error: ProviderError | null }>;
  };
}
export interface SupabaseSessionClient extends SupabaseIdentityClient {
  auth: SupabaseIdentityClient["auth"] & {
    getSession(): Promise<{ data: { session: { access_token: string } | null }; error?: ProviderError | null }>;
  };
}

function assertProviderAvailable(error: ProviderError | null) {
  if (error && ![400, 401, 403].includes(error.status ?? 0)) throw new AuthIdentityLookupError();
}

export const resolveServerIdentity = cache(async (supabase?: SupabaseIdentityClient) => {
  const bridge = await getAuthBridgeSession();
  if (bridge) return { user: bridge.user, provider: "bridge" as const, accessToken: bridge.accessToken };
  const client = supabase ?? await createClient();
  const { data, error } = await client.auth.getUser().catch(() => { throw new AuthIdentityLookupError(); });
  assertProviderAvailable(error);
  if (error || !data.user) return null;
  const user: AuthBridgeUser = { id: data.user.id, email: data.user.email ?? "" };
  return { user, provider: "gotrue" as const, accessToken: null };
});

export async function resolveServerAccessToken(supabase: SupabaseSessionClient) {
  const identity = await resolveServerIdentity(supabase);
  if (!identity) return null;
  if (identity.provider === "bridge") return identity.accessToken;
  const { data, error } = await supabase.auth.getSession().catch(() => { throw new AuthIdentityLookupError(); });
  assertProviderAvailable(error ?? null);
  if (error) return null;
  const token = data.session?.access_token;
  if (!token) return null;
  const verified = await supabase.auth.getUser(token).catch(() => { throw new AuthIdentityLookupError(); });
  assertProviderAvailable(verified.error);
  return !verified.error && verified.data.user?.id === identity.user.id ? token : null;
}
