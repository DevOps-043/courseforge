import WorkerTelemetryPage from "@/app/admin/worker-telemetry/page";

export const dynamic = "force-dynamic";

export default function TenantWorkerTelemetryPage(props: {
  params: Promise<{ empresaSlug?: string }>;
  searchParams?: Promise<{ workerLinkCode?: string }>;
}) {
  return <WorkerTelemetryPage {...props} />;
}
