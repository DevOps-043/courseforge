import SlideTemplatesLibraryPage from "@/app/admin/templates/page";

export const dynamic = "force-dynamic";

export default async function TenantSlideTemplatesLibraryPage({
  params,
}: {
  params: Promise<{ empresaSlug: string }>;
}) {
  const { empresaSlug } = await params;
  return <SlideTemplatesLibraryPage adminBasePath={`/${empresaSlug}/admin`} />;
}
