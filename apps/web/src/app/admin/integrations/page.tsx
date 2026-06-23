import { redirect } from "next/navigation";
import { resolveDefaultTenantPath } from "@/lib/server/tenant-context";

export default async function LegacyIntegrationsPage() {
  const fallbackPath = await resolveDefaultTenantPath("/admin/integrations");
  redirect(fallbackPath || "/admin");
}
