import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getAuthenticatedUser } from "@/lib/server/artifact-action-auth";
import { getCloudStorageConnectionsForTenant } from "@/domains/production/actions/cloud-storage.actions";
import IntegrationsClient from "./IntegrationsClient";

export default async function IntegrationsPageView({
  organizationId,
  organizationSlug,
}: {
  organizationId: string;
  organizationSlug: string;
}) {
  const supabase = await createClient();
  const authUser = await getAuthenticatedUser(supabase);

  if (!authUser) {
    redirect("/login");
  }

  const connections = await getCloudStorageConnectionsForTenant({
    organizationId,
    userId: authUser.userId,
  });

  return (
    <IntegrationsClient
      connections={connections}
      organizationLabel={organizationSlug}
    />
  );
}
