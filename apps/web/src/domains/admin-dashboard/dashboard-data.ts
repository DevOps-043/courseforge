import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AdminDashboardData,
  AttentionItem,
  CreationTrendPoint,
  PipelineBucket,
  ProductionStatus,
  RecentArtifactItem,
} from "./types";

const DRAFT_STATES = ["DRAFT"];
const GENERATING_STATES = [
  "GENERATING",
  "VALIDATING",
  "IN_PROCESS",
  "SCORM_PARSING",
  "SCORM_ENRICHING",
  "SCORM_TRANSFORMING",
];
const REVIEW_STATES = [
  "READY_FOR_QA",
  "STEP_READY_FOR_QA",
  "STEP_READY_FOR_REVIEW",
  "PENDING_QA",
  "ESCALATED",
  "SCORM_READY_FOR_QA",
];
const APPROVED_STATES = ["APPROVED"];
const REJECTED_STATES = ["REJECTED"];

const ACTIVE_RENDER_STATUSES = ["PENDING", "QUEUED", "RUNNING", "WAITING_PROVIDER", "RETRY_SCHEDULED"];

const TREND_WINDOW_WEEKS = 8;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

interface ArtifactRow {
  id: string;
  idea_central: string | null;
  state: string;
  production_complete: boolean | null;
  updated_at: string;
  created_by: string | null;
}

interface ProfileRow {
  id: string;
  username: string | null;
  first_name: string | null;
}

interface CompositionRow {
  artifact_id: string;
  status: string;
  updated_at: string;
}

interface RenderJobRow {
  artifact_id: string;
  status: string;
  updated_at: string;
}

function getWeekStart(date: Date) {
  const weekStart = new Date(date);
  weekStart.setUTCHours(0, 0, 0, 0);
  const isoWeekday = weekStart.getUTCDay() === 0 ? 7 : weekStart.getUTCDay();
  weekStart.setUTCDate(weekStart.getUTCDate() - (isoWeekday - 1));
  return weekStart;
}

function buildWeekKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function cleanTitle(idea: string | null) {
  return (idea || "Artefacto sin nombre").replace(/^TEMA:\s*/i, "").trim();
}

function deriveProductionStatus(
  job: RenderJobRow | undefined,
  composition: CompositionRow | undefined,
): ProductionStatus | null {
  if (job) {
    if (job.status === "RUNNING" || job.status === "WAITING_PROVIDER") {
      return { label: "Renderizando video", tone: "active" };
    }
    if (ACTIVE_RENDER_STATUSES.includes(job.status)) {
      return { label: "En cola de render", tone: "active" };
    }
    if (job.status === "SUCCEEDED") {
      return { label: "Video renderizado", tone: "done" };
    }
    if (job.status === "FAILED") {
      return { label: "Render fallido", tone: "failed" };
    }
  }

  if (composition) {
    if (composition.status === "READY_FOR_RENDER") {
      return { label: "Ensamblado, listo para render", tone: "done" };
    }
    if (composition.status === "READY_FOR_PREVIEW") {
      return { label: "Video en revisión de preview", tone: "active" };
    }
    if (composition.status === "DRAFT") {
      return { label: "Ensamblando video", tone: "active" };
    }
  }

  return null;
}

function countArtifactsByState(
  supabase: SupabaseClient,
  organizationId: string | null,
  states: string[],
) {
  let query = supabase
    .from("artifacts")
    .select("id", { count: "exact", head: true })
    .in("state", states);
  if (organizationId) query = query.eq("organization_id", organizationId);
  return query.then(({ count }) => count ?? 0);
}

function countAllArtifacts(supabase: SupabaseClient, organizationId: string | null) {
  let query = supabase.from("artifacts").select("id", { count: "exact", head: true });
  if (organizationId) query = query.eq("organization_id", organizationId);
  return query.then(({ count }) => count ?? 0);
}

function countPublicationsByStatus(
  supabase: SupabaseClient,
  organizationId: string | null,
  status: string,
) {
  let query = supabase
    .from("publication_requests")
    .select("id, artifacts!inner(organization_id)", { count: "exact", head: true })
    .eq("status", status);
  if (organizationId) query = query.eq("artifacts.organization_id", organizationId);
  return query.then(({ count }) => count ?? 0);
}

export async function getAdminDashboardData(params: {
  supabase: SupabaseClient;
  organizationId: string | null;
  basePath: string;
  activeUsers: number;
}): Promise<AdminDashboardData> {
  const { supabase, organizationId, basePath, activeUsers } = params;
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * MS_PER_DAY);
  const currentWeekStart = getWeekStart(now);
  const trendStart = new Date(currentWeekStart.getTime() - (TREND_WINDOW_WEEKS - 1) * 7 * MS_PER_DAY);

  const artifactsCreatedThisWeekQuery = (async () => {
    let query = supabase
      .from("artifacts")
      .select("id", { count: "exact", head: true })
      .gte("created_at", weekAgo.toISOString());
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { count } = await query;
    return count ?? 0;
  })();

  const escalatedArtifactsQuery = (async () => {
    let query = supabase
      .from("artifacts")
      .select("id, idea_central, updated_at")
      .eq("state", "ESCALATED")
      .order("updated_at", { ascending: false })
      .limit(4);
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data } = await query;
    return (data || []) as Array<{ id: string; idea_central: string | null; updated_at: string }>;
  })();

  const rejectedPublicationsQuery = (async () => {
    let query = supabase
      .from("publication_requests")
      .select("id, artifact_id, updated_at, artifacts!inner(idea_central, organization_id)")
      .eq("status", "REJECTED")
      .order("updated_at", { ascending: false })
      .limit(3);
    if (organizationId) query = query.eq("artifacts.organization_id", organizationId);
    const { data } = await query;
    return (data || []) as Array<{
      id: string;
      artifact_id: string;
      updated_at: string;
      artifacts: { idea_central: string | null } | { idea_central: string | null }[];
    }>;
  })();

  const failedScormQuery = (async () => {
    let query = supabase
      .from("scorm_imports")
      .select("id, artifact_id, original_filename, created_at")
      .eq("status", "FAILED")
      .order("created_at", { ascending: false })
      .limit(3);
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data } = await query;
    return (data || []) as Array<{
      id: string;
      artifact_id: string | null;
      original_filename: string;
      created_at: string;
    }>;
  })();

  const generatingArtifactIdsQuery = (async () => {
    let query = supabase.from("artifacts").select("id").in("state", GENERATING_STATES);
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data } = await query;
    return (data || []).map((row) => row.id as string);
  })();

  const activeRenderArtifactIdsQuery = (async () => {
    let query = supabase
      .from("production_jobs")
      .select("artifact_id")
      .eq("job_type", "HYPERFRAMES_RENDER")
      .in("status", ACTIVE_RENDER_STATUSES);
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data } = await query;
    return (data || []).map((row) => row.artifact_id as string);
  })();

  const recentArtifactsQuery = (async () => {
    let query = supabase
      .from("artifacts")
      .select("id, idea_central, state, production_complete, updated_at, created_by")
      .order("updated_at", { ascending: false })
      .limit(6);
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data } = await query;
    return (data || []) as ArtifactRow[];
  })();

  const trendQuery = (async () => {
    let query = supabase
      .from("artifacts")
      .select("created_at")
      .gte("created_at", trendStart.toISOString());
    if (organizationId) query = query.eq("organization_id", organizationId);
    const { data } = await query;
    return (data || []) as Array<{ created_at: string }>;
  })();

  const [
    totalArtifacts,
    artifactsCreatedThisWeek,
    draftCount,
    generatingCount,
    reviewCount,
    approvedCount,
    rejectedCount,
    escalatedCount,
    publicationReadyCount,
    publicationSentCount,
    escalatedRes,
    rejectedPublicationsRes,
    failedScormRes,
    recentArtifactsRes,
    trendRes,
    generatingArtifactIds,
    activeRenderArtifactIds,
  ] = await Promise.all([
    countAllArtifacts(supabase, organizationId),
    artifactsCreatedThisWeekQuery,
    countArtifactsByState(supabase, organizationId, DRAFT_STATES),
    countArtifactsByState(supabase, organizationId, GENERATING_STATES),
    countArtifactsByState(supabase, organizationId, REVIEW_STATES),
    countArtifactsByState(supabase, organizationId, APPROVED_STATES),
    countArtifactsByState(supabase, organizationId, REJECTED_STATES),
    countArtifactsByState(supabase, organizationId, ["ESCALATED"]),
    countPublicationsByStatus(supabase, organizationId, "READY"),
    countPublicationsByStatus(supabase, organizationId, "SENT"),
    escalatedArtifactsQuery,
    rejectedPublicationsQuery,
    failedScormQuery,
    recentArtifactsQuery,
    trendQuery,
    generatingArtifactIdsQuery,
    activeRenderArtifactIdsQuery,
  ]);

  const activeRenderCount = new Set(activeRenderArtifactIds).size;
  const inProgressCount = new Set([...generatingArtifactIds, ...activeRenderArtifactIds]).size;

  const pipelineDistribution: PipelineBucket[] = [
    { key: "DRAFT", label: "Borrador", count: draftCount, colorVar: "--engine-muted" },
    { key: "GENERATING", label: "En generación", count: generatingCount, colorVar: "--engine-info" },
    { key: "REVIEW", label: "Pendiente revisión", count: reviewCount, colorVar: "--engine-warning" },
    { key: "APPROVED", label: "Aprobado", count: approvedCount, colorVar: "--engine-success" },
    { key: "REJECTED", label: "Rechazado", count: rejectedCount, colorVar: "--engine-danger" },
  ];

  const trendBuckets = new Map<string, number>();
  for (let i = 0; i < TREND_WINDOW_WEEKS; i += 1) {
    const weekStart = new Date(trendStart.getTime() + i * 7 * MS_PER_DAY);
    trendBuckets.set(buildWeekKey(weekStart), 0);
  }
  trendRes.forEach((row) => {
    const key = buildWeekKey(getWeekStart(new Date(row.created_at)));
    if (trendBuckets.has(key)) {
      trendBuckets.set(key, (trendBuckets.get(key) || 0) + 1);
    }
  });
  const creationTrend: CreationTrendPoint[] = Array.from(trendBuckets.entries()).map(
    ([date, count]) => ({
      date,
      label: new Date(`${date}T00:00:00Z`).toLocaleDateString("es-MX", {
        day: "numeric",
        month: "short",
        timeZone: "UTC",
      }),
      count,
    }),
  );

  const attentionItems: AttentionItem[] = [
    ...escalatedRes.map<AttentionItem>((row) => ({
      type: "ESCALATED",
      id: row.id,
      title: cleanTitle(row.idea_central),
      timestamp: row.updated_at,
      href: `${basePath}/artifacts/${row.id}`,
    })),
    ...rejectedPublicationsRes.map<AttentionItem>((row) => {
      const artifactRelation = Array.isArray(row.artifacts) ? row.artifacts[0] : row.artifacts;
      return {
        type: "PUBLICATION_REJECTED",
        id: row.id,
        title: cleanTitle(artifactRelation?.idea_central ?? null),
        timestamp: row.updated_at,
        href: `${basePath}/artifacts/${row.artifact_id}`,
      };
    }),
    ...failedScormRes.map<AttentionItem>((row) => ({
      type: "SCORM_FAILED",
      id: row.id,
      title: row.original_filename,
      timestamp: row.created_at,
      href: row.artifact_id ? `${basePath}/artifacts/${row.artifact_id}` : `${basePath}/artifacts/new`,
    })),
  ]
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 6);

  const ownerIds = [
    ...new Set(recentArtifactsRes.map((row) => row.created_by).filter(Boolean)),
  ] as string[];
  let profiles: ProfileRow[] = [];
  if (ownerIds.length > 0) {
    const { data } = await supabase
      .from("profiles")
      .select("id, username, first_name")
      .in("id", ownerIds);
    profiles = (data || []) as ProfileRow[];
  }

  const recentArtifactIds = recentArtifactsRes.map((row) => row.id);
  const compositionsByArtifact = new Map<string, CompositionRow>();
  const renderJobsByArtifact = new Map<string, RenderJobRow>();
  if (recentArtifactIds.length > 0) {
    const [{ data: compositions }, { data: renderJobs }] = await Promise.all([
      supabase
        .from("video_compositions")
        .select("artifact_id, status, updated_at")
        .in("artifact_id", recentArtifactIds)
        .order("updated_at", { ascending: false }),
      supabase
        .from("production_jobs")
        .select("artifact_id, status, updated_at")
        .eq("job_type", "HYPERFRAMES_RENDER")
        .in("artifact_id", recentArtifactIds)
        .order("updated_at", { ascending: false }),
    ]);
    ((compositions || []) as CompositionRow[]).forEach((row) => {
      if (!compositionsByArtifact.has(row.artifact_id)) compositionsByArtifact.set(row.artifact_id, row);
    });
    ((renderJobs || []) as RenderJobRow[]).forEach((row) => {
      if (!renderJobsByArtifact.has(row.artifact_id)) renderJobsByArtifact.set(row.artifact_id, row);
    });
  }

  const recentArtifacts: RecentArtifactItem[] = recentArtifactsRes.map((row) => {
    const owner = profiles.find((profile) => profile.id === row.created_by);
    return {
      id: row.id,
      title: cleanTitle(row.idea_central),
      state: row.state,
      productionComplete: Boolean(row.production_complete),
      updatedAt: row.updated_at,
      ownerName: owner?.username || owner?.first_name || null,
      href: `${basePath}/artifacts/${row.id}`,
      productionStatus: deriveProductionStatus(
        renderJobsByArtifact.get(row.id),
        compositionsByArtifact.get(row.id),
      ),
    };
  });

  return {
    stats: {
      activeUsers,
      totalArtifacts,
      artifactsCreatedThisWeek,
      inProgressCount,
      activeRenderCount,
      escalatedCount,
      publicationReadyCount,
      publicationSentCount,
    },
    pipelineDistribution,
    creationTrend,
    attentionItems,
    recentArtifacts,
  };
}
