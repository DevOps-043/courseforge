import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Cpu,
  Gauge,
  MonitorCog,
  Server,
} from "lucide-react";
import type React from "react";
import { WorkerLinkingPanel } from "./WorkerLinkingPanel";
import {
  loadWorkerTelemetryPageData,
  type WorkerTelemetryInsight,
  type WorkerTelemetryRunView,
} from "./worker-telemetry-page-data";

export const dynamic = "force-dynamic";
const DISPLAY_TIME_ZONE = "America/Mexico_City";

function formatDuration(milliseconds: number | null) {
  if (!milliseconds || milliseconds <= 0) return "Sin cerrar";
  const totalSeconds = Math.round(milliseconds / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function formatMetricDuration(milliseconds: number | null, emptyLabel = "Sin datos") {
  if (!milliseconds || milliseconds <= 0) return emptyLabel;
  return formatDuration(milliseconds);
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(new Date(value));
}

function formatBytes(bytes: number) {
  if (!bytes || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex >= 3 ? 1 : 0)} ${units[unitIndex]}`;
}

function formatPercent(value: number) {
  return `${Math.round(value * 10) / 10}%`;
}

function formatSecondsDuration(seconds: number | null) {
  if (!seconds || seconds <= 0) return "Sin duracion";
  return formatDuration(seconds * 1000);
}

function formatRatio(value: number | null) {
  if (!value || value <= 0) return "Sin ratio";
  return `${value.toFixed(value >= 10 ? 0 : 1)}x`;
}

function translateJobType(value: string) {
  if (value === "template_build") return "Build plantilla";
  if (value === "template_preview") return "Preview plantilla";
  return "Ensamblado";
}

function translateStatus(value: string) {
  const labels: Record<string, string> = {
    completed: "Completado",
    confirm_pending: "Confirmacion pendiente",
    failed: "Fallido",
    interrupted: "Interrumpido",
    running: "En ejecucion",
    upload_pending: "Subida pendiente",
  };

  return labels[value] || value;
}

function statusClasses(value: string) {
  if (value === "completed") return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (value === "failed" || value === "interrupted") return "bg-red-500/10 text-red-700 dark:text-red-300";
  return "bg-blue-500/10 text-blue-700 dark:text-blue-300";
}

function insightClasses(level: WorkerTelemetryInsight["level"]) {
  if (level === "critical") return "border-red-200 bg-red-50 text-red-800 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-200";
  if (level === "warning") return "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-200";
  return "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-200";
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  hint: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#6C757D]/10 dark:bg-[#151A21]">
      <div className="mb-4 flex items-center justify-between">
        <div className="rounded-lg border border-gray-100 bg-gray-50 p-2 text-[#00A98F] dark:border-[#6C757D]/10 dark:bg-[#0F1419] dark:text-[#00D4B3]">
          {icon}
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-[#94A3B8]">{hint}</span>
      </div>
      <p className="text-sm text-gray-500 dark:text-[#94A3B8]">{label}</p>
      <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{value}</p>
    </div>
  );
}

function OptimizationInsightCard({ insight }: { insight: WorkerTelemetryInsight }) {
  return (
    <div className={`rounded-lg border p-4 ${insightClasses(insight.level)}`}>
      <div className="mb-2 flex items-start justify-between gap-3">
        <h3 className="text-sm font-bold">{insight.title}</h3>
        <span className="shrink-0 rounded-full bg-white/70 px-2 py-1 text-[11px] font-semibold text-gray-700 dark:bg-black/20 dark:text-white">
          {insight.metric}
        </span>
      </div>
      <p className="text-sm leading-5 opacity-90">{insight.detail}</p>
    </div>
  );
}

function TelemetryRunRow({ run }: { run: WorkerTelemetryRunView }) {
  return (
    <tr className="border-t border-gray-100 align-top dark:border-white/5">
      <td className="px-4 py-4">
        <div className="space-y-1">
          <p className="font-medium text-gray-900 dark:text-white">{translateJobType(run.jobType)}</p>
          <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{run.artifactTitle || run.jobLabel}</p>
          {run.componentType && (
            <span className="inline-flex rounded-full bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-600 dark:bg-white/5 dark:text-slate-300">
              {run.componentType}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="space-y-1">
          <p className="font-medium text-gray-900 dark:text-white">{run.workerName}</p>
          <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{run.platformLabel}</p>
          <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{run.cpuLabel}</p>
          <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{run.gpuLabel}</p>
        </div>
      </td>
      <td className="px-4 py-4">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusClasses(run.status)}`}>
          {translateStatus(run.status)}
        </span>
        <p className="mt-2 text-xs text-gray-500 dark:text-[#94A3B8]">{run.lastStage || "Sin etapa"}</p>
        {run.progressPercent !== null && (
          <p className="text-xs text-gray-500 dark:text-[#94A3B8]">{formatPercent(run.progressPercent)}</p>
        )}
      </td>
      <td className="px-4 py-4">
        <p className="font-medium text-gray-900 dark:text-white">{formatDuration(run.elapsedMs)}</p>
        <p className="mt-1 text-xs text-gray-500 dark:text-[#94A3B8]">{formatDateTime(run.startedAt)}</p>
        <div className="mt-2 grid gap-1 text-xs text-gray-500 dark:text-[#94A3B8]">
          <span>Cola: {formatMetricDuration(run.queueWaitMs)}</span>
          <span>Video: {formatSecondsDuration(run.resolvedDurationSeconds)}</span>
          <span>Ratio render/video: {formatRatio(run.renderVideoRatio)}</span>
        </div>
      </td>
      <td className="px-4 py-4">
        <div className="grid gap-1 text-xs text-gray-600 dark:text-[#94A3B8]">
          <span>Diagnostico: {run.bottleneckLabel}</span>
          <span>CPU app prom/max: {formatPercent(run.avgAppCpuPercent)} / {formatPercent(run.maxAppCpuPercent)}</span>
          <span>GPU app prom/max: {formatPercent(run.avgAppGpuPercent)} / {formatPercent(run.maxAppGpuPercent)}</span>
          <span>CPU sistema max: {formatPercent(run.maxSystemCpuPercent)}</span>
          <span>GPU sistema max: {formatPercent(run.maxSystemGpuPercent)}</span>
          <span>RAM max: {formatBytes(run.maxSystemMemoryUsedBytes)} / {formatBytes(run.memoryTotalBytes)}</span>
          <span>Samples: {run.sampleCount}</span>
        </div>
      </td>
      <td className="px-4 py-4">
        {run.errorText ? (
          <p className="max-w-[220px] text-xs text-red-600 dark:text-red-300">{run.errorText}</p>
        ) : (
          <span className="text-xs text-gray-400 dark:text-slate-500">Sin error</span>
        )}
      </td>
    </tr>
  );
}

export default async function WorkerTelemetryPage({
  params,
  searchParams,
}: {
  params?: Promise<{ empresaSlug?: string }>;
  searchParams?: Promise<{ workerLinkCode?: string }>;
}) {
  const queryParams = searchParams ? await searchParams : {};
  const routeParams = params ? await params : {};
  const { linkCodes, optimizationInsights, organizationId, runs, summary, workers } = await loadWorkerTelemetryPageData(routeParams.empresaSlug);
  const organizationSlug = routeParams.empresaSlug || null;
  const newLinkCode = typeof queryParams.workerLinkCode === "string" ? queryParams.workerLinkCode : null;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">Rendimiento de Workers</h1>
        <p className="max-w-3xl text-gray-600 dark:text-[#94A3B8]">
          Historial operativo de ensamblados, builds y previews ejecutados por workers locales.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <SummaryCard icon={<Activity size={22} />} label="Ejecuciones" value={summary.totalRuns.toLocaleString()} hint="ultimas 50" />
        <SummaryCard icon={<CheckCircle2 size={22} />} label="Completadas" value={summary.completedRuns.toLocaleString()} hint="finalizadas" />
        <SummaryCard icon={<Clock3 size={22} />} label="Tiempo promedio" value={formatMetricDuration(summary.avgElapsedMs)} hint="runs cerrados" />
        <SummaryCard icon={<Gauge size={22} />} label="Tiempo p95" value={formatMetricDuration(summary.p95ElapsedMs)} hint="cola excluida" />
        <SummaryCard icon={<Clock3 size={22} />} label="Cola p95" value={formatMetricDuration(summary.p95QueueWaitMs)} hint={`${summary.queueWaitRuns} con datos`} />
        <SummaryCard icon={<MonitorCog size={22} />} label="Ratio p95" value={formatRatio(summary.p95RenderVideoRatio)} hint="render/video" />
        <SummaryCard icon={<AlertTriangle size={22} />} label="Fallidas" value={summary.failedRuns.toLocaleString()} hint="requieren revision" />
        <SummaryCard icon={<Server size={22} />} label="Workers" value={summary.workerCount.toLocaleString()} hint={`${summary.sampledRuns} con samples`} />
      </div>

      <WorkerLinkingPanel
        linkCodes={linkCodes}
        newLinkCode={newLinkCode}
        organizationId={organizationId}
        organizationSlug={organizationSlug}
        workers={workers}
      />

      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-[#6C757D]/10 dark:bg-[#151A21]">
        <div className="mb-4 flex items-center gap-2">
          <Cpu className="h-5 w-5 text-[#1F5AF6]" />
          <h2 className="font-bold text-gray-900 dark:text-white">Diagnostico operativo</h2>
        </div>
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {optimizationInsights.map((insight) => (
            <OptimizationInsightCard key={`${insight.level}-${insight.title}`} insight={insight} />
          ))}
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm dark:border-[#6C757D]/10 dark:bg-[#151A21]">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 dark:border-white/5">
          <div>
            <h2 className="font-bold text-gray-900 dark:text-white">Ejecuciones recientes</h2>
            <p className="text-sm text-gray-500 dark:text-[#94A3B8]">Datos persistidos por los endpoints de telemetria del worker.</p>
          </div>
        </div>

        {runs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-[#0F1419] dark:text-[#94A3B8]">
                <tr>
                  <th className="px-4 py-3 font-semibold">Job</th>
                  <th className="px-4 py-3 font-semibold">Equipo</th>
                  <th className="px-4 py-3 font-semibold">Estado</th>
                  <th className="px-4 py-3 font-semibold">Tiempo</th>
                  <th className="px-4 py-3 font-semibold">Consumo</th>
                  <th className="px-4 py-3 font-semibold">Error</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <TelemetryRunRow key={run.id} run={run} />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-5 py-12 text-center">
            <p className="font-medium text-gray-900 dark:text-white">Todavia no hay telemetria almacenada.</p>
            <p className="mt-2 text-sm text-gray-500 dark:text-[#94A3B8]">
              Cuando un worker ejecute un ensamblado, build o preview, los runs apareceran aqui.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
