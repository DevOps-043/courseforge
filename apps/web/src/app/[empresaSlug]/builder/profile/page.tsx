import { notFound } from "next/navigation";
import ProfilePage from "@/app/admin/profile/page";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export default async function TenantBuilderProfilePage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  return <ProfilePage organizationId={tenant.organizationId} />;
}
