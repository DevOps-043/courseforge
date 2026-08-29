import Link from "next/link";
import {
  ArrowLeft,
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  FileCode2,
  FileText,
  Gauge,
  GitBranch,
  Layers3,
  ShieldCheck,
} from "lucide-react";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { resolveActiveTenantContext } from "@/lib/server/tenant-context";
import {
  PRODUCTION_ASSET_TYPES,
  PRODUCTION_PROVIDERS,
} from "@/domains/production/types/production.types";
import {
  SofliaEngineSlidesGenerator,
  type SlideGenerationCandidate,
} from "./SofliaEngineSlidesGenerator";

export const dynamic = "force-dynamic";

type SlidesSearchParams = {
  artifactId?: string | string[];
  componentId?: string | string[];
  returnTo?: string | string[];
};

interface RecentSlideDeck {
  artifactId: string;
  createdAt: string;
  findingCount: number;
  id: string;
  materialComponentId: string | null;
  status: "PASS" | "WARN" | "FAIL" | "UNKNOWN";
  storagePath: string | null;
  template: string;
}

interface MaterialComponentCandidateRow {
  assets?: Record<string, unknown> | null;
  id: string;
  material_lessons?:
    | {
        lesson_title?: string | null;
        materials?:
          | {
              artifact_id?: string | null;
              artifacts?:
                | {
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }
                | Array<{
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }>
                | null;
            }
          | Array<{
              artifact_id?: string | null;
              artifacts?:
                | {
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }
                | Array<{
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }>
                | null;
            }>
          | null;
      }
    | Array<{
        lesson_title?: string | null;
        materials?:
          | {
              artifact_id?: string | null;
              artifacts?:
                | {
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }
                | Array<{
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }>
                | null;
            }
          | Array<{
              artifact_id?: string | null;
              artifacts?:
                | {
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }
                | Array<{
                    idea_central?: string | null;
                    organization_id?: string | null;
                  }>
                | null;
            }>
          | null;
      }>
    | null;
  type?: string | null;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function getNestedCandidateData(row: MaterialComponentCandidateRow) {
  const lesson = firstRelation(row.material_lessons);
  const material = firstRelation(lesson?.materials);
  const artifact = firstRelation(material?.artifacts);

  return {
    artifact,
    artifactId: material?.artifact_id || null,
    lesson,
  };
}

function normalizeStatus(value: unknown): RecentSlideDeck["status"] {
  return value === "PASS" || value === "WARN" || value === "FAIL"
    ? value
    : "UNKNOWN";
}

function toSlideGenerationCandidate(params: {
  expectedArtifactId?: string | null;
  organizationId?: string | null;
  row: MaterialComponentCandidateRow;
}): SlideGenerationCandidate | null {
  const { artifact, artifactId, lesson } = getNestedCandidateData(params.row);
  if (!artifactId) {
    return null;
  }

  if (params.expectedArtifactId && artifactId !== params.expectedArtifactId) {
    return null;
  }

  if (params.organizationId && artifact?.organization_id !== params.organizationId) {
    return null;
  }

  const qaReport = (params.row.assets?.slides as Record<string, unknown> | undefined)?.qa_report as
    | Record<string, unknown>
    | undefined;
  const slidesAssets = params.row.assets?.slides as Record<string, unknown> | undefined;
  const courseTitle = artifact?.idea_central || "Artefacto sin titulo";
  const lessonTitle = lesson?.lesson_title || "Leccion sin titulo";
  const componentType = params.row.type || "VIDEO";

  return {
    artifactId,
    componentId: params.row.id,
    componentType,
    courseTitle,
    hasPreparedSpec: Boolean(slidesAssets?.prepared_spec),
    label: `${courseTitle} / ${lessonTitle} / ${componentType.replace(/_/g, " ")}`,
    lessonTitle,
    preparedSlideCount: typeof slidesAssets?.prepared_slide_count === "number"
      ? slidesAssets.prepared_slide_count
      : null,
    qaStatus: typeof qaReport?.status === "string" ? qaReport.status : null,
  };
}

async function getRecentSlideDecks(): Promise<RecentSlideDeck[]> {
  const tenant = await resolveActiveTenantContext();
  const admin = getServiceRoleClient();

  let query = admin
    .from("production_assets")
    .select("id, artifact_id, material_component_id, storage_path, metadata, content, created_at")
    .eq("asset_type", PRODUCTION_ASSET_TYPES.SLIDE_DECK_QA_REPORT)
    .eq("provider", PRODUCTION_PROVIDERS.SOFLIA_ENGINE_SLIDES)
    .order("created_at", { ascending: false })
    .limit(8);

  query = tenant?.organizationId
    ? query.eq("organization_id", tenant.organizationId)
    : query.is("organization_id", null);

  const { data, error } = await query;
  if (error) {
    console.warn("[admin/slides] Could not load recent slide QA reports:", error.message);
    return [];
  }

  return (data || []).map((row) => {
    const metadata = (row.metadata || {}) as Record<string, unknown>;
    const content = (row.content || {}) as Record<string, unknown>;
    const summary = (content.summary || {}) as Record<string, unknown>;

    return {
      artifactId: String(row.artifact_id),
      createdAt: String(row.created_at),
      findingCount: Number(metadata.finding_count || 0),
      id: String(row.id),
      materialComponentId: row.material_component_id
        ? String(row.material_component_id)
        : null,
      status: normalizeStatus(metadata.status || content.status),
      storagePath: row.storage_path ? String(row.storage_path) : null,
      template: String(summary.template || "course-module"),
    };
  });
}

async function getSlideGenerationCandidates(): Promise<SlideGenerationCandidate[]> {
  const tenant = await resolveActiveTenantContext();
  const admin = getServiceRoleClient();

  let query = admin
    .from("material_components")
    .select(`
      id,
      type,
      assets,
      material_lessons!inner (
        lesson_title,
        materials!inner (
          artifact_id,
          artifacts!inner (
            idea_central,
            organization_id
          )
        )
      )
    `)
    .in("type", ["VIDEO_THEORETICAL", "VIDEO_DEMO", "VIDEO_GUIDE"])
    .order("updated_at", { ascending: false })
    .limit(60);

  if (tenant?.organizationId) {
    query = query.eq(
      "material_lessons.materials.artifacts.organization_id",
      tenant.organizationId,
    );
  }

  const { data, error } = await query;
  if (error) {
    console.warn("[admin/slides] Could not load slide generation candidates:", error.message);
    return [];
  }

  return ((data || []) as MaterialComponentCandidateRow[])
    .map((row) => toSlideGenerationCandidate({
      organizationId: tenant?.organizationId,
      row,
    }))
    .filter((candidate): candidate is SlideGenerationCandidate => Boolean(candidate));
}

async function getSlideGenerationCandidateByComponentId(params: {
  artifactId?: string | null;
  componentId: string | null;
}): Promise<SlideGenerationCandidate | null> {
  if (!params.componentId) {
    return null;
  }

  const tenant = await resolveActiveTenantContext();
  const admin = getServiceRoleClient();
  const { data, error } = await admin
    .from("material_components")
    .select(`
      id,
      type,
      assets,
      material_lessons!inner (
        lesson_title,
        materials!inner (
          artifact_id,
          artifacts!inner (
            idea_central,
            organization_id
          )
        )
      )
    `)
    .eq("id", params.componentId)
    .maybeSingle();

  if (error) {
    console.warn("[admin/slides] Could not load URL slide component:", error.message);
    return null;
  }

  if (!data) {
    return null;
  }

  return toSlideGenerationCandidate({
    expectedArtifactId: params.artifactId,
    organizationId: tenant?.organizationId,
    row: data as MaterialComponentCandidateRow,
  });
}

function mergeSlideGenerationCandidates(
  candidates: SlideGenerationCandidate[],
  preferredCandidate: SlideGenerationCandidate | null,
) {
  if (!preferredCandidate) {
    return candidates;
  }

  return [
    preferredCandidate,
    ...candidates.filter((candidate) => candidate.componentId !== preferredCandidate.componentId),
  ];
}

function StatusBadge({ status }: { status: RecentSlideDeck["status"] }) {
  const classes = {
    FAIL: "border-red-200 bg-red-50 text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300",
    PASS: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300",
    UNKNOWN: "border-gray-200 bg-gray-50 text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300",
    WARN: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300",
  }[status];

  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-bold ${classes}`}>
      QA {status}
    </span>
  );
}

function getSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SofliaEngineSlidesPage({
  searchParams,
}: {
  searchParams?: Promise<SlidesSearchParams>;
}) {
  const params = searchParams ? await searchParams : {};
  const initialArtifactId = getSearchParamValue(params.artifactId) || null;
  const initialComponentId = getSearchParamValue(params.componentId) || null;
  const returnTo = getSearchParamValue(params.returnTo) || null;
  const tenant = await resolveActiveTenantContext();
  const adminBasePath = tenant?.organizationSlug
    ? `/${tenant.organizationSlug}/admin`
    : "/admin";
  const backHref = returnTo || (initialArtifactId
    ? `${adminBasePath}/artifacts/${initialArtifactId}`
    : `${adminBasePath}/artifacts`);
  const [recentDecks, generationCandidates, directGenerationCandidate] = await Promise.all([
    getRecentSlideDecks(),
    getSlideGenerationCandidates(),
    getSlideGenerationCandidateByComponentId({
      artifactId: initialArtifactId,
      componentId: initialComponentId,
    }),
  ]);
  const resolvedGenerationCandidates = mergeSlideGenerationCandidates(
    generationCandidates,
    directGenerationCandidate,
  );
  const totalFindings = recentDecks.reduce(
    (total, deck) => total + deck.findingCount,
    0,
  );
  const warningOrFailed = recentDecks.filter(
    (deck) => deck.status === "WARN" || deck.status === "FAIL",
  ).length;

  return (
    <main className="space-y-6">
      <header className="engine-page-hero flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="engine-eyebrow flex items-center gap-2">
            <PresentationMark />
            Producción visual
          </div>
          <h1 className="mt-3 text-3xl">
            SofLIA - Engine Slides
          </h1>
          <p className="mt-2 max-w-3xl text-sm leading-6">
            Consola del modulo hibrido para generar diapositivas de cursos con
            plantillas HTML SofLIA, graficas SVG responsivas y QA automatico.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link
            href={backHref}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-[var(--engine-surface-solid)] dark:text-gray-200 dark:hover:bg-white/5"
          >
            <ArrowLeft size={16} />
            Regresar
          </Link>
          <Link
            href={`${adminBasePath}/artifacts`}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--engine-primary)] px-3 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-[#10395f]"
          >
            <Layers3 size={16} />
            Ir a artefactos
          </Link>
          <Link
            href={`${adminBasePath}/templates`}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-bold text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:bg-[var(--engine-surface-solid)] dark:text-gray-200 dark:hover:bg-white/5"
          >
            <FileText size={16} />
            Plantillas
          </Link>
          <Link
            href={`${adminBasePath}/slides/templates`}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--engine-accent)]/30 bg-[var(--engine-accent)]/10 px-3 py-2 text-sm font-bold text-[#007F6D] transition hover:bg-[var(--engine-accent)]/15 dark:text-[var(--engine-accent)]"
          >
            <FileCode2 size={16} />
            Crear template HTML
          </Link>
        </div>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Decks recientes</p>
            <Gauge size={16} className="text-[var(--engine-accent-strong)]" />
          </div>
          <p className="mt-3 text-3xl font-bold text-gray-950 dark:text-white">{recentDecks.length}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Con alertas</p>
            <AlertTriangle size={16} className="text-amber-500" />
          </div>
          <p className="mt-3 text-3xl font-bold text-gray-950 dark:text-white">{warningOrFailed}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
          <div className="flex items-center justify-between">
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500">Hallazgos QA</p>
            <ShieldCheck size={16} className="text-[var(--engine-accent-strong)]" />
          </div>
          <p className="mt-3 text-3xl font-bold text-gray-950 dark:text-white">{totalFindings}</p>
        </div>
      </section>

      <SofliaEngineSlidesGenerator
        candidates={resolvedGenerationCandidates}
        initialComponentId={initialComponentId}
        returnTo={returnTo}
      />

      <section className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="rounded-lg border border-gray-200 bg-white dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
          <div className="border-b border-gray-100 px-5 py-4 dark:border-white/10">
            <h2 className="text-sm font-bold text-gray-950 dark:text-white">
              Decks generados recientemente
            </h2>
          </div>

          {recentDecks.length > 0 ? (
            <div className="divide-y divide-gray-100 dark:divide-white/10">
              {recentDecks.map((deck) => (
                <div key={deck.id} className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={deck.status} />
                      <span className="text-xs font-semibold text-gray-500">
                        {deck.template}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-sm font-semibold text-gray-900 dark:text-white">
                      Artefacto {deck.artifactId}
                    </p>
                    <p className="mt-1 text-xs text-gray-500">
                      {new Date(deck.createdAt).toLocaleString("es-MX")} · {deck.findingCount} hallazgo(s)
                    </p>
                  </div>
                  <Link
                    href={`${adminBasePath}/artifacts/${deck.artifactId}`}
                    className="inline-flex items-center justify-center rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 dark:border-white/10 dark:text-gray-200 dark:hover:bg-white/5"
                  >
                    Abrir artefacto
                  </Link>
                </div>
              ))}
            </div>
          ) : (
            <div className="px-5 py-10 text-center">
              <CheckCircle2 size={26} className="mx-auto text-[var(--engine-accent-strong)]" />
              <h3 className="mt-3 text-sm font-bold text-gray-950 dark:text-white">
                Aun no hay decks generados
              </h3>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-gray-500">
                Entra a un artefacto, abre un componente de produccion visual y
                usa Generar SofLIA para crear el primer deck.
              </p>
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
            <div className="flex items-center gap-2">
              <GitBranch size={17} className="text-[var(--engine-accent-strong)]" />
              <h2 className="text-sm font-bold text-gray-950 dark:text-white">
                Pipeline activo
              </h2>
            </div>
            <ol className="mt-4 space-y-3 text-sm text-gray-600 dark:text-gray-400">
              {[
                "deck_brief",
                "slide_plan",
                "chart_data",
                "visual_direction",
                "html_render",
                "quality_gate",
              ].map((stage, index) => (
                <li key={stage} className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--engine-accent)]/10 text-xs font-bold text-[var(--engine-accent-strong)]">
                    {index + 1}
                  </span>
                  <span className="font-mono text-xs">{stage}</span>
                </li>
              ))}
            </ol>
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-5 dark:border-white/10 dark:bg-[var(--engine-surface-solid)]">
            <div className="flex items-center gap-2">
              <BarChart3 size={17} className="text-[var(--engine-accent-strong)]" />
              <h2 className="text-sm font-bold text-gray-950 dark:text-white">
                Graficas
              </h2>
            </div>
            <p className="mt-3 text-sm leading-6 text-gray-600 dark:text-gray-400">
              Las graficas se declaran en el spec y se renderizan como SVG
              responsivo dentro del deck HTML. Soporta barras, lineas, area y
              proporcion.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}

function PresentationMark() {
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-[var(--engine-accent)]/10 text-[var(--engine-accent-strong)]">
      <BarChart3 size={15} />
    </span>
  );
}
