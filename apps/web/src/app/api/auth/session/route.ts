import { getAuthBridgeUser } from "@/utils/auth/session";
import { createClient } from "@/utils/supabase/server";
import { createAuthSessionHandler } from "@/features/auth/session-http";

export const dynamic = "force-dynamic";

/** No tokens leave the server. Authorization remains enforced by each resource API. */
export const GET = createAuthSessionHandler({
  readBridgeUser: async () => {
    const bridgeUser = await getAuthBridgeUser();
    return bridgeUser ? { ...bridgeUser, last_name_father: bridgeUser.last_name } : null;
  },
  readSupabaseUser: async () => {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;
    const { data: profile } = await supabase.from("profiles")
      .select("username, first_name, last_name_father, last_name_mother, avatar_url, platform_role")
      .eq("id", user.id).maybeSingle();
    return { ...profile, id: user.id, email: user.email };
  },
});
