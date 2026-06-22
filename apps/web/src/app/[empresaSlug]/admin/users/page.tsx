import { notFound } from "next/navigation";
import UsersPage from "@/app/admin/users/page";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export default async function TenantUsersPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();
  if (tenant.platformRole !== "ADMIN" && tenant.platformRole !== "SUPERADMIN") {
    notFound();
  }

  return <UsersPage organizationId={tenant.organizationId} />;
}
