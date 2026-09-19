import { createClient as createAdminClient } from "@supabase/supabase-js";
import { getSofliaInboxEnv } from "@/lib/server/env";

interface SofliaCreatedAtRow {
  created_at?: string | null;
}

export async function getSofliaMemberSinceDate(userId: string) {
  try {
    const { url, key } = getSofliaInboxEnv();
    const sofliaAdmin = createAdminClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
    const { data, error } = await sofliaAdmin
      .from("users")
      .select("created_at")
      .eq("id", userId)
      .maybeSingle();

    if (error) {
      console.warn(
        "[ProfilePage] Could not load the Soflia account creation date:",
        error.message,
      );
      return null;
    }

    return ((data as SofliaCreatedAtRow | null)?.created_at || null);
  } catch (error) {
    console.warn(
      "[ProfilePage] Soflia account creation date is temporarily unavailable:",
      error instanceof Error ? error.message : "Unknown error",
    );
    return null;
  }
}
