import { notFound } from "next/navigation";
import HeygenPageView from "@/app/admin/heygen/HeygenPageView";
import { resolveTenantContext } from "@/lib/server/tenant-context";
import { getProductionCourseContext } from "@/domains/production/course-context/production-course-context.service";

export const dynamic = "force-dynamic";

export default async function TenantHeygenPage({
  params,
  searchParams,
}: {
  params: Promise<{ empresaSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { empresaSlug } = await params;
  const query = await searchParams;
  const tenant = await resolveTenantContext(empresaSlug);
  if (!tenant) notFound();

  const rawComponentId = query.componentId;
  const componentId = Array.isArray(rawComponentId) ? rawComponentId[0] : rawComponentId;
  const courseContext = await getProductionCourseContext({
    componentId,
    organizationId: tenant.organizationId,
  });

  return (
    <HeygenPageView
      courseContext={courseContext}
      organizationLabel={tenant.organizationSlug}
    />
  );
}
