import { getTemplatesAction, getPublicTemplatesAction } from "@/domains/production/actions/templates.actions";
import TemplatesContainer from "./TemplatesContainer";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";

export const dynamic = "force-dynamic";

export default async function TemplatesPage() {
  const [
    { templates: initialTemplates = [] },
    { templates: initialPublicTemplates = [] },
  ] = await Promise.all([
    getTemplatesAction(),
    getPublicTemplatesAction(),
  ]);

  let initialUserRole: string | null = null;
  try {
    const supabase = await createClient();
    const user = await getAuthenticatedUser(supabase);
    if (user) {
      const admin = getServiceRoleClient();
      const { data: profile } = await admin
        .from("profiles")
        .select("platform_role")
        .eq("id", user.userId)
        .single();
      initialUserRole = profile?.platform_role ?? null;
    }
  } catch {
    // Non-fatal — review buttons just won't appear
  }

  return (
    <TemplatesContainer
      initialTemplates={initialTemplates}
      initialPublicTemplates={initialPublicTemplates}
      initialUserRole={initialUserRole}
    />
  );
}