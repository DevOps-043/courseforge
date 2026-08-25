import { createClient } from "@/utils/supabase/server";
import { getAuthBridgeUser } from "@/utils/auth/session";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { getSupabaseServiceRoleKey, getSupabaseUrl } from "@/lib/server/env";
import LoginForm from "./LoginForm";
import {
  getPlatformRoleHome,
  normalizePlatformRole,
} from "@/utils/auth/platform-role";

async function resolveRedirectForUser(
  userId: string,
  bridgeRole?: string | null,
) {
  const admin = createAdminClient(
    getSupabaseUrl(),
    getSupabaseServiceRoleKey(),
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();

  const role =
    normalizePlatformRole(bridgeRole) ||
    normalizePlatformRole(profile?.platform_role);

  return role ? getPlatformRoleHome(role) : null;
}

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const bridgeUser = session ? null : await getAuthBridgeUser();
  const currentUserId = session?.user.id || bridgeUser?.id;

  if (currentUserId) {
    const redirectTo = await resolveRedirectForUser(
      currentUserId,
      bridgeUser?.platform_role,
    );
    if (redirectTo) {
      redirect(redirectTo);
    }
  }

  return <LoginForm />;
}
