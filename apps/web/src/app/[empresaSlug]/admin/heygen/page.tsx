import { notFound } from "next/navigation";
import HeygenPageView from "@/app/admin/heygen/HeygenPageView";
import { resolveTenantContext } from "@/lib/server/tenant-context";

export const dynamic = "force-dynamic";

export default async function TenantHeygenPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  return <HeygenPageView organizationLabel={tenant.organizationSlug} />;
}
