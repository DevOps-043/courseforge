import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { getActiveOrganizationId, getAuthBridgeUser, getUserOrganizations } from "@/utils/auth/session";
import { getAuthenticatedUser, getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext, resolveTenantContext } from "@/lib/server/tenant-context";
import { DesktopWorkerControlPlane } from "@/lib/server/desktop-worker-control-plane";

const ADMIN_ROLES = new Set(["ADMIN", "SUPERADMIN"]);
const RUN_LIMIT = 50;
const LONG_RESOLVED_VIDEO_SECONDS = 5 * 60;
const QUEUE_WAIT_WARNING_MS = 2 * 60 * 1000;
const SLOW_RENDER_RATIO_WARNING = 6;
const HIGH_CPU_PERCENT = 85;
const HIGH_GPU_PERCENT = 80;
const HIGH_MEMORY_RATIO = 0.85;

type SupabaseAdminClient = ReturnType<typeof getServiceRoleClient>;

interface WorkerTelemetryRunRow {
  id: string;
  worker_id: string;
  organization_id: string;
  remote_table: string;
  remote_job_id: string;
  job_type: string;
  status: string;
  started_at: string;
  finished_at?: string | null;
  elapsed_ms?: number | null;
  last_stage?: string | null;
  last_progress_percent?: number | null;
  sample_count?: number | null;
  avg_app_cpu_percent?: number | null;
  max_app_cpu_percent?: number | null;
  avg_app_gpu_percent?: number | null;
  max_app_gpu_percent?: number | null;
  avg_system_cpu_percent?: number | null;
  max_system_cpu_percent?: number | null;
  avg_system_gpu_percent?: number | null;
  max_system_gpu_percent?: number | null;
  max_system_memory_used_bytes?: number | null;
  memory_total_bytes?: number | null;
  cpu_model?: string | null;
  cpu_logical_threads?: number | null;
  gpu_adapters?: unknown;
  platform?: string | null;
  arch?: string | null;
  artifact_id?: string | null;
  material_component_id?: string | null;
  template_version_id?: string | null;
  render_batch_id?: string | null;
  composition_id?: string | null;
  error_code?: string | null;
  error_message?: string | null;
}

interface RenderWorkerRow {
  id: string;
  device_name?: string | null;
  status?: string | null;
  platform?: string | null;
  arch?: string | null;
  app_version?: string | null;
}

interface RenderWorkerLinkCodeRow {
  id: string;
  code_last4: string;
  device_name?: string | null;
  platform?: string | null;
  arch?: string | null;
  app_version?: string | null;
  expires_at: string;
  consumed_at?: string | null;
  created_at: string;
}

interface ArtifactRow {
  id: string;
  title?: string | null;
}

interface MaterialComponentRow {
  id: string;
  type?: string | null;
}

interface ProductionJobRow {
  id: string;
  status?: string | null;
  created_at?: string | null;
  claimed_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  failed_at?: string | null;
  duration_seconds?: number | null;
  input_snapshot?: unknown;
}

export type WorkerTelemetryInsightLevel = "info" | "warning" | "critical";

export interface WorkerTelemetryInsight {
  detail: string;
  level: WorkerTelemetryInsightLevel;
  metric: string;
  title: string;
}

export interface WorkerTelemetryRunView {
  id: string;
  workerName: string;
  workerStatus: string;
  jobLabel: string;
  jobType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number | null;
  queueWaitMs: number | null;
  resolvedDurationSeconds: number | null;
  renderVideoRatio: number | null;
  bottleneckLabel: string;
  lastStage: string | null;
  progressPercent: number | null;
  sampleCount: number;
  avgAppCpuPercent: number;
  maxAppCpuPercent: number;
  avgAppGpuPercent: number;
  maxAppGpuPercent: number;
  avgSystemCpuPercent: number;
  maxSystemCpuPercent: number;
  avgSystemGpuPercent: number;
  maxSystemGpuPercent: number;
  maxSystemMemoryUsedBytes: number;
  memoryTotalBytes: number;
  cpuLabel: string;
  gpuLabel: string;
  artifactTitle: string | null;
  componentType: string | null;
  platformLabel: string;
  errorText: string | null;
}

export interface WorkerTelemetrySummary {
  avgElapsedMs: number;
  avgRenderVideoRatio: number;
  completedRuns: number;
  failedRuns: number;
  longDurationRuns: number;
  p95ElapsedMs: number;
  p95QueueWaitMs: number;
  p95RenderVideoRatio: number;
  queueWaitRuns: number;
  runningRuns: number;
  sampledRuns: number;
  totalRuns: number;
  workerCount: number;
}

export interface LinkedWorkerView {
  id: string;
  name: string;
  status: string;
  platformLabel: string;
  appVersion: string;
  tokenLast4: string;
  maxConcurrentJobs: number;
  runningJobs: number;
  availableSlots: number;
  isPrimaryBundleWorker: boolean;
  createdAt: string;
  lastHeartbeatAt: string | null;
}

export interface WorkerLinkCodeView {
  id: string;
  codeLast4: string;
  deviceName: string | null;
  platformLabel: string;
  expiresAt: string;
  createdAt: string;
}

export interface WorkerTelemetryPageData {
  linkCodes: WorkerLinkCodeView[];
  organizationId: string | null;
  optimizationInsights: WorkerTelemetryInsight[];
  role: string | null;
  runs: WorkerTelemetryRunView[];
  summary: WorkerTelemetrySummary;
  workers: LinkedWorkerView[];
}

function toFiniteNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toPositiveNumberOrNull(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function parseDateMs(value: string | null | undefined) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uniq(values: Array<string | null | undefined>) {
  return Array.from(new Set(values.filter(Boolean) as string[]));
}

function isUuid(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value));
}

function getGpuLabel(value: unknown) {
  if (!Array.isArray(value) || value.length === 0) {
    return "GPU no reportada";
  }

  const names = value
    .map((adapter) => {
      if (!adapter || typeof adapter !== "object") return null;
      const name = "name" in adapter ? String(adapter.name || "").trim() : "";
      return name || null;
    })
    .filter(Boolean);

  return names.slice(0, 2).join(" + ") || "GPU no reportada";
}

function getTerminalProductionJobFinishedAt(job: ProductionJobRow | null | undefined) {
  if (!job?.status) return null;

  const normalizedStatus = job.status.toUpperCase();
  if (normalizedStatus === "SUCCEEDED" || normalizedStatus === "COMPLETED") {
    return job.completed_at || null;
  }

  if (normalizedStatus === "FAILED" || normalizedStatus === "CANCELLED" || normalizedStatus === "CANCELED") {
    return job.failed_at || job.completed_at || null;
  }

  return null;
}

function resolveQueueWaitMs(job: ProductionJobRow | null | undefined) {
  const createdAtMs = parseDateMs(job?.created_at);
  const claimedAtMs = parseDateMs(job?.claimed_at || job?.started_at);
  if (!createdAtMs || !claimedAtMs || claimedAtMs <= createdAtMs) return null;
  return claimedAtMs - createdAtMs;
}

function resolveProductionJobDurationSeconds(job: ProductionJobRow | null | undefined) {
  const inputSnapshot = asRecord(job?.input_snapshot);
  const resolvedProps = asRecord(inputSnapshot?.resolvedProps);
  const frames = toPositiveNumberOrNull(resolvedProps?.totalDurationInFrames);
  const fps = toPositiveNumberOrNull(resolvedProps?.fps);

  if (frames && fps) {
    return frames / fps;
  }

  return toPositiveNumberOrNull(job?.duration_seconds);
}

function resolveRenderVideoRatio(elapsedMs: number | null, resolvedDurationSeconds: number | null) {
  if (!elapsedMs || elapsedMs <= 0 || !resolvedDurationSeconds || resolvedDurationSeconds <= 0) return null;
  return elapsedMs / 1000 / resolvedDurationSeconds;
}

function resolveBottleneckLabel(run: {
  elapsedMs: number | null;
  maxAppCpuPercent: number;
  maxAppGpuPercent: number;
  maxSystemCpuPercent: number;
  maxSystemGpuPercent: number;
  maxSystemMemoryUsedBytes: number;
  memoryTotalBytes: number;
}) {
  const memoryRatio = run.memoryTotalBytes > 0
    ? run.maxSystemMemoryUsedBytes / run.memoryTotalBytes
    : 0;

  if (memoryRatio >= HIGH_MEMORY_RATIO) return "Presion de memoria";
  if (Math.max(run.maxAppGpuPercent, run.maxSystemGpuPercent) >= HIGH_GPU_PERCENT) return "GPU saturada";
  if (Math.max(run.maxAppCpuPercent, run.maxSystemCpuPercent) >= HIGH_CPU_PERCENT) return "CPU saturada";
  if ((run.elapsedMs || 0) > 0) return "Sin saturacion clara";
  return "Sin muestra suficiente";
}

function percentile(values: number[], percentileRank: number) {
  const sorted = values
    .filter((value) => Number.isFinite(value) && value > 0)
    .sort((left, right) => left - right);

  if (sorted.length === 0) return 0;
  const index = Math.ceil((percentileRank / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, index))];
}

function average(values: number[]) {
  const validValues = values.filter((value) => Number.isFinite(value) && value > 0);
  return validValues.length
    ? validValues.reduce((total, value) => total + value, 0) / validValues.length
    : 0;
}

function buildOptimizationInsights(runs: WorkerTelemetryRunView[], summary: WorkerTelemetrySummary): WorkerTelemetryInsight[] {
  const insights: WorkerTelemetryInsight[] = [];
  const totalRuns = Math.max(1, summary.totalRuns);
  const failureRate = summary.failedRuns / totalRuns;
  const memoryPressureRuns = runs.filter((run) => run.bottleneckLabel === "Presion de memoria").length;
  const cpuPressureRuns = runs.filter((run) => run.bottleneckLabel === "CPU saturada").length;
  const gpuPressureRuns = runs.filter((run) => run.bottleneckLabel === "GPU saturada").length;

  if (summary.longDurationRuns > 0) {
    insights.push({
      level: "critical",
      title: "Duracion resuelta anormalmente larga",
      metric: `${summary.longDurationRuns} run(s) >= 5 min`,
      detail: "Hay jobs cuyo input ya llega a Remotion con una duracion larga. La investigacion debe empezar en los datos de la pagina: assets, timeline_overrides, assembly_target_duration_seconds e input_snapshot.resolvedProps.",
    });
  }

  if (summary.p95QueueWaitMs >= QUEUE_WAIT_WARNING_MS) {
    insights.push({
      level: "warning",
      title: "Cola antes de renderizar",
      metric: `p95 espera ${Math.round(summary.p95QueueWaitMs / 1000)}s`,
      detail: "Los jobs tardan en ser reclamados por un worker. Revisa capacidad disponible, workers offline, preferred_worker_id y max_concurrent_jobs antes de optimizar Remotion.",
    });
  }

  if (summary.p95RenderVideoRatio >= SLOW_RENDER_RATIO_WARNING) {
    insights.push({
      level: "warning",
      title: "Render lento contra duracion del video",
      metric: `p95 ${summary.p95RenderVideoRatio.toFixed(1)}x`,
      detail: "El tiempo de procesamiento esta creciendo mas que la duracion final. Conviene comparar composiciones, bitrate, aceleracion de Chromium y uso CPU/GPU por equipo.",
    });
  }

  if (memoryPressureRuns > 0) {
    insights.push({
      level: "warning",
      title: "Presion de memoria detectada",
      metric: `${memoryPressureRuns} run(s)`,
      detail: "Algunos renders llegan a un uso alto de RAM del sistema. Reduce concurrencia del worker o revisa assets pesados antes de subir max_concurrent_jobs.",
    });
  }

  if (cpuPressureRuns > gpuPressureRuns && cpuPressureRuns > 0) {
    insights.push({
      level: "info",
      title: "Cuello principal en CPU",
      metric: `${cpuPressureRuns} run(s)`,
      detail: "La muestra apunta a saturacion de CPU. Para ese equipo, subir concurrencia probablemente empeore tiempos si no hay cola real que lo justifique.",
    });
  }

  if (gpuPressureRuns >= cpuPressureRuns && gpuPressureRuns > 0) {
    insights.push({
      level: "info",
      title: "Cuello principal en GPU",
      metric: `${gpuPressureRuns} run(s)`,
      detail: "La muestra apunta a saturacion de GPU. Revisa chromium_gl, hardware_acceleration y composiciones con videos simultaneos.",
    });
  }

  if (failureRate >= 0.15) {
    insights.push({
      level: "critical",
      title: "Tasa de fallos elevada",
      metric: `${Math.round(failureRate * 100)}%`,
      detail: "La prioridad es estabilizar errores antes de optimizar velocidad. Agrupa por error_message, plantilla y worker para separar fallos de datos vs. fallos del equipo.",
    });
  }

  if (summary.sampledRuns === 0 && summary.totalRuns > 0) {
    insights.push({
      level: "warning",
      title: "Telemetria incompleta",
      metric: "0 runs con samples",
      detail: "Los runs existen, pero no hay muestras de CPU/GPU/RAM. El worker debe seguir enviando samples para que el diagnostico sea confiable.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      level: "info",
      title: "Sin cuello evidente en la muestra",
      metric: `${summary.totalRuns} run(s)`,
      detail: "La muestra reciente no muestra duraciones anormales, colas altas ni saturacion clara. Mantener monitoreo con mas volumen antes de cambiar configuracion.",
    });
  }

  return insights.slice(0, 6);
}

function resolveRunStatus(rowStatus: string, job: ProductionJobRow | null | undefined) {
  if (rowStatus !== "running" || !job?.status) return rowStatus;

  const normalizedStatus = job.status.toUpperCase();
  if (normalizedStatus === "SUCCEEDED" || normalizedStatus === "COMPLETED") return "completed";
  if (normalizedStatus === "FAILED") return "failed";
  if (normalizedStatus === "CANCELLED" || normalizedStatus === "CANCELED") return "interrupted";
  return rowStatus;
}

function resolveElapsedMs(row: WorkerTelemetryRunRow, finishedAt: string | null) {
  const storedElapsedMs = row.elapsed_ms === null || row.elapsed_ms === undefined
    ? null
    : toFiniteNumber(row.elapsed_ms, 0);

  if (storedElapsedMs !== null && storedElapsedMs > 0) return storedElapsedMs;
  if (!finishedAt) return null;

  const computedElapsedMs = new Date(finishedAt).getTime() - new Date(row.started_at).getTime();
  return Number.isFinite(computedElapsedMs) && computedElapsedMs > 0
    ? computedElapsedMs
    : storedElapsedMs;
}

async function loadRowsById<T extends { id: string }>(
  admin: SupabaseAdminClient,
  table: string,
  select: string,
  ids: string[],
) {
  if (ids.length === 0) return new Map<string, T>();

  const { data, error } = await admin.from(table).select(select).in("id", ids);
  if (error) {
    console.error(`[WorkerTelemetry] Error loading ${table}:`, error.message);
    return new Map<string, T>();
  }

  return new Map(((data || []) as unknown as T[]).map((row) => [row.id, row]));
}

async function resolveTelemetryAccess(organizationSlug?: string | null) {
  const tenant = organizationSlug
    ? await resolveTenantContext(organizationSlug) || await resolveActiveTenantContext()
    : await resolveActiveTenantContext();
  if (tenant) {
    if (!isUuid(tenant.organizationId)) {
      const resolvedOrganizationId = await resolveOrganizationIdBySlug(organizationSlug || tenant.organizationId);
      return {
        organizationId: resolvedOrganizationId,
        role: tenant.platformRole,
      };
    }

    return {
      organizationId: tenant.organizationId,
      role: tenant.platformRole,
    };
  }

  if (organizationSlug) {
    const organizationId = await resolveOrganizationIdBySlug(organizationSlug);
    if (organizationId) {
      return {
        organizationId,
        role: null,
      };
    }
  }

  const organizationId = await getActiveOrganizationId();
  return {
    organizationId: isUuid(organizationId) ? organizationId : null,
    role: null,
  };
}

async function resolveOrganizationIdBySlug(organizationSlug: string | null | undefined) {
  if (!organizationSlug) return null;

  const organizationIdFromSession = await resolveOrganizationIdFromSessionOrganizations(organizationSlug);
  if (isUuid(organizationIdFromSession)) return organizationIdFromSession;

  const { data: organization } = await getServiceRoleClient()
    .from("organizations")
    .select("id")
    .ilike("slug", organizationSlug)
    .maybeSingle();

  return isUuid(organization?.id) ? organization.id : null;
}

async function resolveOrganizationIdFromSessionOrganizations(value: string | null | undefined) {
  if (!value) return null;

  const normalized = value.trim().toLowerCase();
  const organizations = await getUserOrganizations();
  const organization = organizations.find((item) => {
    return (
      item.id === value ||
      item.slug?.trim().toLowerCase() === normalized ||
      item.name?.trim().toLowerCase() === normalized
    );
  });

  return organization?.id || null;
}

function formatWorkerPlatform(worker: { platform?: string | null; arch?: string | null }) {
  return [worker.platform, worker.arch].filter(Boolean).join(" · ") || "Sin metadata";
}

export async function loadWorkerTelemetryPageData(organizationSlug?: string | null): Promise<WorkerTelemetryPageData> {
  const access = await resolveTelemetryAccess(organizationSlug);
  const admin = getServiceRoleClient();
  let role = access.role;

  if (!role) {
    const supabase = await createClient();
    const authenticatedUser = await getAuthenticatedUser(supabase);
    const bridgeUser = authenticatedUser ? null : await getAuthBridgeUser();
    const userId = authenticatedUser?.userId || bridgeUser?.id;

    if (userId) {
      const { data: profile } = await admin
        .from("profiles")
        .select("platform_role")
        .eq("id", userId)
        .maybeSingle();
      role = profile?.platform_role || bridgeUser?.platform_role || null;
    }
  }

  if (!ADMIN_ROLES.has(role || "")) {
    redirect("/login?error=unauthorized");
  }

  let query = admin
    .from("render_worker_job_runs")
    .select(
      "id, worker_id, organization_id, remote_table, remote_job_id, job_type, status, started_at, finished_at, elapsed_ms, last_stage, last_progress_percent, sample_count, avg_app_cpu_percent, max_app_cpu_percent, avg_app_gpu_percent, max_app_gpu_percent, avg_system_cpu_percent, max_system_cpu_percent, avg_system_gpu_percent, max_system_gpu_percent, max_system_memory_used_bytes, memory_total_bytes, cpu_model, cpu_logical_threads, gpu_adapters, platform, arch, artifact_id, material_component_id, template_version_id, render_batch_id, composition_id, error_code, error_message",
    )
    .order("started_at", { ascending: false })
    .limit(RUN_LIMIT);

  if (access.organizationId) {
    query = query.eq("organization_id", access.organizationId);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[WorkerTelemetry] Error loading runs:", error.message);
  }

  const rows = ((data || []) as WorkerTelemetryRunRow[]);
  const workersById = await loadRowsById<RenderWorkerRow>(
    admin,
    "render_workers",
    "id, device_name, status, platform, arch, app_version",
    uniq(rows.map((row) => row.worker_id)),
  );

  const linkedWorkers = access.organizationId
    ? await new DesktopWorkerControlPlane(admin).listWorkers(access.organizationId)
    : [];

  const { data: linkCodeRows, error: linkCodeError } = access.organizationId
    ? await admin
      .from("render_worker_link_codes")
      .select("id, code_last4, device_name, platform, arch, app_version, expires_at, consumed_at, created_at")
      .eq("organization_id", access.organizationId)
      .is("consumed_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(5)
    : { data: [], error: null };

  if (linkCodeError) {
    console.error("[WorkerTelemetry] Error loading link codes:", linkCodeError.message);
  }
  const artifactsById = await loadRowsById<ArtifactRow>(
    admin,
    "artifacts",
    "id, title",
    uniq(rows.map((row) => row.artifact_id)),
  );
  const componentsById = await loadRowsById<MaterialComponentRow>(
    admin,
    "material_components",
    "id, type",
    uniq(rows.map((row) => row.material_component_id)),
  );
  const productionJobsById = await loadRowsById<ProductionJobRow>(
    admin,
    "production_jobs",
    "id, status, created_at, claimed_at, started_at, completed_at, failed_at, duration_seconds, input_snapshot",
    uniq(rows.filter((row) => row.remote_table === "production_jobs").map((row) => row.remote_job_id)),
  );

  const runs = rows.map((row) => {
    const worker = workersById.get(row.worker_id);
    const artifact = row.artifact_id ? artifactsById.get(row.artifact_id) : null;
    const component = row.material_component_id
      ? componentsById.get(row.material_component_id)
      : null;
    const productionJob = row.remote_table === "production_jobs"
      ? productionJobsById.get(row.remote_job_id)
      : null;
    const finishedAt = row.finished_at || getTerminalProductionJobFinishedAt(productionJob);
    const elapsedMs = resolveElapsedMs(row, finishedAt);
    const status = resolveRunStatus(row.status, productionJob);
    const queueWaitMs = resolveQueueWaitMs(productionJob);
    const resolvedDurationSeconds = resolveProductionJobDurationSeconds(productionJob);
    const renderVideoRatio = resolveRenderVideoRatio(elapsedMs, resolvedDurationSeconds);
    const metrics = {
      elapsedMs,
      maxAppCpuPercent: toFiniteNumber(row.max_app_cpu_percent),
      maxAppGpuPercent: toFiniteNumber(row.max_app_gpu_percent),
      maxSystemCpuPercent: toFiniteNumber(row.max_system_cpu_percent),
      maxSystemGpuPercent: toFiniteNumber(row.max_system_gpu_percent),
      maxSystemMemoryUsedBytes: toFiniteNumber(row.max_system_memory_used_bytes),
      memoryTotalBytes: toFiniteNumber(row.memory_total_bytes),
    };

    return {
      id: row.id,
      workerName: worker?.device_name || "SofLIA Render Worker",
      workerStatus: worker?.status || "UNKNOWN",
      jobLabel: `${row.remote_table}:${row.remote_job_id.slice(0, 8)}`,
      jobType: row.job_type,
      status,
      startedAt: row.started_at,
      finishedAt,
      elapsedMs,
      queueWaitMs,
      resolvedDurationSeconds,
      renderVideoRatio,
      bottleneckLabel: resolveBottleneckLabel(metrics),
      lastStage: row.last_stage || null,
      progressPercent:
        row.last_progress_percent === null || row.last_progress_percent === undefined
          ? null
          : toFiniteNumber(row.last_progress_percent),
      sampleCount: toFiniteNumber(row.sample_count),
      avgAppCpuPercent: toFiniteNumber(row.avg_app_cpu_percent),
      maxAppCpuPercent: metrics.maxAppCpuPercent,
      avgAppGpuPercent: toFiniteNumber(row.avg_app_gpu_percent),
      maxAppGpuPercent: metrics.maxAppGpuPercent,
      avgSystemCpuPercent: toFiniteNumber(row.avg_system_cpu_percent),
      maxSystemCpuPercent: metrics.maxSystemCpuPercent,
      avgSystemGpuPercent: toFiniteNumber(row.avg_system_gpu_percent),
      maxSystemGpuPercent: metrics.maxSystemGpuPercent,
      maxSystemMemoryUsedBytes: metrics.maxSystemMemoryUsedBytes,
      memoryTotalBytes: metrics.memoryTotalBytes,
      cpuLabel: [row.cpu_model, row.cpu_logical_threads ? `${row.cpu_logical_threads} hilos` : null]
        .filter(Boolean)
        .join(" · ") || "CPU no reportado",
      gpuLabel: getGpuLabel(row.gpu_adapters),
      artifactTitle: artifact?.title || null,
      componentType: component?.type || null,
      platformLabel: [worker?.platform || row.platform, worker?.arch || row.arch, worker?.app_version]
        .filter(Boolean)
        .join(" · ") || "Sin metadata",
      errorText: row.error_message || row.error_code || null,
    } satisfies WorkerTelemetryRunView;
  });

  const completedRuns = runs.filter((run) => run.status === "completed").length;
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "interrupted").length;
  const runningRuns = runs.filter((run) => run.status === "running").length;
  const elapsedRuns = runs.filter((run) => run.elapsedMs !== null && run.elapsedMs > 0);
  const elapsedValues = elapsedRuns.map((run) => run.elapsedMs || 0);
  const queueWaitValues = runs
    .map((run) => run.queueWaitMs)
    .filter((value): value is number => value !== null && value > 0);
  const renderVideoRatioValues = runs
    .map((run) => run.renderVideoRatio)
    .filter((value): value is number => value !== null && value > 0);
  const avgElapsedMs = elapsedRuns.length
    ? elapsedRuns.reduce((total, run) => total + (run.elapsedMs || 0), 0) / elapsedRuns.length
    : 0;
  const summary: WorkerTelemetrySummary = {
    avgElapsedMs,
    avgRenderVideoRatio: average(renderVideoRatioValues),
    completedRuns,
    failedRuns,
    longDurationRuns: runs.filter((run) => (run.resolvedDurationSeconds || 0) >= LONG_RESOLVED_VIDEO_SECONDS).length,
    p95ElapsedMs: percentile(elapsedValues, 95),
    p95QueueWaitMs: percentile(queueWaitValues, 95),
    p95RenderVideoRatio: percentile(renderVideoRatioValues, 95),
    queueWaitRuns: queueWaitValues.length,
    runningRuns,
    sampledRuns: runs.filter((run) => run.sampleCount > 0).length,
    totalRuns: runs.length,
    workerCount: new Set(runs.map((run) => run.workerName)).size,
  };

  return {
    linkCodes: ((linkCodeRows || []) as RenderWorkerLinkCodeRow[]).map((code) => ({
      id: code.id,
      codeLast4: code.code_last4,
      deviceName: code.device_name || null,
      platformLabel: formatWorkerPlatform(code),
      expiresAt: code.expires_at,
      createdAt: code.created_at,
    })),
    organizationId: access.organizationId,
    optimizationInsights: buildOptimizationInsights(runs, summary),
    role,
    runs,
    summary,
    workers: (linkedWorkers as any[]).map((worker) => ({
      id: worker.id,
      name: worker.device_name || "SofLIA Render Worker",
      status: worker.status || "UNKNOWN",
      platformLabel: formatWorkerPlatform(worker),
      appVersion: worker.app_version || "Sin version",
      tokenLast4: worker.token_last4 || "----",
      maxConcurrentJobs: toFiniteNumber(worker.max_concurrent_jobs, 1),
      runningJobs: toFiniteNumber(worker.running_jobs),
      availableSlots: toFiniteNumber(worker.available_slots),
      isPrimaryBundleWorker: worker.is_primary_bundle_worker === true,
      createdAt: worker.created_at,
      lastHeartbeatAt: worker.last_heartbeat_at || null,
    })),
  };
}
