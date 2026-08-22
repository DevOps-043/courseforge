import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { getSupabaseServiceRoleKey, requireEnv } from "./env.ts";

let cachedClient: SupabaseClient | undefined;

export function getAdminClient(): SupabaseClient {
  if (!cachedClient) {
    cachedClient = createClient(requireEnv("SUPABASE_URL"), getSupabaseServiceRoleKey(), {
      auth: { autoRefreshToken: false, persistSession: false },
    });
  }
  return cachedClient;
}

export async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const { data, error } = await getAdminClient().rpc(name, params);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}
