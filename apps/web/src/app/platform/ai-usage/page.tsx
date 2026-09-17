import Link from "next/link";
import { Activity, Bot, CircleDollarSign, Clock3, Database, Search, TriangleAlert, Zap } from "lucide-react";
import { loadAiUsageDashboard, type AiUsagePeriod } from "@/lib/server/ai-usage-dashboard";
import { requirePlatformPermission } from "@/lib/server/platform-authorization";
import { PLATFORM_PERMISSIONS } from "@/utils/auth/platform-permissions";

export const dynamic = "force-dynamic";

const PERIODS: Array<{ id: AiUsagePeriod; label: string }> = [
  { id: "day", label: "24 horas" },
  { id: "week", label: "7 días" },
  { id: "month", label: "30 días" },
];

const STEP_LABELS: Record<string, string> = {
  BASE: "Base del curso",
  CURATION: "Curaduría de fuentes",
  MATERIALS: "Materiales",
  PLAN: "Plan instruccional",
  PLAN_VALIDATION: "Validación del plan",
  SYLLABUS: "Temario",
};

function number(value: unknown) {
  return Number(value || 0);
}

function integer(value: unknown) {
  return new Intl.NumberFormat("es-MX").format(number(value));
}

function compact(value: unknown) {
  return new Intl.NumberFormat("es-MX", { notation: "compact", maximumFractionDigits: 1 }).format(number(value));
}

function dateTime(value: string | null) {
  if (!value) return "Sin actividad registrada";
  return new Intl.DateTimeFormat("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "America/Mexico_City",
  }).format(new Date(value));
}

function MetricCard({ icon, label, value, detail }: {
  detail: string;
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.13em] text-slate-500">{label}</p>
          <p className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{value}</p>
          <p className="mt-2 text-xs text-slate-500">{detail}</p>
        </div>
        <span className="rounded-xl bg-teal-50 p-2.5 text-teal-700">{icon}</span>
      </div>
    </article>
  );
}

export default async function AiUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  await requirePlatformPermission(PLATFORM_PERMISSIONS.AI_USAGE_READ);
  const requestedPeriod = (await searchParams).period;
  const period: AiUsagePeriod = requestedPeriod === "day" || requestedPeriod === "month"
    ? requestedPeriod
    : "week";
  const { data, error, window } = await loadAiUsageDashboard(period);
  const summary = data.summary;
  const maxBucketTokens = Math.max(1, ...data.buckets.map((bucket) => number(bucket.total_tokens)));
  const failureRate = number(summary.requests)
    ? (number(summary.failed_requests) / number(summary.requests)) * 100
    : 0;
  const displayedCost = summary.actual_cost_usd ?? summary.estimated_cost_usd;
  const costDetail = summary.actual_cost_usd != null
    ? "Costo real conciliado con el proveedor"
    : summary.estimated_cost_usd != null
      ? "Estimación con precios versionados"
      : "Requiere precios o conciliación administrativa";

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 pb-12">
      <header className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-950 via-slate-900 to-teal-950 px-6 py-7 text-white shadow-xl sm:px-8">
        <div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
          <div>
            <div className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">
              <Activity size={16} /> Observabilidad de plataforma
            </div>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Consumo de IA</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
              Tokens, búsquedas y estabilidad por etapa del pipeline. Las métricas son globales y no incluyen prompts ni contenido generado.
            </p>
          </div>
          <nav className="flex rounded-xl border border-white/10 bg-white/5 p-1" aria-label="Periodo">
            {PERIODS.map((item) => (
              <Link
                key={item.id}
                className={`rounded-lg px-3 py-2 text-sm transition ${period === item.id ? "bg-white text-slate-950 shadow" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}
                href={`/platform/ai-usage?period=${item.id}`}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {error && (
        <div className="flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <TriangleAlert className="mt-0.5 shrink-0" size={18} />
          <div>
            <p className="font-semibold">La estructura de monitoreo aún no está disponible en la base conectada.</p>
            <p className="mt-1 text-amber-800">Aplica la migración de consumo de IA. El panel permanecerá vacío hasta entonces.</p>
          </div>
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard icon={<Zap size={20} />} label="Tokens totales" value={compact(summary.total_tokens)} detail={`${integer(summary.input_tokens)} entrada · ${integer(summary.output_tokens)} salida`} />
        <MetricCard icon={<Bot size={20} />} label="Interacciones" value={integer(summary.requests)} detail={`${failureRate.toFixed(1)}% con fallo`} />
        <MetricCard icon={<Search size={20} />} label="Búsquedas web" value={integer(summary.web_search_calls)} detail="Llamadas registradas por el proveedor" />
        <MetricCard icon={<CircleDollarSign size={20} />} label="Costo del periodo" value={displayedCost == null ? "Pendiente" : `$${number(displayedCost).toFixed(4)}`} detail={costDetail} />
      </section>

      <section className="grid gap-6 xl:grid-cols-[1.55fr_1fr]">
        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-slate-950">Actividad del periodo</h2>
              <p className="mt-1 text-xs text-slate-500">{dateTime(window.start)} — {dateTime(window.end)}</p>
            </div>
            <Clock3 className="text-slate-400" size={20} />
          </div>
          {data.buckets.length === 0 ? (
            <div className="mt-6 flex min-h-52 flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 text-center">
              <Database className="text-slate-400" size={28} />
              <p className="mt-3 font-medium text-slate-700">Aún no hay consumo instrumentado en este periodo.</p>
              <p className="mt-1 text-sm text-slate-500">Los nuevos procesos aparecerán aquí automáticamente.</p>
            </div>
          ) : (
            <div className="mt-8 flex min-h-52 items-end gap-3 border-b border-slate-200 pb-2">
              {data.buckets.map((bucket) => {
                const height = Math.max(8, (number(bucket.total_tokens) / maxBucketTokens) * 180);
                return (
                  <div className="group flex min-w-0 flex-1 flex-col items-center gap-2" key={bucket.bucket_start}>
                    <span className="text-[10px] font-medium text-slate-500 opacity-0 transition group-hover:opacity-100">{compact(bucket.total_tokens)}</span>
                    <div className="w-full max-w-12 rounded-t-lg bg-gradient-to-t from-teal-600 to-cyan-400" style={{ height }} title={`${integer(bucket.total_tokens)} tokens`} />
                    <span className="max-w-full truncate text-[10px] text-slate-500">{new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", timeZone: "America/Mexico_City" }).format(new Date(bucket.bucket_start))}</span>
                  </div>
                );
              })}
            </div>
          )}
        </article>

        <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="text-lg font-semibold text-slate-950">Por proveedor</h2>
          <div className="mt-5 space-y-4">
            {data.by_provider.length === 0 && <p className="text-sm text-slate-500">Sin actividad para comparar.</p>}
            {data.by_provider.map((item) => {
              const share = number(summary.total_tokens) ? (number(item.total_tokens) / number(summary.total_tokens)) * 100 : 0;
              return (
                <div key={item.provider}>
                  <div className="flex justify-between text-sm"><span className="font-medium capitalize text-slate-800">{item.provider}</span><span className="text-slate-500">{compact(item.total_tokens)} tokens</span></div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-teal-500" style={{ width: `${share}%` }} /></div>
                  <p className="mt-1.5 text-xs text-slate-500">{integer(item.requests)} interacciones · {integer(item.web_search_calls)} búsquedas</p>
                </div>
              );
            })}
          </div>
          <div className="mt-6 border-t border-slate-100 pt-4 text-xs text-slate-500">Último evento: {dateTime(summary.last_event_at)}</div>
        </article>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-6"><h2 className="text-lg font-semibold text-slate-950">Consumo por etapa</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500"><tr><th className="px-6 py-3">Etapa</th><th className="px-6 py-3">Tokens</th><th className="px-6 py-3">Interacciones</th><th className="px-6 py-3">Búsquedas</th><th className="px-6 py-3">Fallos</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.by_step.map((item) => <tr key={item.pipeline_step}><td className="px-6 py-4 font-medium text-slate-900">{STEP_LABELS[item.pipeline_step || ""] || item.pipeline_step}</td><td className="px-6 py-4 text-slate-600">{integer(item.total_tokens)}</td><td className="px-6 py-4 text-slate-600">{integer(item.requests)}</td><td className="px-6 py-4 text-slate-600">{integer(item.web_search_calls)}</td><td className="px-6 py-4 text-slate-600">{integer(item.failed_requests)}</td></tr>)}
              {data.by_step.length === 0 && <tr><td className="px-6 py-8 text-center text-slate-500" colSpan={5}>No hay etapas registradas todavía.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
