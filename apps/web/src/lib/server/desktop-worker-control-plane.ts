import crypto from "node:crypto";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { normalizeAssemblyAssets } from "@/remotion/assembly-assets.normalizer";
import { mergeTemplateRenderConfigs } from "@/remotion/template-config";

const WORKER_TOKEN_PREFIX = "swk_";
const LINK_CODE_PREFIX = "SLIA-";
const TOKEN_BYTES = 32;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const VIDEO_BUCKET = "production-videos";
const WORKER_ONLINE_TTL_MS = 60 * 1000;
const WORKER_JOB_STALE_MS = 2 * 60 * 1000;
const WORKER_JOB_LEASE_SECONDS = 180;
const ASSEMBLY_FPS = 30;
const FALLBACK_DURATION_SECONDS = 10;

type SupabaseAnyClient = ReturnType<typeof getServiceRoleClient>;

export interface WorkerAuthContext {
  id: string;
  organizationId: string;
  status: string;
}

export interface ClaimedDesktopWorkerJob {
  jobId: string;
  compositionId: string;
  resolvedProps: Record<string, unknown>;
  propsHash: string;
  bundleUrl: string;
  bundleHash: string;
  bundleType: "serve_url";
  outputUploadUrl: string;
  outputStoragePath: string;
  timeoutInMilliseconds: number;
}

export interface WorkerJobCompleteInput {
  outputStoragePath: string;
  checksum?: string;
  durationSeconds?: number;
  logsRef?: string;
}

function normalizeMaxConcurrentJobs(value: unknown) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 1;
  return Math.max(1, Math.min(8, Math.round(numeric)));
}

function readWorkerCapacity(input: Record<string, unknown>) {
  const rawCapacity = input.capacity && typeof input.capacity === "object" && !Array.isArray(input.capacity)
    ? input.capacity as Record<string, unknown>
    : {};
  const maxConcurrentJobs = normalizeMaxConcurrentJobs(input.maxConcurrentJobs ?? rawCapacity.maxConcurrentJobs);

  return {
    maxConcurrentJobs,
    report: {
      maxConcurrentJobs,
      runningJobs: Math.max(0, Math.min(8, Math.round(Number(input.runningJobs ?? rawCapacity.runningJobs ?? 0) || 0))),
      cpuCount: Number(input.cpuCount ?? rawCapacity.cpuCount) || null,
      memoryGb: Number(input.memoryGb ?? rawCapacity.memoryGb) || null,
      source: typeof input.maxConcurrentJobs === "number" || typeof rawCapacity.maxConcurrentJobs === "number" ? "AUTO" : "UNKNOWN",
    },
  };
}

function sanitizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [redacted]")
    .replace(/swk_[A-Za-z0-9._~+/=-]+/gi, "swk_[redacted]")
    .replace(/SLIA-\d{6}/gi, "SLIA-[redacted]")
    .replace(/SUPABASE_SERVICE_ROLE_KEY=[^\s]+/gi, "SUPABASE_SERVICE_ROLE_KEY=[redacted]")
    .slice(0, 1000);
}

function hashWorkerToken(token: string): string {
  const pepper = process.env.REMOTION_DESKTOP_WORKER_TOKEN_PEPPER || "";
  return crypto.createHash("sha256").update(`${pepper}:${token}`).digest("hex");
}

function normalizeLinkCode(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, "");
}

function hashLinkCode(code: string): string {
  const pepper =
    process.env.REMOTION_DESKTOP_WORKER_LINK_CODE_PEPPER ||
    process.env.REMOTION_DESKTOP_WORKER_TOKEN_PEPPER ||
    "";
  return crypto.createHash("sha256").update(`${pepper}:${normalizeLinkCode(code)}`).digest("hex");
}

function generateWorkerToken(): string {
  return `${WORKER_TOKEN_PREFIX}${crypto.randomBytes(TOKEN_BYTES).toString("base64url")}`;
}

function generateLinkCode(): string {
  const number = crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
  return `${LINK_CODE_PREFIX}${number}`;
}

function getLast4(value: string): string {
  return value.slice(-4);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function buildStableHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

function safeJobProgressEntry(params: {
  percent: number;
  message: string;
  stage: string;
  workerId: string;
}) {
  return {
    percent: Math.max(0, Math.min(100, Math.round(params.percent))),
    message: sanitizeText(params.message, "Worker progress"),
    stage: sanitizeText(params.stage, "desktop_worker"),
    provider: "desktop_worker",
    workerId: params.workerId,
    timestamp: new Date().toISOString(),
  };
}

function isWorkerHeartbeatFresh(worker: { last_heartbeat_at?: string | null }) {
  if (!worker.last_heartbeat_at) return false;
  return Date.now() - new Date(worker.last_heartbeat_at).getTime() <= WORKER_ONLINE_TTL_MS;
}

function resolveComputedWorkerStatus(worker: {
  status?: string | null;
  last_heartbeat_at?: string | null;
}) {
  if (worker.status === "REVOKED") return "REVOKED";
  if (!isWorkerHeartbeatFresh(worker)) return "OFFLINE";
  return worker.status === "BUSY" ? "BUSY" : "ONLINE";
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isValidCompositionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized) return false;
  if (/^https?:\/\//i.test(normalized)) return false;
  if (normalized.includes("/") || normalized.includes("\\")) return false;
  if (/\.html?$/i.test(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized);
}

function resolveExternalDesktopRenderTarget(params: {
  version: Record<string, unknown>;
  build: Record<string, unknown>;
}) {
  const serveUrl = readNonEmptyString(params.build.serve_url);
  if (!serveUrl || !/^https:\/\//i.test(serveUrl)) {
    throw new Error("EXTERNAL_RENDER_TARGET_INCOMPLETE: el build cloud no tiene serve_url HTTPS.");
  }

  const compositionId = [
    readNonEmptyString(params.build.composition_id),
    readNonEmptyString(params.version.composition_id),
  ].find(isValidCompositionId);

  if (!compositionId) {
    throw new Error("EXTERNAL_COMPOSITION_ID_MISSING: el bundle cloud no declaro composition_id valido.");
  }

  return {
    serveUrl,
    compositionId,
    exportMode:
      params.build.export_mode === "root" || params.version.export_mode === "root"
        ? "root"
        : "component",
    buildHash: readNonEmptyString(params.build.build_hash) || readNonEmptyString(params.version.build_hash),
    bundleHash: readNonEmptyString(params.build.bundle_hash) || readNonEmptyString(params.version.bundle_hash),
    cloudProvider: readNonEmptyString(params.build.cloud_provider),
  };
}

function isStaleJobAssignment(job: any, worker: any | null) {
  if (!job.worker_id) return false;
  if (!worker || worker.status === "REVOKED") return true;
  const heartbeatAt = job.worker_heartbeat_at || worker.last_heartbeat_at || job.claimed_at;
  if (!heartbeatAt) return true;
  return Date.now() - new Date(heartbeatAt).getTime() > WORKER_JOB_STALE_MS;
}

function hasUsableFinalVideoUrl(value: unknown): boolean {
  return typeof value === "string" && /^https?:\/\//i.test(value.trim());
}

function deriveDurationFromJob(job: any): number {
  const props = job.input_snapshot?.resolvedProps;
  const frames = Number(props?.totalDurationInFrames);
  const fps = Number(props?.fps);
  if (Number.isFinite(frames) && Number.isFinite(fps) && frames > 0 && fps > 0) {
    return Math.round(frames / fps);
  }
  return 0;
}

function secondsToFrames(seconds: number, fps: number): number {
  return Math.max(1, Math.round(seconds * fps));
}

function buildAssemblyInputProps(params: {
  assets: any;
  compositionId: string;
  transitionType: unknown;
  templateConfig?: unknown;
}) {
  const normalized = normalizeAssemblyAssets(params.assets, ASSEMBLY_FPS);
  const templateConfig = mergeTemplateRenderConfigs(params.templateConfig, null);
  const totalSeconds =
    normalized.totalDurationSeconds > 0
      ? normalized.totalDurationSeconds
      : FALLBACK_DURATION_SECONDS;
  const transition =
    params.transitionType === "slide" || params.transitionType === "none"
      ? params.transitionType
      : templateConfig.transitionType;

  return {
    template: params.compositionId,
    fps: ASSEMBLY_FPS,
    totalDurationInFrames: secondsToFrames(totalSeconds, ASSEMBLY_FPS),
    voiceAudioUrl: normalized.voiceAudioUrl,
    bgMusicUrl: normalized.bgMusicUrl,
    bgMusicVolume: normalized.bgMusicVolume,
    avatarVideoUrl: normalized.avatarVideoUrl,
    slides: normalized.slides,
    brollClips: normalized.brollClips,
    transitionType: transition,
    templateConfig: {
      ...templateConfig,
      transitionType: transition,
    },
  };
}

function extractExternalTemplateOverrides(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const variables = value as Record<string, unknown>;
  const candidate = variables.resolvedProps ?? variables.customTemplateProps ?? variables.templateProps;
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : null;
}

function validatePropsSchema(
  props: Record<string, unknown>,
  schema: Record<string, unknown> | null | undefined,
) {
  if (!schema || schema.type !== "object") return;
  const required = Array.isArray(schema.required)
    ? schema.required.filter((key): key is string => typeof key === "string")
    : [];
  const missing = required.filter((key) => props[key] === undefined || props[key] === null);
  if (missing.length > 0) {
    throw new Error(`EXTERNAL_PROPS_INVALID: faltan props requeridos: ${missing.join(", ")}`);
  }
}

function buildExternalTemplateProps(input: {
  assets: unknown;
  compositionId: string;
  templateDefaultConfig?: unknown;
  variables?: Record<string, unknown>;
  bundleDefaultProps?: Record<string, unknown> | null;
  propsSchema?: Record<string, unknown> | null;
}) {
  const variables = input.variables ?? {};
  const templateConfig = mergeTemplateRenderConfigs(input.templateDefaultConfig, variables.templateConfig);
  const courseProps = buildAssemblyInputProps({
    assets: input.assets,
    compositionId: input.compositionId,
    transitionType: variables.transitionType,
    templateConfig,
  });
  const overrides = extractExternalTemplateOverrides(variables);
  const resolvedProps = {
    ...(input.bundleDefaultProps || {}),
    ...(courseProps as Record<string, unknown>),
    ...(overrides || {}),
  };
  validatePropsSchema(resolvedProps, input.propsSchema);
  return {
    resolvedProps,
    propsHash: buildStableHash(resolvedProps),
    propsSource: "courseforge-canonical-v1",
    propKeys: Object.keys(resolvedProps).sort(),
  };
}

function buildRenderIdempotencyKey(params: {
  componentId: string;
  templateId: string;
  templateVersionId?: string | null;
  bundleHash?: string | null;
  buildHash?: string | null;
  buildId?: string | null;
  serveUrl?: string | null;
  propsHash?: string | null;
  compositionId?: string | null;
  exportMode?: string | null;
  variables: unknown;
}) {
  return `remotion-render-${params.componentId}-${buildStableHash(params).slice(0, 32)}`;
}

function buildRenderDiagnostics(params: {
  renderMode: string;
  inputProps: Record<string, unknown> | null;
  rawAssets: unknown;
  templateId: string;
  templateVersionId?: string | null;
  buildId?: string | null;
  bundleHash?: string | null;
  buildHash?: string | null;
  compositionId?: string | null;
  propsHash?: string | null;
}) {
  return {
    renderProvider: "desktop_worker",
    renderMode: params.renderMode,
    templateId: params.templateId,
    templateVersionId: params.templateVersionId || null,
    buildId: params.buildId || null,
    bundleHash: params.bundleHash || null,
    buildHash: params.buildHash || null,
    compositionId: params.compositionId || null,
    propsHash: params.propsHash || null,
    inputPropKeys: params.inputProps ? Object.keys(params.inputProps).sort() : [],
    rawAssetKeys:
      params.rawAssets && typeof params.rawAssets === "object" && !Array.isArray(params.rawAssets)
        ? Object.keys(params.rawAssets as Record<string, unknown>).sort()
        : [],
    timeoutInMilliseconds: Number(process.env.REMOTION_LOCAL_RENDER_TIMEOUT_MS || 900000),
  };
}

function assertWorkerCanAccessJob(worker: WorkerAuthContext, job: any) {
  if (job.organization_id !== worker.organizationId) {
    throw new Error("JOB_FORBIDDEN_FOR_WORKER");
  }
  if (job.job_type !== "REMOTION_RENDER") {
    throw new Error("JOB_TYPE_NOT_SUPPORTED");
  }
  if (job.input_snapshot?.renderProvider !== "desktop_worker") {
    throw new Error("JOB_PROVIDER_NOT_DESKTOP_WORKER");
  }
  if (!["PENDING", "QUEUED", "WAITING_PROVIDER", "RUNNING"].includes(job.status)) {
    throw new Error("JOB_NOT_CLAIMABLE");
  }
  if (job.worker_id && job.worker_id !== worker.id) {
    throw new Error("JOB_ALREADY_CLAIMED_BY_ANOTHER_WORKER");
  }
  if (job.preferred_worker_id && job.preferred_worker_id !== worker.id) {
    throw new Error("JOB_RESERVED_FOR_ANOTHER_WORKER");
  }
}

function resolveWorkerRenderInput(snapshot: Record<string, any>) {
  const externalServeUrl = typeof snapshot.externalServeUrl === "string" ? snapshot.externalServeUrl.trim() : "";
  const isExternalDesktopRender =
    snapshot.renderMode === "EXTERNAL_DESKTOP_SITE_READY" ||
    (externalServeUrl && /^https:\/\//i.test(externalServeUrl));

  if (!isExternalDesktopRender) {
    throw new Error("DESKTOP_WORKER_NETLIFY_REQUIRES_PUBLISHED_SERVE_URL");
  }
  if (!/^https:\/\//i.test(externalServeUrl)) {
    throw new Error("EXTERNAL_DESKTOP_SERVE_URL_INVALID");
  }
  if (typeof snapshot.compositionId !== "string" || !snapshot.compositionId.trim()) {
    throw new Error("EXTERNAL_DESKTOP_COMPOSITION_ID_MISSING");
  }
  if (!isValidCompositionId(snapshot.compositionId)) {
    throw new Error("EXTERNAL_DESKTOP_COMPOSITION_ID_INVALID");
  }
  if (!snapshot.resolvedProps || typeof snapshot.resolvedProps !== "object" || Array.isArray(snapshot.resolvedProps)) {
    throw new Error("EXTERNAL_DESKTOP_PROPS_MISSING");
  }

  const propsHash =
    typeof snapshot.propsHash === "string" && snapshot.propsHash
      ? snapshot.propsHash
      : buildStableHash(snapshot.resolvedProps);

  return {
    renderMode: "EXTERNAL_DESKTOP_SITE_READY",
    compositionId: snapshot.compositionId,
    resolvedProps: snapshot.resolvedProps,
    propsHash,
    bundle: {
      signedUrl: externalServeUrl,
      bundleHash: snapshot.bundleHash || snapshot.buildHash || snapshot.buildId || "external-desktop-site",
      storagePath: externalServeUrl,
      bundleType: "serve_url" as const,
    },
    renderDiagnostics:
      snapshot.renderDiagnostics || {
        renderProvider: "desktop_worker",
        renderMode: "EXTERNAL_DESKTOP_SITE_READY",
        compositionId: snapshot.compositionId,
        propsHash,
        timeoutInMilliseconds: Number(process.env.REMOTION_LOCAL_RENDER_TIMEOUT_MS || 900000),
      },
  };
}

export class DesktopWorkerControlPlane {
  constructor(private readonly supabase: SupabaseAnyClient = getServiceRoleClient()) {}

  async listWorkers(organizationId: string) {
    const { data, error } = await this.supabase
      .from("render_workers")
      .select("id, organization_id, device_name, platform, arch, app_version, status, last_heartbeat_at, token_last4, max_concurrent_jobs, capabilities, last_capacity_report, capacity_updated_at, created_at, updated_at")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });

    if (error) throw new Error(`WORKER_LIST_FAILED: ${error.message}`);

    const workers = data || [];
    const runningCounts = await this.countRunningJobsByWorker(workers.map((worker: any) => worker.id));

    return workers.map((worker: any) => ({
      ...worker,
      status: resolveComputedWorkerStatus(worker),
      max_concurrent_jobs: normalizeMaxConcurrentJobs(worker.max_concurrent_jobs),
      running_jobs: runningCounts.get(worker.id) || 0,
      available_slots: Math.max(0, normalizeMaxConcurrentJobs(worker.max_concurrent_jobs) - (runningCounts.get(worker.id) || 0)),
    }));
  }

  async createLinkCode(input: {
    organizationId: string;
    userId: string;
    deviceName?: unknown;
    platform?: unknown;
    arch?: unknown;
    appVersion?: unknown;
  }) {
    const code = generateLinkCode();
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();
    const { data, error } = await this.supabase
      .from("render_worker_link_codes")
      .insert({
        organization_id: input.organizationId,
        created_by: input.userId,
        code_hash: hashLinkCode(code),
        code_last4: getLast4(code),
        device_name: sanitizeText(input.deviceName, ""),
        platform: sanitizeText(input.platform, ""),
        arch: sanitizeText(input.arch, ""),
        app_version: sanitizeText(input.appVersion, ""),
        expires_at: expiresAt,
      })
      .select("id, organization_id, code_last4, expires_at, created_at")
      .single();

    if (error || !data) {
      throw new Error(`WORKER_LINK_CODE_CREATE_FAILED: ${error?.message || "Unknown error"}`);
    }

    return { linkCode: data, code };
  }

  async consumeLinkCode(input: {
    code: string;
    deviceName?: unknown;
    platform?: unknown;
    arch?: unknown;
    appVersion?: unknown;
  }) {
    const normalizedCode = normalizeLinkCode(String(input.code || ""));
    if (!/^SLIA-\d{6}$/.test(normalizedCode)) throw new Error("INVALID_LINK_CODE");

    const { data: linkCode, error: linkCodeError } = await this.supabase
      .from("render_worker_link_codes")
      .select("*")
      .eq("code_hash", hashLinkCode(normalizedCode))
      .maybeSingle();

    if (linkCodeError || !linkCode) throw new Error("LINK_CODE_NOT_FOUND");
    if (linkCode.consumed_at) throw new Error("LINK_CODE_ALREADY_CONSUMED");
    if (new Date(linkCode.expires_at).getTime() < Date.now()) throw new Error("LINK_CODE_EXPIRED");

    const consumedAt = new Date().toISOString();
    const { data: consumedCode, error: reserveError } = await this.supabase
      .from("render_worker_link_codes")
      .update({ consumed_at: consumedAt })
      .eq("id", linkCode.id)
      .is("consumed_at", null)
      .select("id")
      .single();

    if (reserveError || !consumedCode) throw new Error("LINK_CODE_ALREADY_CONSUMED");

    const workerToken = generateWorkerToken();
    const { data: worker, error: workerError } = await this.supabase
      .from("render_workers")
      .insert({
        organization_id: linkCode.organization_id,
        device_name: sanitizeText(input.deviceName, linkCode.device_name || "SofLIA Render Worker"),
        platform: sanitizeText(input.platform, linkCode.platform || ""),
        arch: sanitizeText(input.arch, linkCode.arch || ""),
        app_version: sanitizeText(input.appVersion, linkCode.app_version || "dev"),
        token_hash: hashWorkerToken(workerToken),
        token_last4: getLast4(workerToken),
        status: "LINKED",
        created_by: linkCode.created_by,
      })
      .select("id, organization_id, device_name, platform, arch, app_version, status, token_last4, created_at")
      .single();

    if (workerError || !worker) {
      throw new Error(`WORKER_LINK_FAILED: ${workerError?.message || "Unknown error"}`);
    }

    await this.supabase
      .from("render_worker_link_codes")
      .update({ consumed_by_worker_id: worker.id })
      .eq("id", linkCode.id);

    return { worker, workerToken };
  }

  async authenticateWorkerToken(token: string | undefined): Promise<WorkerAuthContext | null> {
    if (!token?.startsWith(WORKER_TOKEN_PREFIX)) return null;

    const { data, error } = await this.supabase
      .from("render_workers")
      .select("id, organization_id, status")
      .eq("token_hash", hashWorkerToken(token))
      .maybeSingle();

    if (error || !data || data.status === "REVOKED") return null;
    return { id: data.id, organizationId: data.organization_id, status: data.status };
  }

  async heartbeat(worker: WorkerAuthContext, input: Record<string, unknown>) {
    const requestedStatus = input.status === "BUSY" ? "BUSY" : input.status === "OFFLINE" ? "OFFLINE" : "ONLINE";
    const now = new Date().toISOString();
    const capacity = readWorkerCapacity(input);
    const activeJobIds = Array.isArray(input.activeJobIds)
      ? input.activeJobIds.filter((jobId): jobId is string => typeof jobId === "string")
      : [];
    const { data, error } = await this.supabase
      .from("render_workers")
      .update({
        status: requestedStatus,
        platform: sanitizeText(input.platform, ""),
        arch: sanitizeText(input.arch, ""),
        app_version: sanitizeText(input.appVersion, ""),
        max_concurrent_jobs: capacity.maxConcurrentJobs,
        last_capacity_report: capacity.report,
        capacity_updated_at: now,
        last_heartbeat_at: requestedStatus === "OFFLINE" ? null : now,
        updated_at: now,
      })
      .eq("id", worker.id)
      .neq("status", "REVOKED")
      .select("id, organization_id, status, last_heartbeat_at")
      .single();

    if (error || !data) {
      throw new Error(`WORKER_HEARTBEAT_FAILED: ${error?.message || "Unknown error"}`);
    }

    if (activeJobIds.length > 0 && requestedStatus !== "OFFLINE") {
      await this.supabase
        .from("production_jobs")
        .update({
          worker_heartbeat_at: now,
          lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
        })
        .eq("worker_id", worker.id)
        .in("id", activeJobIds)
        .in("status", ["RUNNING"]);
    }

    return { ...data, status: resolveComputedWorkerStatus(data) };
  }

  async revokeWorker(workerId: string, organizationId: string) {
    const { data, error } = await this.supabase
      .from("render_workers")
      .update({
        status: "REVOKED",
        revoked_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", workerId)
      .eq("organization_id", organizationId)
      .select("id, organization_id, status, revoked_at")
      .single();

    if (error || !data) throw new Error(`WORKER_REVOKE_FAILED: ${error?.message || "Unknown error"}`);
    await this.releaseWorkerJobs(workerId);
    return data;
  }

  async createDesktopRenderJob(input: {
    componentId: string;
    templateId: string;
    variables: Record<string, unknown>;
    userId: string;
    organizationIds: string[];
    renderBatchId?: string | null;
    preferredWorkerId?: string | null;
    assignedStrategy?: "AUTO" | "MANUAL" | "LEGACY";
  }) {
    const { data: component, error: componentError } = await this.supabase
      .from("material_components")
      .select(
        `
          *,
          material_lessons (
            id, lesson_id, lesson_title, module_title, module_id,
            materials (
              artifact_id,
              artifacts ( organization_id )
            )
          )
        `,
      )
      .eq("id", input.componentId)
      .single();

    if (componentError || !component) throw new Error("COMPONENT_NOT_FOUND");

    const lesson = Array.isArray(component.material_lessons)
      ? component.material_lessons[0]
      : component.material_lessons;
    const material = Array.isArray(lesson?.materials) ? lesson.materials[0] : lesson?.materials;
    const artifact = Array.isArray(material?.artifacts) ? material.artifacts[0] : material?.artifacts;
    const organizationId = artifact?.organization_id || null;

    if (organizationId && !input.organizationIds.includes(organizationId)) {
      throw new Error("FORBIDDEN_COMPONENT_ORGANIZATION");
    }

    const { data: templateRecord, error: templateError } = await this.supabase
      .from("remotion_templates")
      .select("id, organization_id, storage_path, bundle_status, composition_id, default_config")
      .eq("id", input.templateId)
      .maybeSingle();

    if (templateError || !templateRecord) throw new Error("TEMPLATE_NOT_FOUND");
    if (templateRecord.organization_id && !input.organizationIds.includes(templateRecord.organization_id)) {
      throw new Error("FORBIDDEN_TEMPLATE_ORGANIZATION");
    }
    if (!templateRecord.storage_path) {
      throw new Error("DESKTOP_WORKER_NETLIFY_REQUIRES_CUSTOM_TEMPLATE_BUILD");
    }

    const { data: cloudVersion } = await this.supabase
      .from("remotion_template_versions")
      .select("id, bundle_hash, build_hash, composition_id, export_mode, status, default_props, props_schema")
      .eq("template_id", input.templateId)
      .in("status", ["APPROVED_FOR_SANDBOX", "APPROVED"])
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: cloudBuild } = cloudVersion?.id
      ? await this.supabase
          .from("remotion_template_builds")
          .select("id, bundle_hash, build_hash, serve_url, composition_id, export_mode, status, cloud_provider")
          .eq("template_version_id", cloudVersion.id)
          .eq("bundle_hash", cloudVersion.bundle_hash || "")
          .eq("status", "BUILT")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
      : { data: null };

    if (!cloudVersion || !cloudBuild) {
      throw new Error("EXTERNAL_BUILD_NOT_READY");
    }
    const externalTarget = resolveExternalDesktopRenderTarget({
      version: cloudVersion,
      build: cloudBuild,
    });

    const propsResult = buildExternalTemplateProps({
      assets: component.assets || {},
      compositionId: externalTarget.compositionId,
      templateDefaultConfig: templateRecord.default_config,
      variables: input.variables,
      bundleDefaultProps: cloudVersion.default_props,
      propsSchema: cloudVersion.props_schema,
    });
    const renderMode = "EXTERNAL_DESKTOP_SITE_READY";
    const inputSnapshot = {
      templateId: input.templateId,
      templateVersionId: cloudVersion.id,
      bundleHash: externalTarget.bundleHash || null,
      buildId: cloudBuild.id,
      buildHash: externalTarget.buildHash || null,
      compositionId: externalTarget.compositionId,
      exportMode: externalTarget.exportMode,
      externalServeUrl: externalTarget.serveUrl,
      cloudProvider: externalTarget.cloudProvider || null,
      renderMode,
      renderProvider: "desktop_worker",
      propsHash: propsResult.propsHash,
      propsSource: propsResult.propsSource,
      resolvedProps: propsResult.resolvedProps,
      propKeys: propsResult.propKeys,
      renderDiagnostics: buildRenderDiagnostics({
        renderMode,
        inputProps: propsResult.resolvedProps,
        rawAssets: component.assets || {},
        templateId: input.templateId,
        templateVersionId: cloudVersion.id,
        buildId: cloudBuild.id,
        bundleHash: externalTarget.bundleHash || null,
        buildHash: externalTarget.buildHash || null,
        compositionId: externalTarget.compositionId,
        propsHash: propsResult.propsHash,
      }),
      variables: input.variables,
      renderBatchId: input.renderBatchId || null,
      preferredWorkerId: input.preferredWorkerId || null,
    };
    const idempotencyKey = buildRenderIdempotencyKey({
      componentId: input.componentId,
      templateId: input.templateId,
      templateVersionId: cloudVersion.id,
      bundleHash: externalTarget.bundleHash || null,
      buildId: cloudBuild.id,
      buildHash: externalTarget.buildHash || null,
      serveUrl: externalTarget.serveUrl,
      propsHash: propsResult.propsHash,
      compositionId: externalTarget.compositionId,
      exportMode: externalTarget.exportMode,
      variables: input.variables,
    });

    const existingJobQuery = this.supabase
      .from("production_jobs")
      .select("*")
      .eq("idempotency_key", idempotencyKey);
    const { data: existingJob } = organizationId
      ? await existingJobQuery.eq("organization_id", organizationId).maybeSingle()
      : await existingJobQuery.is("organization_id", null).maybeSingle();
    const componentHasFinalVideo = hasUsableFinalVideoUrl(component.assets?.final_video_url);

    if (existingJob && !["FAILED", "CANCELLED", "SUCCEEDED"].includes(existingJob.status)) {
      const assignedWorker = existingJob.worker_id
        ? await this.getWorkerById(existingJob.worker_id)
        : null;
      if (isStaleJobAssignment(existingJob, assignedWorker)) {
        const resetJob = await this.resetDesktopJob(existingJob.id, inputSnapshot, "Reintentando render: el worker asignado ya no esta disponible");
        return {
          jobId: resetJob.id,
          status: resetJob.status,
          renderProvider: "desktop_worker",
          message: "Stale desktop worker job reset",
        };
      }
    }

    if (existingJob?.status === "SUCCEEDED" && !componentHasFinalVideo) {
      const resetJob = await this.resetDesktopJob(existingJob.id, inputSnapshot, "Reintentando render: el componente no tiene video final");
      return {
        jobId: resetJob.id,
        status: resetJob.status,
        renderProvider: "desktop_worker",
        message: "Completed desktop worker job without component final video reset",
      };
    }

    if (existingJob && !["FAILED", "CANCELLED"].includes(existingJob.status)) {
      return {
        jobId: existingJob.id,
        status: existingJob.status,
        renderProvider: "desktop_worker",
        message: "Rendering job reused by idempotency key",
      };
    }

    if (existingJob) {
      const resetJob = await this.resetDesktopJob(existingJob.id, inputSnapshot, "Reintentando render con worker local");
      return {
        jobId: resetJob.id,
        status: resetJob.status,
        renderProvider: "desktop_worker",
        message: "Failed desktop worker job reset",
      };
    }

    const { data: job, error: jobError } = await this.supabase
      .from("production_jobs")
      .insert({
        organization_id: organizationId,
        artifact_id: material?.artifact_id || null,
        material_lesson_id: component.material_lesson_id,
        material_component_id: input.componentId,
        lesson_id: lesson?.lesson_id || null,
        module_id: lesson?.module_id || null,
        job_type: "REMOTION_RENDER",
        provider: "remotion",
        status: "WAITING_PROVIDER",
        idempotency_key: idempotencyKey,
        input_snapshot: inputSnapshot,
        preferred_worker_id: input.preferredWorkerId || null,
        assigned_strategy: input.assignedStrategy || (input.preferredWorkerId ? "MANUAL" : "AUTO"),
        render_batch_id: input.renderBatchId || null,
        created_by: input.userId,
        progress: [
          {
            percent: 0,
            message: "Job de render creado para worker local",
            stage: "job_created",
            provider: "desktop_worker",
            timestamp: new Date().toISOString(),
          },
        ],
      })
      .select("id, status")
      .single();

    if (jobError || !job) throw new Error(`JOB_CREATE_FAILED: ${jobError?.message || "Unknown error"}`);
    return {
      jobId: job.id,
      status: job.status,
      renderProvider: "desktop_worker",
      message: "Desktop worker job waiting for local worker",
    };
  }

  async claimNextJob(worker: WorkerAuthContext) {
    const claimLimit = await this.getWorkerAvailableClaimSlots(worker.id);
    if (claimLimit <= 0) {
      await this.heartbeat(worker, { status: "BUSY" });
      return null;
    }

    const claimedJobs = await this.claimJobsAtomically(worker, claimLimit);
    if (claimedJobs.length === 0) {
      await this.heartbeat(worker, { status: "ONLINE" });
      return null;
    }

    const payloads = await Promise.all(claimedJobs.map((job: any) => this.buildClaimedJobPayload(worker, job)));
    await this.heartbeat(worker, { status: "BUSY", activeJobIds: payloads.map((job) => job.jobId) });
    return payloads.length === 1 ? payloads[0] : { jobs: payloads };
  }

  async getJobStatus(jobId: string, organizationIds: string[]) {
    const { data: job, error } = await this.supabase
      .from("production_jobs")
      .select("id, status, progress, output_snapshot, provider_error, started_at, completed_at, failed_at, organization_id")
      .eq("id", jobId)
      .maybeSingle();

    if (error || !job) throw new Error("JOB_NOT_FOUND");
    if (job.organization_id && !organizationIds.includes(job.organization_id)) {
      throw new Error("FORBIDDEN: You do not have access to this job");
    }

    return {
      id: job.id,
      status: job.status,
      progress: job.progress,
      output_snapshot: job.output_snapshot,
      provider_error: job.provider_error,
      started_at: job.started_at,
      completed_at: job.completed_at,
      failed_at: job.failed_at,
    };
  }

  async claimJob(worker: WorkerAuthContext, jobId: string) {
    const { data: job, error: jobError } = await this.supabase
      .from("production_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (jobError || !job) throw new Error("JOB_NOT_FOUND");
    assertWorkerCanAccessJob(worker, job);

    const snapshot = job.input_snapshot || {};
    const resolved = resolveWorkerRenderInput(snapshot);
    const outputStoragePath = `completed/${job.material_component_id || job.id}/${job.id}-${worker.id}-${Date.now()}.mp4`;
    const { data: signedUpload, error: signedUploadError } = await this.supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(outputStoragePath, { upsert: false });
    if (signedUploadError || !signedUpload?.signedUrl) {
      throw new Error(`OUTPUT_UPLOAD_URL_FAILED: ${signedUploadError?.message || "Unknown error"}`);
    }

    const { data: updatedJob, error: updateError } = await this.supabase
      .from("production_jobs")
      .update({
        status: "RUNNING",
        worker_id: worker.id,
        claimed_at: new Date().toISOString(),
        worker_heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
        started_at: job.started_at || new Date().toISOString(),
        input_snapshot: {
          ...snapshot,
          renderProvider: "desktop_worker",
          renderMode: resolved.renderMode,
          compositionId: resolved.compositionId,
          propsHash: resolved.propsHash,
          resolvedProps: resolved.resolvedProps,
          desktopBundleHash: resolved.bundle.bundleHash,
          desktopBundleStoragePath: resolved.bundle.storagePath,
          desktopBundleType: resolved.bundle.bundleType,
          externalServeUrl: resolved.bundle.signedUrl,
          renderDiagnostics: resolved.renderDiagnostics,
        },
        progress: [
          safeJobProgressEntry({
            percent: 5,
            message: "Worker local tomo el job",
            stage: "desktop_worker_claimed",
            workerId: worker.id,
          }),
        ],
      })
      .eq("id", jobId)
      .in("status", ["PENDING", "QUEUED", "WAITING_PROVIDER"])
      .or(`worker_id.is.null,worker_id.eq.${worker.id}`)
      .select("*")
      .single();

    if (updateError || !updatedJob) {
      throw new Error(`JOB_CLAIM_FAILED: ${updateError?.message || "Unknown error"}`);
    }

    await this.heartbeat(worker, { status: "BUSY", activeJobIds: [jobId] });

    return {
      jobId,
      compositionId: resolved.compositionId,
      resolvedProps: resolved.resolvedProps,
      propsHash: resolved.propsHash,
      bundleUrl: resolved.bundle.signedUrl,
      bundleHash: resolved.bundle.bundleHash,
      bundleType: resolved.bundle.bundleType,
      outputUploadUrl: signedUpload.signedUrl,
      outputStoragePath,
      timeoutInMilliseconds: Number(process.env.REMOTION_LOCAL_RENDER_TIMEOUT_MS || 900000),
    };
  }

  private async countRunningJobsByWorker(workerIds: string[]) {
    if (workerIds.length === 0) return new Map<string, number>();
    const { data } = await this.supabase
      .from("production_jobs")
      .select("worker_id")
      .in("worker_id", workerIds)
      .eq("job_type", "REMOTION_RENDER")
      .eq("status", "RUNNING");

    const counts = new Map<string, number>();
    for (const row of data || []) {
      if (row.worker_id) counts.set(row.worker_id, (counts.get(row.worker_id) || 0) + 1);
    }
    return counts;
  }

  private async getWorkerAvailableClaimSlots(workerId: string) {
    const { data: worker } = await this.supabase
      .from("render_workers")
      .select("id, max_concurrent_jobs")
      .eq("id", workerId)
      .maybeSingle();
    const maxConcurrentJobs = normalizeMaxConcurrentJobs(worker?.max_concurrent_jobs);
    const runningCounts = await this.countRunningJobsByWorker([workerId]);
    return Math.max(0, maxConcurrentJobs - (runningCounts.get(workerId) || 0));
  }

  private async claimJobsAtomically(worker: WorkerAuthContext, limit: number) {
    const { data, error } = await this.supabase.rpc("claim_desktop_render_jobs", {
      p_worker_id: worker.id,
      p_organization_id: worker.organizationId,
      p_limit: limit,
      p_lease_seconds: WORKER_JOB_LEASE_SECONDS,
    });

    if (error) throw new Error(`JOB_NEXT_LOOKUP_FAILED: ${error.message}`);
    return data || [];
  }

  private async buildClaimedJobPayload(worker: WorkerAuthContext, job: any) {
    const snapshot = job.input_snapshot || {};
    const resolved = resolveWorkerRenderInput(snapshot);
    const outputStoragePath = `completed/${job.material_component_id || job.id}/${job.id}-${worker.id}-${Date.now()}.mp4`;
    const { data: signedUpload, error: signedUploadError } = await this.supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(outputStoragePath, { upsert: false });

    if (signedUploadError || !signedUpload?.signedUrl) {
      throw new Error(`OUTPUT_UPLOAD_URL_FAILED: ${signedUploadError?.message || "Unknown error"}`);
    }

    await this.supabase
      .from("production_jobs")
      .update({
        input_snapshot: {
          ...snapshot,
          renderProvider: "desktop_worker",
          renderMode: resolved.renderMode,
          compositionId: resolved.compositionId,
          propsHash: resolved.propsHash,
          resolvedProps: resolved.resolvedProps,
          desktopBundleHash: resolved.bundle.bundleHash,
          desktopBundleStoragePath: resolved.bundle.storagePath,
          desktopBundleType: resolved.bundle.bundleType,
          externalServeUrl: resolved.bundle.signedUrl,
          renderDiagnostics: resolved.renderDiagnostics,
        },
      })
      .eq("id", job.id)
      .eq("worker_id", worker.id);

    return {
      jobId: job.id,
      compositionId: resolved.compositionId,
      resolvedProps: resolved.resolvedProps,
      propsHash: resolved.propsHash,
      bundleUrl: resolved.bundle.signedUrl,
      bundleHash: resolved.bundle.bundleHash,
      bundleType: resolved.bundle.bundleType,
      outputUploadUrl: signedUpload.signedUrl,
      outputStoragePath,
      timeoutInMilliseconds: Number(process.env.REMOTION_LOCAL_RENDER_TIMEOUT_MS || 900000),
    };
  }

  async reportProgress(worker: WorkerAuthContext, jobId: string, input: Record<string, unknown>) {
    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    const currentProgress = Array.isArray(job.progress) ? job.progress : [];
    const progress = [
      ...currentProgress.slice(-19),
      safeJobProgressEntry({
        percent: Number(input.percent),
        message: sanitizeText(input.message, "Renderizando en worker local"),
        stage: sanitizeText(input.stage, "desktop_worker_progress"),
        workerId: worker.id,
      }),
    ];

    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        progress,
        worker_heartbeat_at: new Date().toISOString(),
        lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
      })
      .eq("id", jobId);

    if (error) throw new Error(`JOB_PROGRESS_FAILED: ${error.message}`);
    await this.heartbeat(worker, { status: "BUSY" });
    return { ok: true };
  }

  async completeJob(worker: WorkerAuthContext, jobId: string, input: WorkerJobCompleteInput) {
    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    if (!input.outputStoragePath || !input.outputStoragePath.startsWith("completed/")) {
      throw new Error("INVALID_OUTPUT_STORAGE_PATH");
    }

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(VIDEO_BUCKET).getPublicUrl(input.outputStoragePath);

    const duration = Number.isFinite(input.durationSeconds)
      ? Math.max(1, Math.round(input.durationSeconds || 0))
      : deriveDurationFromJob(job);

    const { data: component } = await this.supabase
      .from("material_components")
      .select("assets")
      .eq("id", job.material_component_id)
      .maybeSingle();

    await this.supabase
      .from("material_components")
      .update({
        assets: {
          ...(component?.assets || {}),
          final_video_url: publicUrl,
          final_video_source: "desktop_worker",
          final_video_storage_provider: "supabase",
          final_video_storage_path: input.outputStoragePath,
          video_duration: duration,
          production_status: "COMPLETED",
          updated_at: new Date().toISOString(),
        },
      })
      .eq("id", job.material_component_id);

    await this.syncFinalVideoToPublicationRequest({
      artifactId: job.artifact_id || null,
      materialLessonId: job.material_lesson_id || null,
      lessonId: job.lesson_id || null,
      finalVideoUrl: publicUrl,
      duration,
    });

    const outputSnapshot = {
      ...(job.output_snapshot || {}),
      final_video_url: publicUrl,
      completed: true,
      renderProvider: "desktop_worker",
      renderMode: job.input_snapshot?.renderMode || "EXTERNAL_DESKTOP_SITE_READY",
      propsHash: job.input_snapshot?.propsHash || null,
      bundleHash: job.input_snapshot?.desktopBundleHash || job.input_snapshot?.bundleHash || null,
      outputStoragePath: input.outputStoragePath,
      outputChecksum: sanitizeText(input.checksum, ""),
      logsRef: sanitizeText(input.logsRef, ""),
    };

    const { error } = await this.supabase
      .from("production_jobs")
      .update({
        status: "SUCCEEDED",
        progress: [
          safeJobProgressEntry({
            percent: 100,
            message: "Ensamblado completado exitosamente en worker local",
            stage: "desktop_worker_completed",
            workerId: worker.id,
          }),
        ],
        completed_at: new Date().toISOString(),
        worker_heartbeat_at: new Date().toISOString(),
        lease_expires_at: null,
        output_checksum: outputSnapshot.outputChecksum || null,
        logs_ref: outputSnapshot.logsRef || null,
        output_snapshot: outputSnapshot,
      })
      .eq("id", jobId);

    if (error) throw new Error(`JOB_COMPLETE_FAILED: ${error.message}`);
    await this.updateBatchItemFromJob(job.id, "SUCCEEDED");
    await this.heartbeat(worker, { status: "ONLINE" });
    return { finalVideoUrl: publicUrl, durationSeconds: duration };
  }

  async failJob(worker: WorkerAuthContext, jobId: string, input: Record<string, unknown>) {
    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    const message = sanitizeText(input.message, "El worker local no pudo completar el render");
    const code = sanitizeText(input.errorCode, "") || "DESKTOP_WORKER_RENDER_FAILED";

    await this.supabase
      .from("production_jobs")
      .update({
        status: "FAILED",
        failed_at: new Date().toISOString(),
        worker_heartbeat_at: new Date().toISOString(),
        lease_expires_at: null,
        provider_error: {
          code,
          message,
          renderProvider: "desktop_worker",
          stage: sanitizeText(input.stage, "desktop_worker"),
          workerId: worker.id,
        },
      })
      .eq("id", jobId);

    if (job.material_component_id) {
      const { data: component } = await this.supabase
        .from("material_components")
        .select("assets")
        .eq("id", job.material_component_id)
        .maybeSingle();
      await this.supabase
        .from("material_components")
        .update({
          assets: {
            ...(component?.assets || {}),
            production_status: "FAILED",
            updated_at: new Date().toISOString(),
          },
        })
        .eq("id", job.material_component_id);
    }

    await this.updateBatchItemFromJob(job.id, "FAILED", message);
    await this.heartbeat(worker, { status: "ONLINE" });
    return { ok: true };
  }

  private async getAuthorizedWorkerJob(worker: WorkerAuthContext, jobId: string) {
    const { data: job, error } = await this.supabase
      .from("production_jobs")
      .select("*")
      .eq("id", jobId)
      .single();

    if (error || !job) throw new Error("JOB_NOT_FOUND");
    assertWorkerCanAccessJob(worker, job);
    return job;
  }

  private async updateBatchItemFromJob(jobId: string, status: string, errorSanitized?: string) {
    await this.supabase
      .from("production_render_batch_items")
      .update({
        status,
        error_sanitized: errorSanitized ? sanitizeText(errorSanitized) : null,
        updated_at: new Date().toISOString(),
      })
      .eq("production_job_id", jobId);

    const { data: item } = await this.supabase
      .from("production_render_batch_items")
      .select("batch_id")
      .eq("production_job_id", jobId)
      .maybeSingle();
    if (!item?.batch_id) return;

    const { data: items } = await this.supabase
      .from("production_render_batch_items")
      .select("status")
      .eq("batch_id", item.batch_id);
    const rows = items || [];
    const completedItems = rows.filter((row: any) => row.status === "SUCCEEDED").length;
    const failedItems = rows.filter((row: any) => row.status === "FAILED").length;
    const terminalItems = rows.filter((row: any) => ["SUCCEEDED", "FAILED", "CANCELLED"].includes(row.status)).length;
    const nextStatus = terminalItems < rows.length
      ? "RUNNING"
      : failedItems > 0 && completedItems > 0
        ? "PARTIAL_FAILED"
        : failedItems > 0
          ? "FAILED"
          : "SUCCEEDED";

    await this.supabase
      .from("production_render_batches")
      .update({
        status: nextStatus,
        completed_items: completedItems,
        failed_items: failedItems,
        updated_at: new Date().toISOString(),
      })
      .eq("id", item.batch_id);
  }

  private async getWorkerById(workerId: string) {
    const { data } = await this.supabase
      .from("render_workers")
      .select("id, status, last_heartbeat_at")
      .eq("id", workerId)
      .maybeSingle();
    return data || null;
  }

  private async resetDesktopJob(jobId: string, inputSnapshot: Record<string, unknown>, message: string) {
    const { data: resetJob, error: resetError } = await this.supabase
      .from("production_jobs")
      .update({
        status: "WAITING_PROVIDER",
        progress: [
          {
            percent: 0,
            message,
            stage: "job_reset",
            provider: "desktop_worker",
            timestamp: new Date().toISOString(),
          },
        ],
        provider_error: null,
        output_snapshot: { completed: false, retryOfFailedJob: true, resetAt: new Date().toISOString() },
        started_at: null,
        completed_at: null,
        failed_at: null,
        worker_id: null,
        claimed_at: null,
        worker_heartbeat_at: null,
        lease_expires_at: null,
        preferred_worker_id: typeof inputSnapshot.preferredWorkerId === "string" ? inputSnapshot.preferredWorkerId : null,
        assigned_strategy: typeof inputSnapshot.preferredWorkerId === "string" ? "MANUAL" : "AUTO",
        input_snapshot: inputSnapshot,
      })
      .eq("id", jobId)
      .select("id, status")
      .single();

    if (resetError || !resetJob) {
      throw new Error(`JOB_RESET_FAILED: ${resetError?.message || "Unknown error"}`);
    }
    return resetJob;
  }

  private async releaseWorkerJobs(workerId: string, jobIds?: string[]) {
    let query = this.supabase
      .from("production_jobs")
      .update({
        status: "WAITING_PROVIDER",
        worker_id: null,
        claimed_at: null,
        worker_heartbeat_at: null,
        lease_expires_at: null,
        started_at: null,
        provider_error: null,
      })
      .eq("worker_id", workerId)
      .eq("job_type", "REMOTION_RENDER")
      .in("status", ["PENDING", "QUEUED", "WAITING_PROVIDER", "RUNNING"]);

    if (jobIds?.length) {
      query = query.in("id", jobIds);
    }

    await query;
  }

  private async syncFinalVideoToPublicationRequest(params: {
    artifactId: string | null;
    materialLessonId: string | null;
    lessonId: string | null;
    finalVideoUrl: string;
    duration: number;
  }) {
    if (!params.artifactId || !params.lessonId || !params.finalVideoUrl) return;

    let lessonTitle = params.lessonId;
    let moduleTitle = "";

    if (params.materialLessonId) {
      const { data: lesson } = await this.supabase
        .from("material_lessons")
        .select("lesson_id, lesson_title, module_title")
        .eq("id", params.materialLessonId)
        .maybeSingle();

      lessonTitle = lesson?.lesson_title || lessonTitle;
      moduleTitle = lesson?.module_title || "";
    }

    const { data: existingRequest } = await this.supabase
      .from("publication_requests")
      .select("id, lesson_videos")
      .eq("artifact_id", params.artifactId)
      .maybeSingle();

    const currentLessonVideos = (existingRequest?.lesson_videos as Record<string, unknown> | null) || {};
    const nextLessonVideos = {
      ...currentLessonVideos,
      [params.lessonId]: {
        lesson_id: params.lessonId,
        lesson_title: lessonTitle,
        module_title: moduleTitle,
        video_provider: "direct",
        video_id: params.finalVideoUrl,
        duration: params.duration,
      },
    };

    if (existingRequest?.id) {
      await this.supabase
        .from("publication_requests")
        .update({ lesson_videos: nextLessonVideos, updated_at: new Date().toISOString() })
        .eq("id", existingRequest.id);
      return;
    }

    await this.supabase.from("publication_requests").insert({
      artifact_id: params.artifactId,
      lesson_videos: nextLessonVideos,
      status: "DRAFT",
      updated_at: new Date().toISOString(),
    });
  }
}

export async function authenticateDesktopWorker(request: Request) {
  const token = request.headers.get("authorization")?.split(" ")[1];
  const service = new DesktopWorkerControlPlane();
  const worker = await service.authenticateWorkerToken(token);
  return worker ? { service, worker } : null;
}
