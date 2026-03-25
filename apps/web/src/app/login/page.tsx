import { createClient } from "@/utils/supabase/server";
import { getAuthBridgeUser } from "@/utils/auth/session";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import LoginForm from "./LoginForm";

async function resolveRedirectForUser(userId: string) {
  const admin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: profile } = await admin
    .from("profiles")
    .select("platform_role")
    .eq("id", userId)
    .maybeSingle();

  if (
    profile?.platform_role === "ADMIN" ||
    profile?.platform_role === "SUPERADMIN"
  ) {
    return "/admin";
  }

  if (profile?.platform_role === "ARQUITECTO") {
    return "/architect";
  }

  return "/builder";
}

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const bridgeUser = session ? null : await getAuthBridgeUser();
  const currentUserId = session?.user.id || bridgeUser?.id;

  if (currentUserId) {
    redirect(await resolveRedirectForUser(currentUserId));
  }

  return <LoginForm />;
}
