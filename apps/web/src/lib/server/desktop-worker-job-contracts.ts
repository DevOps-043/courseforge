import crypto from "node:crypto";

const DEFAULT_WORKER_JOB_STALE_MS = 2 * 60 * 1000;
const DEFAULT_RENDER_TIMEOUT_MS = 900_000;
const CLAIMABLE_JOB_STATUSES = new Set([
  "PENDING",
  "QUEUED",
  "WAITING_PROVIDER",
  "RUNNING",
  "SUCCEEDED",
]);

export interface DesktopWorkerIdentity {
  id: string;
  organizationId: string;
}

export interface ResolvedDesktopWorkerRenderInput {
  bundle: {
    bundleHash: string;
    bundleType: "serve_url" | "zip";
    signedUrl: string;
    storagePath: string;
  };
  compositionId: string;
  propsHash: string;
  renderDiagnostics: Record<string, unknown>;
  renderMode: "INTERNAL_COMPOSITION" | "EXTERNAL_DESKTOP_SITE_READY";
  resolvedProps: Record<string, unknown>;
}

export function buildStableJsonHash(value: unknown): string {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}

export function isStaleDesktopJobAssignment(
  jobValue: unknown,
  workerValue: unknown,
  options: { now?: number; staleAfterMilliseconds?: number } = {},
) {
  const job = readRecord(jobValue);
  if (job.worker_id === null || job.worker_id === undefined || job.worker_id === "") return false;
  if (!readNonEmptyString(job.worker_id)) return true;

  const worker = readRecord(workerValue);
  if (Object.keys(worker).length === 0 || worker.status === "REVOKED") return true;

  const heartbeatAt = [
    job.worker_heartbeat_at,
    worker.last_heartbeat_at,
    job.claimed_at,
  ].map(readNonEmptyString).find(Boolean);
  if (!heartbeatAt) return true;

  const heartbeatTimestamp = Date.parse(heartbeatAt);
  if (!Number.isFinite(heartbeatTimestamp)) return true;

  const now = options.now ?? Date.now();
  const staleAfterMilliseconds = options.staleAfterMilliseconds ?? DEFAULT_WORKER_JOB_STALE_MS;
  return now - heartbeatTimestamp > staleAfterMilliseconds;
}

export function deriveDesktopJobDurationContract(jobValue: unknown) {
  const job = readRecord(jobValue);
  const snapshot = readRecord(job.input_snapshot);
  const props = readRecord(snapshot.resolvedProps);
  const frames = Number(props.totalDurationFrames ?? props.totalDurationInFrames);
  const fps = Number(props.fps);
  if (!Number.isFinite(frames) || !Number.isFinite(fps) || frames <= 0 || fps <= 0) {
    return null;
  }

  return {
    durationSeconds: frames / fps,
    fps,
    frames: Math.round(frames),
  };
}

export function assertDesktopWorkerCanAccessJob(
  worker: DesktopWorkerIdentity,
  jobValue: unknown,
  options: { allowCancelled?: boolean } = {},
) {
  const job = readRecord(jobValue);
  const snapshot = readRecord(job.input_snapshot);
  if (job.organization_id !== worker.organizationId) {
    throw new Error("JOB_FORBIDDEN_FOR_WORKER");
  }
  if (job.job_type !== "REMOTION_RENDER") {
    throw new Error("JOB_TYPE_NOT_SUPPORTED");
  }
  if (snapshot.renderProvider !== "desktop_worker") {
    throw new Error("JOB_PROVIDER_NOT_DESKTOP_WORKER");
  }

  const allowedStatuses = options.allowCancelled
    ? new Set([...CLAIMABLE_JOB_STATUSES, "CANCELLED"])
    : CLAIMABLE_JOB_STATUSES;
  if (typeof job.status !== "string" || !allowedStatuses.has(job.status)) {
    throw new Error("JOB_NOT_CLAIMABLE");
  }

  const assignedWorkerId = readNonEmptyString(job.worker_id);
  if (assignedWorkerId && assignedWorkerId !== worker.id) {
    throw new Error("JOB_ALREADY_CLAIMED_BY_ANOTHER_WORKER");
  }
  const preferredWorkerId = readNonEmptyString(job.preferred_worker_id);
  if (preferredWorkerId && preferredWorkerId !== worker.id) {
    throw new Error("JOB_RESERVED_FOR_ANOTHER_WORKER");
  }
}

export function resolveDesktopWorkerRenderInput(
  snapshotValue: unknown,
  renderTimeoutMilliseconds = DEFAULT_RENDER_TIMEOUT_MS,
): ResolvedDesktopWorkerRenderInput {
  const snapshot = readRecord(snapshotValue);
  const externalServeUrl = readNonEmptyString(snapshot.externalServeUrl) || "";
  const externalBuildStoragePath = readNonEmptyString(snapshot.externalBuildStoragePath) || "";
  const isInternalDesktopRender = snapshot.renderMode === "INTERNAL_COMPOSITION";
  const isDesktopRender =
    isInternalDesktopRender ||
    snapshot.renderMode === "EXTERNAL_DESKTOP_SITE_READY" ||
    /^https:\/\//i.test(externalServeUrl) ||
    Boolean(externalBuildStoragePath);

  if (!isDesktopRender) throw new Error("DESKTOP_WORKER_REQUIRES_TEMPLATE_BUILD");
  if (!/^https:\/\//i.test(externalServeUrl) && !externalBuildStoragePath) {
    throw new Error("DESKTOP_WORKER_BUNDLE_TARGET_INVALID");
  }

  const compositionId = readNonEmptyString(snapshot.compositionId);
  if (!compositionId) throw new Error("EXTERNAL_DESKTOP_COMPOSITION_ID_MISSING");
  if (!isValidDesktopCompositionId(compositionId)) {
    throw new Error("EXTERNAL_DESKTOP_COMPOSITION_ID_INVALID");
  }

  if (!isRecord(snapshot.resolvedProps)) {
    throw new Error("EXTERNAL_DESKTOP_PROPS_MISSING");
  }
  const resolvedProps = snapshot.resolvedProps;

  const propsHash = readNonEmptyString(snapshot.propsHash) || buildStableJsonHash(resolvedProps);
  const bundleHash = [snapshot.bundleHash, snapshot.buildHash, snapshot.buildId]
    .map(readNonEmptyString)
    .find(Boolean) || "external-desktop-site";
  const suppliedDiagnostics = isRecord(snapshot.renderDiagnostics)
    ? snapshot.renderDiagnostics
    : null;

  return {
    renderMode: isInternalDesktopRender
      ? "INTERNAL_COMPOSITION"
      : "EXTERNAL_DESKTOP_SITE_READY",
    compositionId,
    resolvedProps,
    propsHash,
    bundle: {
      signedUrl: externalServeUrl || externalBuildStoragePath,
      bundleHash,
      storagePath: externalBuildStoragePath || externalServeUrl,
      bundleType: externalBuildStoragePath ? "zip" : "serve_url",
    },
    renderDiagnostics: suppliedDiagnostics
      ? suppliedDiagnostics
      : {
          compositionId,
          propsHash,
          renderMode: "EXTERNAL_DESKTOP_SITE_READY",
          renderProvider: "desktop_worker",
          timeoutInMilliseconds: renderTimeoutMilliseconds,
        },
  };
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

export function isValidDesktopCompositionId(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.trim();
  if (!normalized || /^https?:\/\//i.test(normalized)) return false;
  if (normalized.includes("/") || normalized.includes("\\")) return false;
  if (/\.html?$/i.test(normalized)) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(normalized);
}

function readNonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
