import { notFound } from "next/navigation";
import IntegrationsPageView from "@/app/admin/integrations/IntegrationsPageView";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export default async function TenantIntegrationsPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  return (
    <IntegrationsPageView
      organizationId={tenant.organizationId}
      organizationSlug={tenant.organizationSlug}
    />
  );
}
