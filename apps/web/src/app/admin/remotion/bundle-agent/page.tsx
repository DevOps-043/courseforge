import { BundleAgentClient } from "./BundleAgentClient";

export default async function AdminRemotionBundleAgentPage({
  searchParams,
}: {
  searchParams?: Promise<{ templateId?: string }>;
}) {
  const params = await searchParams;
  return <BundleAgentClient initialTemplateId={params?.templateId || null} />;
}
