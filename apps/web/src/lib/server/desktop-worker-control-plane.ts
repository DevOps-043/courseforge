import crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import JSZip from "jszip";
import { getServiceRoleClient } from "@/lib/server/artifact-action-auth";
import { normalizeAssemblyAssets } from "@/remotion/assembly-assets.normalizer";
import {
  editableLayerDefinitionSchema,
  filterLayoutOverridesForEditableLayers,
  parseLayoutOverrideManifests,
  TEMPLATE_LAYOUT_CONTRACT_VERSION,
} from "@/remotion/layout-overrides";
import { mergeTemplateRenderConfigs } from "@/remotion/template-config";

const WORKER_TOKEN_PREFIX = "swk_";
const LINK_CODE_PREFIX = "SLIA-";
const TOKEN_BYTES = 32;
const LINK_CODE_TTL_MS = 10 * 60 * 1000;
const VIDEO_BUCKET = "production-videos";
const TEMPLATE_BUNDLE_BUCKET = "template-bundles";
const WORKER_ONLINE_TTL_MS = 60 * 1000;
const WORKER_JOB_STALE_MS = 2 * 60 * 1000;
const WORKER_JOB_LEASE_SECONDS = 180;
const ASSEMBLY_FPS = 30;
const FALLBACK_DURATION_SECONDS = 10;
const SIGNED_URL_TTL_SECONDS = 60 * 60;
const INTERNAL_COMPOSITION_IDS = ["full-slides", "split-avatar", "avatar-focus"] as const;
const DEFAULT_INTERNAL_COMPOSITION_ID = "full-slides";

type SupabaseAnyClient = ReturnType<typeof getServiceRoleClient>;

let internalBundlePromise: Promise<{
  bundleHash: string;
  storagePath: string;
  signedUrl: string;
  bundleType: "zip";
}> | null = null;

export function shouldUseTemplateServerBundler(env: NodeJS.ProcessEnv = process.env) {
  const setting = String(env.COURSEFORGE_TEMPLATE_SERVER_BUNDLER || "").trim().toLowerCase();
  if (["1", "true", "yes", "server", "local"].includes(setting)) return true;
  if (["0", "false", "no", "worker", "desktop_worker"].includes(setting)) return false;

  return env.NODE_ENV !== "production" || env.NETLIFY_DEV === "true";
}

export function isEsbuildSpawnPermissionFailure(value: unknown) {
  const message = value instanceof Error ? value.stack || value.message : String(value || "");
  const normalized = message.toLowerCase();
  return normalized.includes("esbuild") && normalized.includes("spawn") && normalized.includes("eperm");
}

export interface WorkerAuthContext {
  id: string;
  organizationId: string;
  status: string;
}

export interface ClaimedDesktopWorkerJob {
  jobType: "render";
  jobId: string;
  compositionId: string;
  resolvedProps: Record<string, unknown>;
  propsHash: string;
  bundleUrl: string;
  bundleHash: string;
  bundleType: "serve_url" | "zip";
  outputUploadUrl: string;
  outputStoragePath: string;
  timeoutInMilliseconds: number;
}

export interface ClaimedDesktopWorkerTemplateBuildJob {
  jobType: "template_build";
  jobId: string;
  buildId: string;
  templateVersionId: string;
  compositionId: string;
  exportMode: "component" | "root";
  bundleUrl: string;
  bundleHash: string;
  outputUploadUrl: string;
  outputStoragePath: string;
  timeoutInMilliseconds: number;
}

export interface ClaimedDesktopWorkerTemplatePreviewJob {
  jobType: "template_preview";
  jobId: string;
  previewId: string;
  templateId: string;
  templateVersionId: string;
  buildId: string;
  compositionId: string;
  resolvedProps: Record<string, unknown>;
  propsHash: string;
  bundleUrl: string;
  bundleHash: string;
  bundleType: "zip";
  posterUploadUrl: string;
  posterStoragePath: string;
  previewFrame: number;
  timeoutInMilliseconds: number;
}

export interface WorkerJobCompleteInput {
  outputStoragePath: string;
  checksum?: string;
  durationSeconds?: number;
  logsRef?: string;
  buildHash?: string;
  buildLog?: string;
}

type WorkerLocalRecoveryInput = {
  pendingUploads: number;
  pendingCompletes: number;
  pendingCleanup: number;
  retainedBytes: number;
  jobs?: Array<{
    jobId?: string;
    jobType?: string;
    remoteTable?: string;
    localState?: string;
    artifactReady?: boolean;
    artifactChecksum?: string;
    artifactSizeBytes?: number;
    cleanupPolicy?: string;
    cleanupStatus?: string;
  }>;
};

export interface ExternalTemplatePreviewData {
  serveUrl: string | null;
  compositionId: string;
  exportMode: "component" | "root";
  resolvedProps: Record<string, unknown>;
  propsHash: string;
  propsSource: string;
  propKeys: string[];
  buildHash: string | null;
  buildId: string;
  templateVersionId: string;
  bundleHash: string | null;
  previewId: string | null;
  previewStatus: "READY" | "MISSING" | "QUEUED" | "RUNNING" | "FAILED" | "STALE";
  previewError: string | null;
  previewVideoUrl: string | null;
  previewPosterUrl: string | null;
  previewDurationSeconds: number | null;
  previewFrames: number | null;
  compositionDurationSeconds: number | null;
  compositionFrames: number | null;
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

function readLocalRecovery(input: Record<string, unknown>): WorkerLocalRecoveryInput | null {
  const raw = input.localRecovery;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const source = raw as Record<string, unknown>;
  const jobs = Array.isArray(source.jobs)
    ? source.jobs
      .filter((job): job is Record<string, unknown> => Boolean(job && typeof job === "object" && !Array.isArray(job)))
      .slice(0, 25)
      .map((job) => ({
        jobId: typeof job.jobId === "string" ? job.jobId : undefined,
        jobType: typeof job.jobType === "string" ? job.jobType : undefined,
        remoteTable: typeof job.remoteTable === "string" ? job.remoteTable : undefined,
        localState: typeof job.localState === "string" ? job.localState : undefined,
        artifactReady: job.artifactReady === true,
        artifactChecksum: typeof job.artifactChecksum === "string" ? job.artifactChecksum : undefined,
        artifactSizeBytes: Number.isFinite(Number(job.artifactSizeBytes)) ? Math.max(0, Math.round(Number(job.artifactSizeBytes))) : undefined,
        cleanupPolicy: typeof job.cleanupPolicy === "string" ? job.cleanupPolicy : undefined,
        cleanupStatus: typeof job.cleanupStatus === "string" ? job.cleanupStatus : undefined,
      }))
    : undefined;

  return {
    pendingUploads: Math.max(0, Math.round(Number(source.pendingUploads || 0))),
    pendingCompletes: Math.max(0, Math.round(Number(source.pendingCompletes || 0))),
    pendingCleanup: Math.max(0, Math.round(Number(source.pendingCleanup || 0))),
    retainedBytes: Math.max(0, Math.round(Number(source.retainedBytes || 0))),
    jobs,
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

async function addDirectoryToZip(zip: JSZip, rootDir: string, currentDir = rootDir): Promise<void> {
  const entries = await fsp.readdir(currentDir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);
    const relativePath = path.relative(rootDir, fullPath).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      await addDirectoryToZip(zip, rootDir, fullPath);
    } else if (entry.isFile()) {
      zip.file(relativePath, await fsp.readFile(fullPath));
    }
  }
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function hasUnsafeZipPath(name: string) {
  const normalized = name.endsWith("/") ? name.slice(0, -1) : name;
  return (
    normalized.includes("..") ||
    normalized.includes("\\") ||
    normalized.startsWith("/") ||
    /^[a-zA-Z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment.length === 0 || segment === "." || segment.startsWith("."))
  );
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

function normalizeStoragePath(value: string): { bucket: string; path: string } {
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  const separatorIndex = normalized.indexOf("/");
  if (separatorIndex === -1) {
    return { bucket: TEMPLATE_BUNDLE_BUCKET, path: normalized };
  }
  return {
    bucket: normalized.slice(0, separatorIndex),
    path: normalized.slice(separatorIndex + 1),
  };
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
  const buildOutputStoragePath = readNonEmptyString(params.build.build_output_storage_path);
  const hasServeUrl = Boolean(serveUrl && /^https:\/\//i.test(serveUrl));
  const hasCompiledZip = Boolean(buildOutputStoragePath);

  if (!hasServeUrl && !hasCompiledZip) {
    throw new Error("EXTERNAL_RENDER_TARGET_INCOMPLETE: el build no tiene serve_url HTTPS ni ZIP compilado.");
  }

  const compositionId = [
    readNonEmptyString(params.build.composition_id),
    readNonEmptyString(params.version.composition_id),
  ].find(isValidCompositionId);

  if (!compositionId) {
    throw new Error("EXTERNAL_COMPOSITION_ID_MISSING: el bundle compilado no declaro composition_id valido.");
  }

  return {
    serveUrl: hasServeUrl ? serveUrl : null,
    buildOutputStoragePath: hasCompiledZip ? buildOutputStoragePath : null,
    compositionId,
    exportMode:
      params.build.export_mode === "root" || params.version.export_mode === "root"
        ? ("root" as const)
        : ("component" as const),
    buildHash: readNonEmptyString(params.build.build_hash) || readNonEmptyString(params.version.build_hash),
    bundleHash:
      readNonEmptyString(params.build.build_hash) ||
      readNonEmptyString(params.build.bundle_hash) ||
      readNonEmptyString(params.version.bundle_hash),
    cloudProvider: readNonEmptyString(params.build.cloud_provider),
  };
}

function resolveInternalCompositionId(value: unknown): string {
  return INTERNAL_COMPOSITION_IDS.includes(value as (typeof INTERNAL_COMPOSITION_IDS)[number])
    ? String(value)
    : DEFAULT_INTERNAL_COMPOSITION_ID;
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
  layoutOverrides?: unknown;
}) {
  const normalized = normalizeAssemblyAssets(params.assets, ASSEMBLY_FPS);
  const templateConfig = mergeTemplateRenderConfigs(params.templateConfig, null);
  const layoutOverrides = parseLayoutOverrideManifests(params.layoutOverrides);
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
    layoutOverrides,
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
  layoutContractVersion?: unknown;
  editableLayers?: unknown;
}) {
  const variables = input.variables ?? {};
  const parsedEditableLayers = editableLayerDefinitionSchema.array().safeParse(input.editableLayers ?? []);
  const supportsGlobalLayoutOverrides =
    Number(input.layoutContractVersion) >= TEMPLATE_LAYOUT_CONTRACT_VERSION &&
    parsedEditableLayers.success;
  const externalLayoutOverrides = supportsGlobalLayoutOverrides
    ? filterLayoutOverridesForEditableLayers(
        parseLayoutOverrideManifests(variables.layoutOverrides),
        parsedEditableLayers.data,
      )
    : [];
  const hasTemplateConfigInput = Boolean(input.templateDefaultConfig || variables.templateConfig);
  const templateConfig = mergeTemplateRenderConfigs(input.templateDefaultConfig, variables.templateConfig);
  const courseProps = buildAssemblyInputProps({
    assets: input.assets,
    compositionId: input.compositionId,
    transitionType: variables.transitionType,
    templateConfig,
    layoutOverrides: externalLayoutOverrides,
  });
  const overrides = extractExternalTemplateOverrides(variables);
  const resolvedProps = {
    ...(input.bundleDefaultProps || {}),
    ...(courseProps as Record<string, unknown>),
    ...(hasTemplateConfigInput
      ? {
          accentColor: templateConfig.accentColor,
          backgroundColor: templateConfig.backgroundColor,
          surfaceColor: templateConfig.surfaceColor,
        }
      : {}),
    ...(overrides || {}),
    layoutOverrides: externalLayoutOverrides,
  };
  validatePropsSchema(resolvedProps, input.propsSchema);
  return {
    resolvedProps,
    propsHash: buildStableHash(resolvedProps),
    propsSource: "courseforge-canonical-v1",
    propKeys: Object.keys(resolvedProps).sort(),
  };
}

function deriveCompositionTiming(props: Record<string, unknown>) {
  const totalFrames = Number(props.totalDurationInFrames);
  const fps = Number(props.fps);
  const hasValidFrames = Number.isFinite(totalFrames) && totalFrames > 0;
  const hasValidFps = Number.isFinite(fps) && fps > 0;

  return {
    compositionFrames: hasValidFrames ? Math.round(totalFrames) : null,
    compositionDurationSeconds: hasValidFrames && hasValidFps ? totalFrames / fps : null,
  };
}

function derivePreviewFrame(props: Record<string, unknown>) {
  const totalFrames = Number(props.totalDurationInFrames);
  if (!Number.isFinite(totalFrames) || totalFrames <= 1) return 0;
  return Math.max(0, Math.min(Math.round(totalFrames) - 1, Math.round(totalFrames * 0.18)));
}

function deriveLayoutOverridesHash(props: Record<string, unknown>) {
  return buildStableHash(props.layoutOverrides ?? []);
}

function buildTemplatePreviewCacheKey(params: {
  templateBuildId: string;
  materialComponentId?: string | null;
  propsHash: string;
  layoutOverridesHash: string;
  previewFrame: number;
}) {
  return buildStableHash({
    templateBuildId: params.templateBuildId,
    materialComponentId: params.materialComponentId || null,
    propsHash: params.propsHash,
    layoutOverridesHash: params.layoutOverridesHash || "",
    previewFrame: Math.max(0, Math.round(params.previewFrame)),
  });
}

function isMissingPreviewCacheKeyColumn(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const message = String(record.message || "");
  const code = String(record.code || "");
  return code === "42703" || (
    message.includes("remotion_template_previews.preview_cache_key") &&
    message.includes("does not exist")
  );
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
  if (!["PENDING", "QUEUED", "WAITING_PROVIDER", "RUNNING", "SUCCEEDED"].includes(job.status)) {
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
  const externalBuildStoragePath = typeof snapshot.externalBuildStoragePath === "string" ? snapshot.externalBuildStoragePath.trim() : "";
  const isInternalDesktopRender = snapshot.renderMode === "INTERNAL_COMPOSITION";
  const isDesktopRender =
    isInternalDesktopRender ||
    snapshot.renderMode === "EXTERNAL_DESKTOP_SITE_READY" ||
    (externalServeUrl && /^https:\/\//i.test(externalServeUrl)) ||
    Boolean(externalBuildStoragePath);

  if (!isDesktopRender) {
    throw new Error("DESKTOP_WORKER_REQUIRES_TEMPLATE_BUILD");
  }
  if (!/^https:\/\//i.test(externalServeUrl) && !externalBuildStoragePath) {
    throw new Error("DESKTOP_WORKER_BUNDLE_TARGET_INVALID");
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
    renderMode: isInternalDesktopRender ? "INTERNAL_COMPOSITION" : "EXTERNAL_DESKTOP_SITE_READY",
    compositionId: snapshot.compositionId,
    resolvedProps: snapshot.resolvedProps,
    propsHash,
    bundle: {
      signedUrl: externalServeUrl || externalBuildStoragePath,
      bundleHash: snapshot.bundleHash || snapshot.buildHash || snapshot.buildId || "external-desktop-site",
      storagePath: externalBuildStoragePath || externalServeUrl,
      bundleType: externalBuildStoragePath ? "zip" as const : "serve_url" as const,
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

  private async publishInternalBundle() {
    if (!internalBundlePromise) {
      internalBundlePromise = this.createAndUploadInternalBundle().catch((error) => {
        internalBundlePromise = null;
        throw error;
      });
    }

    const current = await internalBundlePromise;
    const { data: signed, error } = await this.supabase.storage
      .from(TEMPLATE_BUNDLE_BUCKET)
      .createSignedUrl(current.storagePath, SIGNED_URL_TTL_SECONDS);

    if (error || !signed?.signedUrl) {
      throw new Error(`INTERNAL_BUNDLE_SIGNED_URL_FAILED: ${error?.message || "Unknown error"}`);
    }

    return { ...current, signedUrl: signed.signedUrl, bundleType: "zip" as const };
  }

  private async createAndUploadInternalBundle() {
    const outDir = path.join(os.tmpdir(), `courseforge-internal-remotion-bundle-${process.pid}`);
    const entryPoint = this.resolveInternalRemotionEntryPoint();
    const { bundle } = await import("@remotion/bundler");
    await fsp.rm(outDir, { recursive: true, force: true });
    await bundle({ entryPoint, outDir });

    const indexPath = path.join(outDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      throw new Error("INTERNAL_BUNDLE_INVALID: Remotion no genero index.html para el bundle interno.");
    }

    const zip = new JSZip();
    zip.file("courseforge-internal-bundle.json", JSON.stringify({
      kind: "courseforge-internal-remotion-bundle",
      compositionIds: INTERNAL_COMPOSITION_IDS,
    }, null, 2));
    await addDirectoryToZip(zip, outDir);
    const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    const bundleHash = sha256Buffer(zipBuffer);
    const storagePath = `remotion-bundles/internal/${bundleHash}.zip`;

    const { error } = await this.supabase.storage
      .from(TEMPLATE_BUNDLE_BUCKET)
      .upload(storagePath, zipBuffer, {
        contentType: "application/zip",
        upsert: true,
      });

    if (error) {
      throw new Error(`INTERNAL_BUNDLE_UPLOAD_FAILED: ${error.message}`);
    }

    await fsp.rm(outDir, { recursive: true, force: true });
    return { bundleHash, storagePath, signedUrl: "", bundleType: "zip" as const };
  }

  private resolveInternalRemotionEntryPoint(): string {
    const candidates = [
      process.env.REMOTION_ENTRY_POINT ? path.resolve(process.env.REMOTION_ENTRY_POINT) : null,
      path.resolve(process.cwd(), "src/remotion/index.ts"),
      path.resolve(process.cwd(), "apps/web/src/remotion/index.ts"),
    ].filter((candidate): candidate is string => Boolean(candidate));
    const entryPoint = candidates.find((candidate) => fs.existsSync(candidate));

    if (!entryPoint) {
      throw new Error(
        `REMOTION_ENTRY_POINT_NOT_FOUND: configura REMOTION_ENTRY_POINT con apps/web/src/remotion/index.ts. Se intento "${candidates.join(", ")}".`,
      );
    }

    return entryPoint;
  }

  async getExternalTemplatePreviewData(input: {
    templateId: string;
    componentId?: string | null;
    variables: Record<string, unknown>;
    organizationIds: string[];
  }): Promise<ExternalTemplatePreviewData> {
    const { data: templateRecord, error: templateError } = await this.supabase
      .from("remotion_templates")
      .select("id, organization_id, storage_path, composition_id, default_config")
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
      .select("id, bundle_hash, build_hash, composition_id, export_mode, status, default_props, props_schema, manifest, editable_layers")
      .eq("template_id", input.templateId)
      .in("status", ["APPROVED_FOR_SANDBOX", "APPROVED"])
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: cloudBuild } = cloudVersion?.id
      ? await this.supabase
          .from("remotion_template_builds")
          .select("id, bundle_hash, build_hash, serve_url, build_output_storage_path, composition_id, export_mode, status, cloud_provider")
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

    let componentAssets: unknown = {};
    if (input.componentId) {
      const { data: component, error: componentError } = await this.supabase
        .from("material_components")
        .select(
          `
            id, assets,
            material_lessons (
              materials (
                artifacts ( organization_id )
              )
            )
          `,
        )
        .eq("id", input.componentId)
        .maybeSingle();

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
      componentAssets = component.assets || {};
    }

    const externalTarget = resolveExternalDesktopRenderTarget({
      version: cloudVersion,
      build: cloudBuild,
    });
    const propsResult = buildExternalTemplateProps({
      assets: componentAssets,
      compositionId: externalTarget.compositionId,
      templateDefaultConfig: templateRecord.default_config,
      variables: input.variables,
      bundleDefaultProps: cloudVersion.default_props,
      propsSchema: cloudVersion.props_schema,
      layoutContractVersion: cloudVersion.manifest?.layoutContractVersion,
      editableLayers: cloudVersion.editable_layers,
    });
    const timing = deriveCompositionTiming(propsResult.resolvedProps);
    const layoutOverridesHash = deriveLayoutOverridesHash(propsResult.resolvedProps);
    let previewQuery = this.supabase
      .from("remotion_template_previews")
      .select("id, status, preview_poster_storage_path, preview_video_storage_path, preview_duration_seconds, preview_frames, error_message, updated_at, props_hash, layout_overrides_hash")
      .eq("template_build_id", cloudBuild.id);
    previewQuery = input.componentId
      ? previewQuery.eq("material_component_id", input.componentId)
      : previewQuery.is("material_component_id", null);
    const { data: previews } = await previewQuery
      .order("created_at", { ascending: false })
      .limit(5);
    const exactPreview = (previews || []).find((preview: any) =>
      preview.props_hash === propsResult.propsHash &&
      (preview.layout_overrides_hash || "") === layoutOverridesHash,
    );
    const latestSuccessfulPreview = (previews || []).find((preview: any) => preview.status === "SUCCEEDED") || null;
    const preview = exactPreview || null;
    const visualPreview = preview?.status === "SUCCEEDED" ? preview : latestSuccessfulPreview;
    const previewPosterPath = visualPreview ? readNonEmptyString(visualPreview.preview_poster_storage_path) : null;
    const previewVideoPath = visualPreview ? readNonEmptyString(visualPreview.preview_video_storage_path) : null;
    const previewPosterUrl = previewPosterPath
      ? this.supabase.storage.from(VIDEO_BUCKET).getPublicUrl(previewPosterPath).data.publicUrl
      : null;
    const previewVideoUrl = previewVideoPath
      ? this.supabase.storage.from(VIDEO_BUCKET).getPublicUrl(previewVideoPath).data.publicUrl
      : null;
    const previewStatus = preview?.status === "SUCCEEDED"
      ? "READY"
      : preview?.status === "QUEUED"
        ? "QUEUED"
        : preview?.status === "RUNNING"
          ? "RUNNING"
          : preview?.status === "FAILED"
            ? "FAILED"
            : latestSuccessfulPreview
              ? "STALE"
              : "MISSING";

    return {
      serveUrl: externalTarget.serveUrl,
      compositionId: externalTarget.compositionId,
      exportMode: externalTarget.exportMode,
      resolvedProps: propsResult.resolvedProps,
      propsHash: propsResult.propsHash,
      propsSource: propsResult.propsSource,
      propKeys: propsResult.propKeys,
      buildHash: externalTarget.buildHash || null,
      buildId: cloudBuild.id,
      templateVersionId: cloudVersion.id,
      bundleHash: externalTarget.bundleHash || null,
      previewId: preview?.id || null,
      previewStatus,
      previewError: preview?.status === "FAILED"
        ? sanitizeText(preview.error_message, "Preview fallido")
        : previewStatus === "STALE" && latestSuccessfulPreview
          ? "Mostrando el ultimo preview disponible mientras se genera la version actualizada."
          : null,
      previewVideoUrl,
      previewPosterUrl,
      previewDurationSeconds: visualPreview && Number.isFinite(visualPreview.preview_duration_seconds) ? Number(visualPreview.preview_duration_seconds) : null,
      previewFrames: visualPreview && Number.isFinite(visualPreview.preview_frames) ? Number(visualPreview.preview_frames) : null,
      compositionDurationSeconds: timing.compositionDurationSeconds,
      compositionFrames: timing.compositionFrames,
    };
  }

  async requestExternalTemplatePreview(input: {
    templateId: string;
    componentId?: string | null;
    variables: Record<string, unknown>;
    organizationIds: string[];
    userId?: string | null;
  }) {
    const previewData = await this.getExternalTemplatePreviewData(input);
    if (
      previewData.previewId &&
      ["READY", "QUEUED", "RUNNING"].includes(previewData.previewStatus)
    ) {
      return {
        previewId: previewData.previewId,
        status: previewData.previewStatus,
        data: previewData,
      };
    }

    const { data: build, error: buildError } = await this.supabase
      .from("remotion_template_builds")
      .select("id, organization_id, template_version_id, bundle_hash, build_hash")
      .eq("id", previewData.buildId)
      .maybeSingle();

    if (buildError || !build) throw new Error("TEMPLATE_BUILD_NOT_FOUND");
    if (!input.organizationIds.includes(build.organization_id)) {
      throw new Error("FORBIDDEN_TEMPLATE_ORGANIZATION");
    }

    const now = new Date().toISOString();
    const layoutOverridesHash = deriveLayoutOverridesHash(previewData.resolvedProps);
    const previewFrame = derivePreviewFrame(previewData.resolvedProps);
    const previewCacheKey = buildTemplatePreviewCacheKey({
      templateBuildId: previewData.buildId,
      materialComponentId: input.componentId || null,
      propsHash: previewData.propsHash,
      layoutOverridesHash,
      previewFrame,
    });

    const { data: existingPreview, error: existingPreviewError } = await this.supabase
      .from("remotion_template_previews")
      .select("*")
      .eq("organization_id", build.organization_id)
      .eq("preview_cache_key", previewCacheKey)
      .maybeSingle();
    const supportsPreviewCacheKey = !isMissingPreviewCacheKeyColumn(existingPreviewError);

    if (existingPreviewError && supportsPreviewCacheKey) {
      throw new Error(`TEMPLATE_PREVIEW_LOOKUP_FAILED: ${existingPreviewError.message}`);
    }

    if (supportsPreviewCacheKey && existingPreview) {
      if (["QUEUED", "RUNNING", "SUCCEEDED"].includes(existingPreview.status)) {
        return {
          previewId: existingPreview.id,
          status: existingPreview.status === "SUCCEEDED" ? "READY" as const : existingPreview.status as "QUEUED" | "RUNNING",
          data: {
            ...previewData,
            previewId: existingPreview.id,
            previewStatus: existingPreview.status === "SUCCEEDED" ? "READY" as const : existingPreview.status as "QUEUED" | "RUNNING",
            previewError: null,
          },
        };
      }

      const { data: requeuedPreview, error: requeueError } = await this.supabase
        .from("remotion_template_previews")
        .update({
          status: "QUEUED",
          worker_id: null,
          claimed_at: null,
          worker_heartbeat_at: null,
          lease_expires_at: null,
          provider_status: "QUEUED",
          provider_status_detail: "Preview reencolado para worker local.",
          error_code: null,
          error_message: null,
          failed_at: null,
          requested_by: input.userId || existingPreview.requested_by || null,
          updated_at: now,
          progress: [
            safeJobProgressEntry({
              percent: 0,
              message: "Preview externo reencolado para worker local",
              stage: "template_preview_requeued",
              workerId: "system",
            }),
          ],
        })
        .eq("id", existingPreview.id)
        .select("*")
        .single();

      if (requeueError || !requeuedPreview) {
        throw new Error(`TEMPLATE_PREVIEW_REQUEUE_FAILED: ${requeueError?.message || "Unknown error"}`);
      }

      return {
        previewId: requeuedPreview.id,
        status: "QUEUED" as const,
        data: {
          ...previewData,
          previewId: requeuedPreview.id,
          previewStatus: "QUEUED" as const,
          previewError: null,
        },
      };
    }

    const previewInsert: Record<string, unknown> = {
      organization_id: build.organization_id,
      template_id: input.templateId,
      template_version_id: previewData.templateVersionId,
      template_build_id: previewData.buildId,
      material_component_id: input.componentId || null,
      status: "QUEUED",
      props_hash: previewData.propsHash,
      layout_overrides_hash: layoutOverridesHash,
      resolved_props: previewData.resolvedProps,
      composition_id: previewData.compositionId,
      bundle_hash: previewData.bundleHash || build.bundle_hash || null,
      build_hash: previewData.buildHash || build.build_hash || null,
      preview_frame: previewFrame,
      provider_status: "QUEUED",
      provider_status_detail: supportsPreviewCacheKey
        ? "Esperando que un worker local genere el poster de preview."
        : "Esperando worker local. Idempotencia avanzada pendiente de migracion preview_cache_key.",
      progress: [
        safeJobProgressEntry({
          percent: 0,
          message: "Preview externo encolado para worker local",
          stage: "template_preview_queued",
          workerId: "system",
        }),
      ],
      requested_by: input.userId || null,
      created_at: now,
      updated_at: now,
    };
    if (supportsPreviewCacheKey) {
      previewInsert.preview_cache_key = previewCacheKey;
    }

    const { data: preview, error: previewError } = await this.supabase
      .from("remotion_template_previews")
      .insert(previewInsert)
      .select("*")
      .single();

    if (previewError || !preview) {
      throw new Error(`TEMPLATE_PREVIEW_CREATE_FAILED: ${previewError?.message || "Unknown error"}`);
    }

    return {
      previewId: preview.id,
      status: "QUEUED" as const,
      data: {
        ...previewData,
        previewId: preview.id,
        previewStatus: "QUEUED" as const,
        previewError: null,
      },
    };
  }

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
    const localRecovery = readLocalRecovery(input);
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
        last_capacity_report: localRecovery
          ? { ...capacity.report, localRecovery: { ...localRecovery, jobs: undefined } }
          : capacity.report,
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

    if (localRecovery) {
      await this.recordWorkerLocalRecovery(worker, localRecovery, now);
    }

    return { ...data, status: resolveComputedWorkerStatus(data) };
  }

  private async recordWorkerLocalRecovery(
    worker: WorkerAuthContext,
    recovery: WorkerLocalRecoveryInput,
    now: string,
  ) {
    const rows = (recovery.jobs || [])
      .filter((job) => job.jobId && job.jobType && job.remoteTable && job.localState)
      .map((job) => ({
        worker_id: worker.id,
        organization_id: worker.organizationId,
        remote_table: sanitizeText(job.remoteTable, "production_jobs"),
        remote_job_id: job.jobId,
        job_type: sanitizeText(job.jobType, "render"),
        local_state: sanitizeText(job.localState, "unknown"),
        artifact_ready: job.artifactReady === true,
        artifact_checksum: sanitizeText(job.artifactChecksum, "") || null,
        artifact_size_bytes: job.artifactSizeBytes || null,
        cleanup_policy: sanitizeText(job.cleanupPolicy, ""),
        cleanup_status: sanitizeText(job.cleanupStatus, ""),
        last_reported_at: now,
        metadata: {},
      }));
    if (rows.length === 0) return;

    await this.supabase
      .from("render_worker_job_recovery_states")
      .upsert(rows, { onConflict: "worker_id,remote_table,remote_job_id" });
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
      const compositionId = resolveInternalCompositionId(templateRecord.composition_id);
      const templateConfig = mergeTemplateRenderConfigs(
        templateRecord.default_config,
        input.variables?.templateConfig,
      );
      const resolvedProps = buildAssemblyInputProps({
        assets: component.assets || {},
        compositionId,
        transitionType: input.variables?.transitionType,
        templateConfig,
        layoutOverrides: input.variables?.layoutOverrides,
      });
      const propsHash = buildStableHash(resolvedProps);
      const bundleInfo = await this.publishInternalBundle();
      const renderMode = "INTERNAL_COMPOSITION";
      const inputSnapshot = {
        templateId: input.templateId,
        templateVersionId: null,
        bundleHash: bundleInfo.bundleHash,
        buildId: null,
        buildHash: null,
        compositionId,
        exportMode: "component",
        externalServeUrl: null,
        externalBuildStoragePath: `${TEMPLATE_BUNDLE_BUCKET}/${bundleInfo.storagePath}`,
        cloudProvider: "internal",
        renderMode,
        renderProvider: "desktop_worker",
        propsHash,
        propsSource: "courseforge-internal-v1",
        resolvedProps,
        propKeys: Object.keys(resolvedProps).sort(),
        renderDiagnostics: buildRenderDiagnostics({
          renderMode,
          inputProps: resolvedProps,
          rawAssets: component.assets || {},
          templateId: input.templateId,
          templateVersionId: null,
          buildId: null,
          bundleHash: bundleInfo.bundleHash,
          buildHash: null,
          compositionId,
          propsHash,
        }),
        variables: input.variables,
        renderBatchId: input.renderBatchId || null,
        preferredWorkerId: input.preferredWorkerId || null,
      };
      const idempotencyKey = buildRenderIdempotencyKey({
        componentId: input.componentId,
        templateId: input.templateId,
        templateVersionId: null,
        bundleHash: bundleInfo.bundleHash,
        buildId: null,
        buildHash: null,
        serveUrl: null,
        propsHash,
        compositionId,
        exportMode: "component",
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
          const resetJob = await this.resetDesktopJob(existingJob.id, inputSnapshot, "Reintentando render interno: el worker asignado ya no esta disponible");
          return {
            jobId: resetJob.id,
            status: resetJob.status,
            renderProvider: "desktop_worker",
            message: "Stale internal desktop worker job reset",
          };
        }
      }

      if (existingJob?.status === "SUCCEEDED" && !componentHasFinalVideo) {
        const resetJob = await this.resetDesktopJob(existingJob.id, inputSnapshot, "Reintentando render interno: el componente no tiene video final");
        return {
          jobId: resetJob.id,
          status: resetJob.status,
          renderProvider: "desktop_worker",
          message: "Completed internal desktop worker job without component final video reset",
        };
      }

      if (existingJob && !["FAILED", "CANCELLED"].includes(existingJob.status)) {
        return {
          jobId: existingJob.id,
          status: existingJob.status,
          renderProvider: "desktop_worker",
          message: "Internal rendering job reused by idempotency key",
        };
      }

      if (existingJob) {
        const resetJob = await this.resetDesktopJob(existingJob.id, inputSnapshot, "Reintentando render interno con worker local");
        return {
          jobId: resetJob.id,
          status: resetJob.status,
          renderProvider: "desktop_worker",
          message: "Failed internal desktop worker job reset",
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
              message: "Job de render interno creado para worker local",
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
        message: "Internal desktop worker job waiting for local worker",
      };
    }

    const { data: cloudVersion } = await this.supabase
      .from("remotion_template_versions")
      .select("id, bundle_hash, build_hash, composition_id, export_mode, status, default_props, props_schema, manifest, editable_layers")
      .eq("template_id", input.templateId)
      .in("status", ["APPROVED_FOR_SANDBOX", "APPROVED"])
      .order("version_number", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data: cloudBuild } = cloudVersion?.id
      ? await this.supabase
          .from("remotion_template_builds")
          .select("id, bundle_hash, build_hash, serve_url, build_output_storage_path, composition_id, export_mode, status, cloud_provider")
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
      layoutContractVersion: cloudVersion.manifest?.layoutContractVersion,
      editableLayers: cloudVersion.editable_layers,
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
      externalBuildStoragePath: externalTarget.buildOutputStoragePath,
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

  async startTemplateBuild(input: {
    templateVersionId: string;
    organizationIds: string[];
  }) {
    const { data: version, error: versionError } = await this.supabase
      .from("remotion_template_versions")
      .select("id, template_id, organization_id, status, storage_path, bundle_hash, composition_id, export_mode")
      .eq("id", input.templateVersionId)
      .maybeSingle();

    if (versionError || !version) throw new Error("TEMPLATE_VERSION_NOT_FOUND");
    if (!input.organizationIds.includes(version.organization_id)) throw new Error("FORBIDDEN_TEMPLATE_ORGANIZATION");
    if (!["APPROVED_FOR_SANDBOX", "APPROVED"].includes(version.status)) {
      throw new Error(`TEMPLATE_VERSION_NOT_APPROVED: ${version.status}`);
    }
    if (!version.bundle_hash || !version.composition_id || !version.storage_path) {
      throw new Error("TEMPLATE_VERSION_BUILD_METADATA_MISSING");
    }

    const { data: reusableRows } = await this.supabase
      .from("remotion_template_builds")
      .select("*")
      .eq("template_version_id", version.id)
      .eq("bundle_hash", version.bundle_hash)
      .eq("composition_id", version.composition_id)
      .eq("export_mode", version.export_mode === "root" ? "root" : "component")
      .eq("cloud_provider", "desktop_worker")
      .in("status", ["BUILDING", "BUILT"])
      .order("created_at", { ascending: false })
      .limit(1);

    const reusable = reusableRows?.[0];
    if (reusable?.status === "BUILT" && reusable.build_hash && reusable.build_output_storage_path) {
      return {
        success: true,
        buildId: reusable.id,
        status: "BUILT",
        providerBuildId: reusable.provider_build_id || null,
        serveUrl: reusable.serve_url || null,
        buildOutputStoragePath: reusable.build_output_storage_path,
      };
    }
    if (reusable?.status === "BUILDING") {
      return {
        success: true,
        buildId: reusable.id,
        status: "BUILDING",
        providerBuildId: reusable.provider_build_id || null,
        serveUrl: reusable.serve_url || null,
        buildOutputStoragePath: reusable.build_output_storage_path || null,
      };
    }

    const useServerBundler = shouldUseTemplateServerBundler();
    const { data: build, error: buildError } = await this.supabase
      .from("remotion_template_builds")
      .insert({
        template_version_id: version.id,
        organization_id: version.organization_id,
        status: "BUILDING",
        bundle_hash: version.bundle_hash,
        composition_id: version.composition_id,
        export_mode: version.export_mode === "root" ? "root" : "component",
        cloud_provider: "desktop_worker",
        provider_status: useServerBundler ? "SERVER_BUNDLER" : "QUEUED",
        provider_status_detail: useServerBundler
          ? "Compilando plantilla con el bundler local del servidor."
          : "Esperando que un worker local reclame este build.",
        source_storage_path: version.storage_path,
        security_profile: {
          isolation: useServerBundler ? "server-bundler" : "desktop-worker",
          secrets: "none-from-courseforge",
          artifactContract: "compiled-remotion-zip",
        },
        build_log: useServerBundler
          ? "Template build started with local server bundler."
          : "Template build queued for SofLIA desktop worker.",
      })
      .select("*")
      .single();

    if (buildError || !build) throw new Error(`TEMPLATE_BUILD_CREATE_FAILED: ${buildError?.message || "Unknown error"}`);

    await this.supabase
      .from("remotion_template_versions")
      .update({ build_status: "BUILDING" })
      .eq("id", version.id);

    if (useServerBundler) {
      return this.buildTemplateWithServerBundler(version, build);
    }

    return {
      success: true,
      buildId: build.id,
      status: "BUILDING",
      providerBuildId: build.provider_build_id || null,
      serveUrl: null,
      buildOutputStoragePath: null,
      message: "Template build queued for SofLIA desktop worker.",
    };
  }

  async getTemplateBuildStatus(buildId: string, organizationIds: string[]) {
    const { data: build, error } = await this.supabase
      .from("remotion_template_builds")
      .select("*")
      .eq("id", buildId)
      .maybeSingle();

    if (error || !build) throw new Error("TEMPLATE_BUILD_NOT_FOUND");
    if (!organizationIds.includes(build.organization_id)) throw new Error("FORBIDDEN_TEMPLATE_ORGANIZATION");

    return {
      success: true,
      buildId: build.id,
      status: build.status,
      providerStatus: build.provider_status || null,
      providerStatusDetail: build.provider_status_detail || null,
      providerBuildId: build.provider_build_id || null,
      serveUrl: build.serve_url || null,
      buildOutputStoragePath: build.build_output_storage_path || null,
      buildLogStoragePath: build.build_log_storage_path || null,
      error: build.build_error || null,
    };
  }

  async claimNextJob(worker: WorkerAuthContext) {
    const claimLimit = await this.getWorkerAvailableClaimSlots(worker.id);
    if (claimLimit <= 0) {
      await this.heartbeat(worker, { status: "BUSY" });
      return null;
    }

    const claimedTemplateBuilds = await this.claimTemplateBuilds(worker, claimLimit);
    if (claimedTemplateBuilds.length > 0) {
      let payloads: ClaimedDesktopWorkerTemplateBuildJob[];
      try {
        payloads = await Promise.all(claimedTemplateBuilds.map((build: any) => this.buildClaimedTemplateBuildPayload(build)));
      } catch (error) {
        await this.releaseTemplateBuildClaims(
          worker.id,
          claimedTemplateBuilds.map((build: any) => build.id),
          sanitizeText(error instanceof Error ? error.message : String(error), "No se pudo preparar el build para el worker."),
        );
        throw error;
      }
      await this.heartbeat(worker, { status: "BUSY", activeJobIds: payloads.map((job) => job.jobId) });
      return payloads.length === 1 ? payloads[0] : { jobs: payloads };
    }

    const previewLimit = await this.getWorkerAvailableClaimSlots(worker.id);
    const claimedTemplatePreviews = previewLimit > 0
      ? await this.claimTemplatePreviews(worker, previewLimit)
      : [];
    if (claimedTemplatePreviews.length > 0) {
      const payloads: ClaimedDesktopWorkerTemplatePreviewJob[] = [];
      for (const preview of claimedTemplatePreviews) {
        try {
          payloads.push(await this.buildClaimedTemplatePreviewPayload(preview));
        } catch (error) {
          const message = sanitizeText(
            error instanceof Error ? error.message : String(error),
            "No se pudo preparar el preview para el worker.",
          );
          await this.failTemplatePreview(worker, preview, {
            message,
            errorCode: "TEMPLATE_PREVIEW_PAYLOAD_PREPARE_FAILED",
          });
        }
      }

      if (payloads.length > 0) {
        await this.heartbeat(worker, { status: "BUSY", activeJobIds: payloads.map((job) => job.jobId) });
        return payloads.length === 1 ? payloads[0] : { jobs: payloads };
      }
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
    const bundleUrl = await this.createWorkerBundleSignedUrl(resolved.bundle);
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
      jobType: "render" as const,
      jobId,
      compositionId: resolved.compositionId,
      resolvedProps: resolved.resolvedProps,
      propsHash: resolved.propsHash,
      bundleUrl,
      bundleHash: resolved.bundle.bundleHash,
      bundleType: resolved.bundle.bundleType,
      outputUploadUrl: signedUpload.signedUrl,
      outputStoragePath,
      timeoutInMilliseconds: Number(process.env.REMOTION_LOCAL_RENDER_TIMEOUT_MS || 900000),
    };
  }

  private async countRunningJobsByWorker(workerIds: string[]) {
    if (workerIds.length === 0) return new Map<string, number>();
    const now = new Date().toISOString();
    const [{ data }, { data: buildRows }, { data: previewRows }] = await Promise.all([
      this.supabase
      .from("production_jobs")
      .select("worker_id")
      .in("worker_id", workerIds)
      .eq("job_type", "REMOTION_RENDER")
        .eq("status", "RUNNING")
        .gt("lease_expires_at", now),
      this.supabase
        .from("remotion_template_builds")
        .select("worker_id")
        .in("worker_id", workerIds)
        .eq("cloud_provider", "desktop_worker")
        .eq("status", "BUILDING")
        .gt("lease_expires_at", now),
      this.supabase
        .from("remotion_template_previews")
        .select("worker_id")
        .in("worker_id", workerIds)
        .eq("status", "RUNNING")
        .gt("lease_expires_at", now),
    ]);

    const counts = new Map<string, number>();
    for (const row of data || []) {
      if (row.worker_id) counts.set(row.worker_id, (counts.get(row.worker_id) || 0) + 1);
    }
    for (const row of buildRows || []) {
      if (row.worker_id) counts.set(row.worker_id, (counts.get(row.worker_id) || 0) + 1);
    }
    for (const row of previewRows || []) {
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

  private async claimTemplateBuilds(worker: WorkerAuthContext, limit: number) {
    const { data: candidates, error } = await this.supabase
      .from("remotion_template_builds")
      .select("*")
      .eq("organization_id", worker.organizationId)
      .eq("status", "BUILDING")
      .eq("cloud_provider", "desktop_worker")
      .or(`worker_id.is.null,worker_id.eq.${worker.id},lease_expires_at.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`TEMPLATE_BUILD_NEXT_LOOKUP_FAILED: ${error.message}`);

    const claimed: any[] = [];
    for (const candidate of candidates || []) {
      const { data: updated } = await this.supabase
        .from("remotion_template_builds")
        .update({
          worker_id: worker.id,
          claimed_at: candidate.claimed_at || new Date().toISOString(),
          worker_heartbeat_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
          provider_build_id: worker.id,
          provider_status: "RUNNING",
          provider_status_detail: "Claimed by desktop worker.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .eq("status", "BUILDING")
        .select("*")
        .maybeSingle();

      if (updated) claimed.push(updated);
      if (claimed.length >= limit) break;
    }

    return claimed;
  }

  private async releaseTemplateBuildClaims(workerId: string, buildIds: string[], detail: string) {
    if (buildIds.length === 0) return;
    await this.supabase
      .from("remotion_template_builds")
      .update({
        worker_id: null,
        claimed_at: null,
        worker_heartbeat_at: null,
        lease_expires_at: null,
        provider_build_id: null,
        provider_status: "QUEUED",
        provider_status_detail: `Esperando worker: ${detail}`.slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .in("id", buildIds)
      .eq("worker_id", workerId)
      .eq("status", "BUILDING")
      .eq("cloud_provider", "desktop_worker");
  }

  private async claimTemplatePreviews(worker: WorkerAuthContext, limit: number) {
    const { data: candidates, error } = await this.supabase
      .from("remotion_template_previews")
      .select("*")
      .eq("organization_id", worker.organizationId)
      .in("status", ["QUEUED", "RUNNING"])
      .or(`worker_id.is.null,worker_id.eq.${worker.id},lease_expires_at.lte.${new Date().toISOString()}`)
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) throw new Error(`TEMPLATE_PREVIEW_NEXT_LOOKUP_FAILED: ${error.message}`);

    const claimed: any[] = [];
    for (const candidate of candidates || []) {
      const { data: updated } = await this.supabase
        .from("remotion_template_previews")
        .update({
          status: "RUNNING",
          worker_id: worker.id,
          claimed_at: candidate.claimed_at || new Date().toISOString(),
          worker_heartbeat_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
          provider_status: "RUNNING",
          provider_status_detail: "Claimed by desktop worker.",
          updated_at: new Date().toISOString(),
        })
        .eq("id", candidate.id)
        .in("status", ["QUEUED", "RUNNING"])
        .select("*")
        .maybeSingle();

      if (updated) claimed.push(updated);
      if (claimed.length >= limit) break;
    }

    return claimed;
  }

  private async buildClaimedTemplateBuildPayload(build: any): Promise<ClaimedDesktopWorkerTemplateBuildJob> {
    const { data: version, error: versionError } = await this.supabase
      .from("remotion_template_versions")
      .select("id, storage_path, bundle_hash, composition_id, export_mode")
      .eq("id", build.template_version_id)
      .maybeSingle();

    if (versionError || !version) throw new Error("TEMPLATE_VERSION_NOT_FOUND");
    const sourceLocation = normalizeStoragePath(version.storage_path);
    const { data: sourceSigned, error: sourceError } = await this.supabase.storage
      .from(sourceLocation.bucket)
      .createSignedUrl(sourceLocation.path, Number(process.env.DESKTOP_WORKER_SIGNED_URL_TTL_SECONDS || 3600));

    if (sourceError || !sourceSigned?.signedUrl) {
      throw new Error(`TEMPLATE_SOURCE_SIGNED_URL_FAILED: ${sourceError?.message || "Unknown error"}`);
    }

    const outputStoragePath = `template-builds/${build.id}/${version.bundle_hash}.zip`;
    const { data: outputSigned, error: outputError } = await this.supabase.storage
      .from(TEMPLATE_BUNDLE_BUCKET)
      .createSignedUploadUrl(outputStoragePath, { upsert: true });

    if (outputError || !outputSigned?.signedUrl) {
      throw new Error(`TEMPLATE_BUILD_UPLOAD_URL_FAILED: ${outputError?.message || "Unknown error"}`);
    }

    return {
      jobType: "template_build",
      jobId: build.id,
      buildId: build.id,
      templateVersionId: version.id,
      compositionId: version.composition_id,
      exportMode: version.export_mode === "root" ? "root" : "component",
      bundleUrl: sourceSigned.signedUrl,
      bundleHash: version.bundle_hash,
      outputUploadUrl: outputSigned.signedUrl,
      outputStoragePath: `${TEMPLATE_BUNDLE_BUCKET}/${outputStoragePath}`,
      timeoutInMilliseconds: Number(process.env.EXTERNAL_TEMPLATE_RENDER_TIMEOUT_MS || 900000),
    };
  }

  private async buildTemplateWithServerBundler(version: any, build: any) {
    const sourceLocation = normalizeStoragePath(version.storage_path);
    const outputStoragePath = `template-builds/${build.id}/${version.bundle_hash}.zip`;
    const workspaceBuildRoot = path.resolve(process.cwd(), ".tmp", "template-builds", build.id);
    const sourceDir = path.join(workspaceBuildRoot, "source");
    const outDir = path.join(workspaceBuildRoot, "compiled");

    try {
      await fsp.rm(workspaceBuildRoot, { recursive: true, force: true });
      await fsp.mkdir(sourceDir, { recursive: true });

      const { data: sourceBlob, error: downloadError } = await this.supabase.storage
        .from(sourceLocation.bucket)
        .download(sourceLocation.path);

      if (downloadError || !sourceBlob) {
        throw new Error(`TEMPLATE_SOURCE_DOWNLOAD_FAILED: ${downloadError?.message || "Unknown error"}`);
      }

      const sourceBuffer = Buffer.from(await sourceBlob.arrayBuffer());
      const sourceZip = await JSZip.loadAsync(sourceBuffer);

      for (const [name, file] of Object.entries(sourceZip.files)) {
        if (file.dir) continue;
        if (hasUnsafeZipPath(name)) {
          throw new Error(`TEMPLATE_SOURCE_UNSAFE_PATH: ${name}`);
        }

        const targetPath = path.join(sourceDir, name.replace(/\//g, path.sep));
        await fsp.mkdir(path.dirname(targetPath), { recursive: true });
        await fsp.writeFile(targetPath, Buffer.from(await file.async("uint8array")));
      }

      const entryPoint = path.join(sourceDir, version.entry_point || "src/index.tsx");
      if (!fs.existsSync(entryPoint)) {
        throw new Error(`TEMPLATE_ENTRYPOINT_NOT_FOUND: ${version.entry_point || "src/index.tsx"}`);
      }

      const { bundle } = await import("@remotion/bundler");
      await bundle({ entryPoint, outDir });

      const indexPath = path.join(outDir, "index.html");
      if (!fs.existsSync(indexPath)) {
        throw new Error("REMOTION_BUNDLE_INVALID: Remotion no genero index.html para el bundle compilado.");
      }

      const zip = new JSZip();
      zip.file("courseforge-compiled-remotion-template.json", JSON.stringify({
        kind: "courseforge-compiled-remotion-template",
        sourceBundleHash: version.bundle_hash,
        compositionId: version.composition_id,
        exportMode: version.export_mode === "root" ? "root" : "component",
        remotionVersion: "4.0.484",
        builtAt: new Date().toISOString(),
      }, null, 2));
      await addDirectoryToZip(zip, outDir);

      const zipBuffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
      const buildHash = sha256Buffer(zipBuffer);
      const { error: uploadError } = await this.supabase.storage
        .from(TEMPLATE_BUNDLE_BUCKET)
        .upload(outputStoragePath, zipBuffer, {
          contentType: "application/zip",
          upsert: true,
        });

      if (uploadError) {
        throw new Error(`TEMPLATE_BUILD_UPLOAD_FAILED: ${uploadError.message}`);
      }

      const builtAt = new Date().toISOString();
      const buildLog = `Server bundler completed. validated remotionVersion=4.0.484 compositionId=${version.composition_id}`;
      const { error: buildUpdateError } = await this.supabase
        .from("remotion_template_builds")
        .update({
          status: "BUILT",
          build_hash: buildHash,
          build_output_storage_path: `${TEMPLATE_BUNDLE_BUCKET}/${outputStoragePath}`,
          provider_status: "SUCCEEDED",
          provider_status_detail: null,
          build_log: buildLog,
          built_at: builtAt,
          output_checksum: buildHash,
          updated_at: builtAt,
        })
        .eq("id", build.id);

      if (buildUpdateError) {
        throw new Error(`TEMPLATE_BUILD_UPDATE_FAILED: ${buildUpdateError.message}`);
      }

      await this.supabase
        .from("remotion_template_versions")
        .update({
          build_status: "BUILT",
          build_hash: buildHash,
          build_output_path: `${TEMPLATE_BUNDLE_BUCKET}/${outputStoragePath}`,
          built_at: builtAt,
        })
        .eq("id", version.id);

      return {
        success: true,
        buildId: build.id,
        status: "BUILT",
        providerBuildId: null,
        serveUrl: null,
        buildOutputStoragePath: `${TEMPLATE_BUNDLE_BUCKET}/${outputStoragePath}`,
        message: "Template compiled locally by server bundler.",
      };
    } catch (error) {
      const message = sanitizeText(error instanceof Error ? error.message : String(error), "No se pudo compilar la plantilla");
      const failedAt = new Date().toISOString();
      await this.supabase
        .from("remotion_template_builds")
        .update({
          status: "BUILD_FAILED",
          provider_status: "SERVER_TEMPLATE_BUILD_FAILED",
          provider_status_detail: message,
          build_error: message,
          build_failed_at: failedAt,
          updated_at: failedAt,
        })
        .eq("id", build.id);
      await this.supabase
        .from("remotion_template_versions")
        .update({ build_status: "BUILD_FAILED" })
        .eq("id", version.id);
      throw new Error(message);
    } finally {
      await fsp.rm(workspaceBuildRoot, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async buildClaimedTemplatePreviewPayload(preview: any): Promise<ClaimedDesktopWorkerTemplatePreviewJob> {
    const { data: build, error: buildError } = await this.supabase
      .from("remotion_template_builds")
      .select("id, build_output_storage_path, build_hash, bundle_hash, status")
      .eq("id", preview.template_build_id)
      .maybeSingle();

    if (buildError || !build) throw new Error("TEMPLATE_BUILD_NOT_FOUND");
    if (build.status !== "BUILT" || !build.build_output_storage_path) {
      throw new Error("TEMPLATE_PREVIEW_BUILD_NOT_READY");
    }

    const buildLocation = normalizeStoragePath(build.build_output_storage_path);
    const { data: bundleSigned, error: bundleError } = await this.supabase.storage
      .from(buildLocation.bucket)
      .createSignedUrl(buildLocation.path, Number(process.env.DESKTOP_WORKER_SIGNED_URL_TTL_SECONDS || 3600));

    if (bundleError || !bundleSigned?.signedUrl) {
      throw new Error(`TEMPLATE_PREVIEW_BUNDLE_SIGNED_URL_FAILED: ${bundleError?.message || "Unknown error"}`);
    }

    const posterStoragePath = `template-previews/${preview.id}/poster.png`;
    const { data: posterSigned, error: posterError } = await this.supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(posterStoragePath, { upsert: true });

    if (posterError || !posterSigned?.signedUrl) {
      throw new Error(`TEMPLATE_PREVIEW_POSTER_UPLOAD_URL_FAILED: ${posterError?.message || "Unknown error"}`);
    }

    return {
      jobType: "template_preview",
      jobId: preview.id,
      previewId: preview.id,
      templateId: preview.template_id,
      templateVersionId: preview.template_version_id,
      buildId: preview.template_build_id,
      compositionId: preview.composition_id,
      resolvedProps: preview.resolved_props || {},
      propsHash: preview.props_hash,
      bundleUrl: bundleSigned.signedUrl,
      bundleHash: build.build_hash || preview.build_hash || build.bundle_hash || preview.bundle_hash || "template-preview",
      bundleType: "zip",
      posterUploadUrl: posterSigned.signedUrl,
      posterStoragePath,
      previewFrame: Math.max(0, Math.round(Number(preview.preview_frame) || 0)),
      timeoutInMilliseconds: Number(process.env.EXTERNAL_TEMPLATE_PREVIEW_TIMEOUT_MS || 300000),
    };
  }

  private async buildClaimedJobPayload(worker: WorkerAuthContext, job: any) {
    const snapshot = job.input_snapshot || {};
    const resolved = resolveWorkerRenderInput(snapshot);
    const bundleUrl = await this.createWorkerBundleSignedUrl(resolved.bundle);
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
      jobType: "render" as const,
      jobId: job.id,
      compositionId: resolved.compositionId,
      resolvedProps: resolved.resolvedProps,
      propsHash: resolved.propsHash,
      bundleUrl,
      bundleHash: resolved.bundle.bundleHash,
      bundleType: resolved.bundle.bundleType,
      outputUploadUrl: signedUpload.signedUrl,
      outputStoragePath,
      timeoutInMilliseconds: Number(process.env.REMOTION_LOCAL_RENDER_TIMEOUT_MS || 900000),
    };
  }

  private async createWorkerBundleSignedUrl(bundle: { signedUrl: string; storagePath: string; bundleType: "serve_url" | "zip" }) {
    if (bundle.bundleType === "serve_url") return bundle.signedUrl;

    const { bucket, path } = normalizeStoragePath(bundle.storagePath);
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, Number(process.env.DESKTOP_WORKER_SIGNED_URL_TTL_SECONDS || 3600));

    if (error || !data?.signedUrl) {
      throw new Error(`BUNDLE_SIGNED_URL_FAILED: ${error?.message || "Unknown error"}`);
    }

    return data.signedUrl;
  }

  async refreshUploadUrl(worker: WorkerAuthContext, jobId: string, input: Record<string, unknown>) {
    const jobType = sanitizeText(input.jobType, "render");
    const outputStoragePath = sanitizeText(input.outputStoragePath, "");
    if (!outputStoragePath) throw new Error("INVALID_OUTPUT_STORAGE_PATH");

    if (jobType === "template_build") {
      const build = await this.getAuthorizedTemplateBuild(worker, jobId);
      if (!build) throw new Error("TEMPLATE_BUILD_NOT_FOUND");
      if (!outputStoragePath.startsWith(`${TEMPLATE_BUNDLE_BUCKET}/template-builds/${jobId}/`)) {
        throw new Error("INVALID_TEMPLATE_BUILD_OUTPUT_STORAGE_PATH");
      }
      const storagePath = outputStoragePath.slice(`${TEMPLATE_BUNDLE_BUCKET}/`.length);
      const { data, error } = await this.supabase.storage
        .from(TEMPLATE_BUNDLE_BUCKET)
        .createSignedUploadUrl(storagePath, { upsert: true });
      if (error || !data?.signedUrl) throw new Error(`TEMPLATE_BUILD_UPLOAD_URL_FAILED: ${error?.message || "Unknown error"}`);
      return { uploadUrl: data.signedUrl, outputStoragePath, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
    }

    if (jobType === "template_preview") {
      const preview = await this.getAuthorizedTemplatePreview(worker, jobId);
      if (!preview) throw new Error("TEMPLATE_PREVIEW_NOT_FOUND");
      if (!outputStoragePath.startsWith("template-previews/")) {
        throw new Error("INVALID_TEMPLATE_PREVIEW_OUTPUT_STORAGE_PATH");
      }
      const { data, error } = await this.supabase.storage
        .from(VIDEO_BUCKET)
        .createSignedUploadUrl(outputStoragePath, { upsert: true });
      if (error || !data?.signedUrl) throw new Error(`TEMPLATE_PREVIEW_UPLOAD_URL_FAILED: ${error?.message || "Unknown error"}`);
      return { uploadUrl: data.signedUrl, outputStoragePath, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
    }

    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    if (job.worker_id && job.worker_id !== worker.id) throw new Error("JOB_CLAIMED_BY_ANOTHER_WORKER");
    if (!outputStoragePath.startsWith("completed/")) {
      throw new Error("INVALID_OUTPUT_STORAGE_PATH");
    }
    const { data, error } = await this.supabase.storage
      .from(VIDEO_BUCKET)
      .createSignedUploadUrl(outputStoragePath, { upsert: true });
    if (error || !data?.signedUrl) throw new Error(`OUTPUT_UPLOAD_URL_FAILED: ${error?.message || "Unknown error"}`);
    return { uploadUrl: data.signedUrl, outputStoragePath, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
  }

  async listRecoverableJobs(worker: WorkerAuthContext) {
    const now = new Date().toISOString();
    const [{ data: renderJobs }, { data: builds }, { data: previews }] = await Promise.all([
      this.supabase
        .from("production_jobs")
        .select("id, status, worker_id, lease_expires_at, output_checksum, output_snapshot, provider_error, updated_at")
        .eq("organization_id", worker.organizationId)
        .eq("worker_id", worker.id)
        .in("status", ["RUNNING", "FAILED", "RETRY_SCHEDULED"])
        .or(`lease_expires_at.is.null,lease_expires_at.lte.${now}`),
      this.supabase
        .from("remotion_template_builds")
        .select("id, status, worker_id, lease_expires_at, output_checksum, build_output_storage_path, provider_status, provider_status_detail, updated_at")
        .eq("organization_id", worker.organizationId)
        .eq("worker_id", worker.id)
        .in("status", ["BUILDING", "BUILD_FAILED"])
        .or(`lease_expires_at.is.null,lease_expires_at.lte.${now}`),
      this.supabase
        .from("remotion_template_previews")
        .select("id, status, worker_id, lease_expires_at, output_checksum, preview_poster_storage_path, provider_status, provider_status_detail, updated_at")
        .eq("organization_id", worker.organizationId)
        .eq("worker_id", worker.id)
        .in("status", ["RUNNING", "FAILED"])
        .or(`lease_expires_at.is.null,lease_expires_at.lte.${now}`),
    ]);

    return {
      jobs: [
        ...(renderJobs || []).map((job: any) => ({
          jobType: "render",
          jobId: job.id,
          status: job.status,
          outputStoragePath: job.output_snapshot?.outputStoragePath || null,
          outputChecksum: job.output_checksum || null,
          updatedAt: job.updated_at,
        })),
        ...(builds || []).map((build: any) => ({
          jobType: "template_build",
          jobId: build.id,
          status: build.status,
          outputStoragePath: build.build_output_storage_path || null,
          outputChecksum: build.output_checksum || null,
          updatedAt: build.updated_at,
        })),
        ...(previews || []).map((preview: any) => ({
          jobType: "template_preview",
          jobId: preview.id,
          status: preview.status,
          outputStoragePath: preview.preview_poster_storage_path || null,
          outputChecksum: preview.output_checksum || null,
          updatedAt: preview.updated_at,
        })),
      ],
    };
  }

  async reportProgress(worker: WorkerAuthContext, jobId: string, input: Record<string, unknown>) {
    const templateBuild = await this.getAuthorizedTemplateBuild(worker, jobId);
    if (templateBuild) {
      const message = sanitizeText(input.message, "Compilando plantilla en worker local");
      const stage = sanitizeText(input.stage, "template_build_progress");
      await this.supabase
        .from("remotion_template_builds")
        .update({
          worker_heartbeat_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
          provider_status: stage,
          provider_status_detail: message,
          build_log: [
            sanitizeText(templateBuild.build_log, ""),
            `${new Date().toISOString()} ${stage}: ${message}`,
          ].filter(Boolean).join("\n").slice(-8000),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId);
      await this.heartbeat(worker, { status: "BUSY" });
      return { ok: true };
    }

    const templatePreview = await this.getAuthorizedTemplatePreview(worker, jobId);
    if (templatePreview) {
      const currentProgress = Array.isArray(templatePreview.progress) ? templatePreview.progress : [];
      const progress = [
        ...currentProgress.slice(-19),
        safeJobProgressEntry({
          percent: Number(input.percent),
          message: sanitizeText(input.message, "Generando preview externo en worker local"),
          stage: sanitizeText(input.stage, "template_preview_progress"),
          workerId: worker.id,
        }),
      ];
      const { error } = await this.supabase
        .from("remotion_template_previews")
        .update({
          progress,
          worker_heartbeat_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + WORKER_JOB_LEASE_SECONDS * 1000).toISOString(),
          provider_status: sanitizeText(input.stage, "template_preview_progress"),
          provider_status_detail: sanitizeText(input.message, "Generando preview externo en worker local"),
          updated_at: new Date().toISOString(),
        })
        .eq("id", jobId)
        .eq("worker_id", worker.id);

      if (error) throw new Error(`TEMPLATE_PREVIEW_PROGRESS_FAILED: ${error.message}`);
      await this.heartbeat(worker, { status: "BUSY" });
      return { ok: true };
    }

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
    const templateBuild = await this.getAuthorizedTemplateBuild(worker, jobId);
    if (templateBuild) {
      return this.completeTemplateBuild(worker, templateBuild, input);
    }

    const templatePreview = await this.getAuthorizedTemplatePreview(worker, jobId);
    if (templatePreview) {
      return this.completeTemplatePreview(worker, templatePreview, input);
    }

    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    if (!input.outputStoragePath || !input.outputStoragePath.startsWith("completed/")) {
      throw new Error("INVALID_OUTPUT_STORAGE_PATH");
    }

    if (job.status === "SUCCEEDED") {
      const existingPath = job.output_snapshot?.outputStoragePath;
      const existingChecksum = job.output_checksum || job.output_snapshot?.outputChecksum || "";
      if (existingPath === input.outputStoragePath && (!input.checksum || !existingChecksum || existingChecksum === input.checksum)) {
        return {
          finalVideoUrl: job.output_snapshot?.final_video_url || null,
          durationSeconds: job.duration_seconds || deriveDurationFromJob(job),
          alreadyCompleted: true,
        };
      }
      throw new Error("JOB_ALREADY_COMPLETED_WITH_DIFFERENT_OUTPUT");
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
          final_video_layout_stale: false,
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
    const templateBuild = await this.getAuthorizedTemplateBuild(worker, jobId);
    if (templateBuild) {
      return this.failTemplateBuild(worker, templateBuild, input);
    }

    const templatePreview = await this.getAuthorizedTemplatePreview(worker, jobId);
    if (templatePreview) {
      return this.failTemplatePreview(worker, templatePreview, input);
    }

    const job = await this.getAuthorizedWorkerJob(worker, jobId);
    if (job.status === "SUCCEEDED") return { ok: true, alreadyCompleted: true };
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

  private async completeTemplateBuild(
    worker: WorkerAuthContext,
    build: any,
    input: WorkerJobCompleteInput,
  ) {
    if (!input.outputStoragePath || !input.outputStoragePath.startsWith(`${TEMPLATE_BUNDLE_BUCKET}/template-builds/`)) {
      throw new Error("INVALID_TEMPLATE_BUILD_OUTPUT_STORAGE_PATH");
    }

    const buildHash = sanitizeText(input.buildHash || input.checksum, "");
    if (!/^[a-f0-9]{64}$/i.test(buildHash)) {
      throw new Error("INVALID_TEMPLATE_BUILD_HASH");
    }

    if (build.status === "BUILT") {
      if (
        build.build_output_storage_path === input.outputStoragePath &&
        (!build.output_checksum || build.output_checksum === buildHash)
      ) {
        return { buildId: build.id, buildHash, buildOutputStoragePath: input.outputStoragePath, alreadyCompleted: true };
      }
      throw new Error("TEMPLATE_BUILD_ALREADY_COMPLETED_WITH_DIFFERENT_OUTPUT");
    }

    const builtAt = new Date().toISOString();
    const buildLog = sanitizeText(input.buildLog || input.logsRef, "Template build completed by desktop worker.");
    const { error } = await this.supabase
      .from("remotion_template_builds")
      .update({
        status: "BUILT",
        build_hash: buildHash,
        build_output_storage_path: input.outputStoragePath,
        provider_status: "SUCCEEDED",
        provider_status_detail: null,
        build_log: buildLog,
        built_at: builtAt,
        worker_heartbeat_at: builtAt,
        lease_expires_at: null,
        output_checksum: buildHash,
        updated_at: builtAt,
      })
      .eq("id", build.id)
      .eq("worker_id", build.worker_id);

    if (error) throw new Error(`TEMPLATE_BUILD_COMPLETE_FAILED: ${error.message}`);

    await this.supabase
      .from("remotion_template_versions")
      .update({
        build_status: "BUILT",
        build_hash: buildHash,
        build_output_path: input.outputStoragePath,
        built_at: builtAt,
      })
      .eq("id", build.template_version_id);

    await this.heartbeat(worker, { status: "ONLINE" });
    return { buildId: build.id, buildHash, buildOutputStoragePath: input.outputStoragePath };
  }

  private async failTemplateBuild(worker: WorkerAuthContext, build: any, input: Record<string, unknown>) {
    let message = sanitizeText(input.message, "El worker local no pudo compilar la plantilla");
    const code = sanitizeText(input.errorCode, "") || "DESKTOP_WORKER_TEMPLATE_BUILD_FAILED";
    const failedAt = new Date().toISOString();

    if (build.status === "BUILT") return { ok: true, alreadyCompleted: true };

    if (shouldUseTemplateServerBundler() && isEsbuildSpawnPermissionFailure(`${code}\n${message}`)) {
      const { data: version } = await this.supabase
        .from("remotion_template_versions")
        .select("*")
        .eq("id", build.template_version_id)
        .maybeSingle();

      if (version) {
        try {
          const recovered = await this.buildTemplateWithServerBundler(version, {
            ...build,
            provider_status: "SERVER_BUNDLER_RECOVERY",
            provider_status_detail: "Worker no pudo ejecutar esbuild; recuperando build en servidor local.",
          });
          await this.heartbeat(worker, { status: "ONLINE" });
          return { ok: true, recoveredWithServerBundler: true, ...recovered };
        } catch (recoveryError) {
          message = sanitizeText(
            `${message}\nServer bundler recovery failed: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
            message,
          );
        }
      }
    }

    await this.supabase
      .from("remotion_template_builds")
      .update({
        status: "BUILD_FAILED",
        provider_status: code,
        provider_status_detail: message,
        build_error: message,
        build_failed_at: failedAt,
        worker_heartbeat_at: failedAt,
        lease_expires_at: null,
        updated_at: failedAt,
      })
      .eq("id", build.id)
      .eq("worker_id", worker.id);

    await this.supabase
      .from("remotion_template_versions")
      .update({ build_status: "BUILD_FAILED" })
      .eq("id", build.template_version_id);

    await this.heartbeat(worker, { status: "ONLINE" });
    return { ok: true };
  }

  private async completeTemplatePreview(
    worker: WorkerAuthContext,
    preview: any,
    input: WorkerJobCompleteInput,
  ) {
    if (!input.outputStoragePath || !input.outputStoragePath.startsWith("template-previews/")) {
      throw new Error("INVALID_TEMPLATE_PREVIEW_OUTPUT_STORAGE_PATH");
    }

    const checksum = sanitizeText(input.checksum, "");
    const completedAt = new Date().toISOString();
    if (preview.status === "SUCCEEDED") {
      if (
        preview.preview_poster_storage_path === input.outputStoragePath &&
        (!preview.output_checksum || !checksum || preview.output_checksum === checksum)
      ) {
        const {
          data: { publicUrl },
        } = this.supabase.storage.from(VIDEO_BUCKET).getPublicUrl(input.outputStoragePath);
        return { previewId: preview.id, previewPosterUrl: publicUrl, alreadyCompleted: true };
      }
      throw new Error("TEMPLATE_PREVIEW_ALREADY_COMPLETED_WITH_DIFFERENT_OUTPUT");
    }
    const { error } = await this.supabase
      .from("remotion_template_previews")
      .update({
        status: "SUCCEEDED",
        preview_poster_storage_path: input.outputStoragePath,
        preview_frames: null,
        output_checksum: checksum || null,
        provider_status: "SUCCEEDED",
        provider_status_detail: null,
        progress: [
          safeJobProgressEntry({
            percent: 100,
            message: "Preview externo generado correctamente",
            stage: "template_preview_completed",
            workerId: worker.id,
          }),
        ],
        completed_at: completedAt,
        worker_heartbeat_at: completedAt,
        lease_expires_at: null,
        updated_at: completedAt,
      })
      .eq("id", preview.id)
      .eq("worker_id", worker.id);

    if (error) throw new Error(`TEMPLATE_PREVIEW_COMPLETE_FAILED: ${error.message}`);

    const {
      data: { publicUrl },
    } = this.supabase.storage.from(VIDEO_BUCKET).getPublicUrl(input.outputStoragePath);

    await this.heartbeat(worker, { status: "ONLINE" });
    return { previewId: preview.id, previewPosterUrl: publicUrl };
  }

  private async failTemplatePreview(worker: WorkerAuthContext, preview: any, input: Record<string, unknown>) {
    const message = sanitizeText(input.message, "El worker local no pudo generar el preview externo");
    const code = sanitizeText(input.errorCode, "") || "DESKTOP_WORKER_TEMPLATE_PREVIEW_FAILED";
    const failedAt = new Date().toISOString();

    if (preview.status === "SUCCEEDED") return { ok: true, alreadyCompleted: true };

    await this.supabase
      .from("remotion_template_previews")
      .update({
        status: "FAILED",
        provider_status: code,
        provider_status_detail: message,
        error_code: code,
        error_message: message,
        failed_at: failedAt,
        worker_heartbeat_at: failedAt,
        lease_expires_at: null,
        updated_at: failedAt,
      })
      .eq("id", preview.id)
      .eq("worker_id", worker.id);

    await this.heartbeat(worker, { status: "ONLINE" });
    return { ok: true };
  }

  private async getAuthorizedTemplateBuild(worker: WorkerAuthContext, buildId: string) {
    const { data: build, error } = await this.supabase
      .from("remotion_template_builds")
      .select("*")
      .eq("id", buildId)
      .maybeSingle();

    if (error || !build) return null;
    if (build.organization_id !== worker.organizationId) {
      throw new Error("TEMPLATE_BUILD_FORBIDDEN_FOR_WORKER");
    }
    if (build.cloud_provider !== "desktop_worker") {
      throw new Error("TEMPLATE_BUILD_PROVIDER_NOT_DESKTOP_WORKER");
    }
    if (!["BUILDING", "BUILD_FAILED", "BUILT"].includes(build.status)) {
      throw new Error("TEMPLATE_BUILD_NOT_CLAIMABLE");
    }
    if (build.worker_id && build.worker_id !== worker.id) {
      throw new Error("TEMPLATE_BUILD_CLAIMED_BY_ANOTHER_WORKER");
    }
    return build;
  }

  private async getAuthorizedTemplatePreview(worker: WorkerAuthContext, previewId: string) {
    const { data: preview, error } = await this.supabase
      .from("remotion_template_previews")
      .select("*")
      .eq("id", previewId)
      .maybeSingle();

    if (error || !preview) return null;
    if (preview.organization_id !== worker.organizationId) {
      throw new Error("TEMPLATE_PREVIEW_FORBIDDEN_FOR_WORKER");
    }
    if (!["QUEUED", "RUNNING", "FAILED", "SUCCEEDED"].includes(preview.status)) {
      throw new Error("TEMPLATE_PREVIEW_NOT_CLAIMABLE");
    }
    if (preview.worker_id && preview.worker_id !== worker.id) {
      throw new Error("TEMPLATE_PREVIEW_CLAIMED_BY_ANOTHER_WORKER");
    }
    return preview;
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
