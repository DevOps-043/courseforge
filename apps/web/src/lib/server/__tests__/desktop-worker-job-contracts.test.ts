import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDesktopWorkerCanAccessJob,
  buildStableJsonHash,
  deriveDesktopJobDurationContract,
  isStaleDesktopJobAssignment,
  resolveDesktopWorkerRenderInput,
} from "../desktop-worker-job-contracts";
import {
  readDatabaseRow,
  readDatabaseRows,
  type RenderWorkerRow,
} from "../desktop-worker-db.types";
import { parseDesktopWorkerMaterialAssets } from "../desktop-worker-assets";

const worker = { id: "worker-1", organizationId: "org-1" };
const claimableJob = {
  input_snapshot: { renderProvider: "desktop_worker" },
  job_type: "REMOTION_RENDER",
  organization_id: "org-1",
  status: "QUEUED",
  worker_id: null,
};

test("worker assignment staleness handles fresh, missing and malformed heartbeats", () => {
  const now = Date.parse("2026-09-09T12:00:00.000Z");
  assert.equal(isStaleDesktopJobAssignment({ worker_id: null }, null, { now }), false);
  assert.equal(
    isStaleDesktopJobAssignment(
      { worker_id: "worker-1", worker_heartbeat_at: "2026-09-09T11:59:30.000Z" },
      { status: "ONLINE" },
      { now, staleAfterMilliseconds: 60_000 },
    ),
    false,
  );
  assert.equal(
    isStaleDesktopJobAssignment(
      { worker_id: "worker-1", worker_heartbeat_at: "invalid" },
      { status: "ONLINE" },
      { now },
    ),
    true,
  );
  assert.equal(
    isStaleDesktopJobAssignment(
      { worker_id: "worker-1", worker_heartbeat_at: "2026-09-09T11:59:59.000Z" },
      { status: "REVOKED" },
      { now },
    ),
    true,
  );
});

test("duration contracts accept only positive finite frames and fps", () => {
  assert.deepEqual(
    deriveDesktopJobDurationContract({
      input_snapshot: { resolvedProps: { fps: 30, totalDurationInFrames: 300 } },
    }),
    { durationSeconds: 10, fps: 30, frames: 300 },
  );
  assert.equal(
    deriveDesktopJobDurationContract({
      input_snapshot: { resolvedProps: { fps: 0, totalDurationFrames: 300 } },
    }),
    null,
  );
  assert.equal(deriveDesktopJobDurationContract({ input_snapshot: [] }), null);
});

test("worker authorization enforces tenant, provider, status and assignment", () => {
  assert.doesNotThrow(() => assertDesktopWorkerCanAccessJob(worker, claimableJob));
  assert.throws(
    () => assertDesktopWorkerCanAccessJob(worker, { ...claimableJob, organization_id: "org-2" }),
    /JOB_FORBIDDEN_FOR_WORKER/,
  );
  assert.throws(
    () => assertDesktopWorkerCanAccessJob(worker, { ...claimableJob, status: "CANCELLED" }),
    /JOB_NOT_CLAIMABLE/,
  );
  assert.doesNotThrow(() =>
    assertDesktopWorkerCanAccessJob(
      worker,
      { ...claimableJob, status: "CANCELLED" },
      { allowCancelled: true },
    ),
  );
  assert.throws(
    () => assertDesktopWorkerCanAccessJob(worker, { ...claimableJob, worker_id: "worker-2" }),
    /JOB_ALREADY_CLAIMED_BY_ANOTHER_WORKER/,
  );
});

test("render input resolution validates the snapshot and builds a stable hash", () => {
  const first = resolveDesktopWorkerRenderInput({
    compositionId: "course-video",
    externalBuildStoragePath: "template-bundles/build.zip",
    renderMode: "EXTERNAL_DESKTOP_SITE_READY",
    resolvedProps: { title: "Course", duration: 10 },
  });
  const second = resolveDesktopWorkerRenderInput({
    compositionId: "course-video",
    externalBuildStoragePath: "template-bundles/build.zip",
    renderMode: "EXTERNAL_DESKTOP_SITE_READY",
    resolvedProps: { duration: 10, title: "Course" },
  });

  assert.equal(first.bundle.bundleType, "zip");
  assert.equal(first.propsHash, second.propsHash);
  assert.equal(first.propsHash, buildStableJsonHash({ duration: 10, title: "Course" }));
  assert.equal(first.renderDiagnostics.renderMode, "EXTERNAL_DESKTOP_SITE_READY");
  assert.throws(
    () => resolveDesktopWorkerRenderInput({
      compositionId: "https://invalid.example.com",
      externalServeUrl: "https://bundle.example.com",
      resolvedProps: {},
    }),
    /EXTERNAL_DESKTOP_COMPOSITION_ID_INVALID/,
  );
  assert.throws(
    () => resolveDesktopWorkerRenderInput({
      compositionId: "course-video",
      externalServeUrl: "http://insecure.example.com",
      resolvedProps: {},
    }),
    /DESKTOP_WORKER_REQUIRES_TEMPLATE_BUILD/,
  );
  assert.throws(
    () => resolveDesktopWorkerRenderInput({
      compositionId: "course-video",
      externalServeUrl: "https://bundle.example.com",
      resolvedProps: [],
    }),
    /EXTERNAL_DESKTOP_PROPS_MISSING/,
  );
});

test("database boundary readers reject non-row values before control-plane mapping", () => {
  const workerRow = {
    id: "worker-1",
    organization_id: "org-1",
    status: "ONLINE",
  };

  assert.deepEqual(
    readDatabaseRows<RenderWorkerRow>([workerRow, null, "invalid", ["nested"]]),
    [workerRow],
  );
  assert.equal(readDatabaseRows<RenderWorkerRow>({ id: "not-an-array" }).length, 0);
  assert.equal(readDatabaseRow<RenderWorkerRow>(null), null);
  assert.equal(readDatabaseRow<RenderWorkerRow>(workerRow)?.id, "worker-1");
});

test("desktop render assets are validated before reaching the assembly normalizer", () => {
  assert.deepEqual(
    parseDesktopWorkerMaterialAssets({
      assembly_target_duration_seconds: 12,
      timeline_overrides: [],
    }),
    {
      assembly_target_duration_seconds: 12,
      timeline_overrides: [],
    },
  );
  assert.throws(
    () => parseDesktopWorkerMaterialAssets({ production_status: "READY" }),
    /MATERIAL_ASSETS_INVALID_FOR_DESKTOP_RENDER/,
  );
  assert.throws(
    () => parseDesktopWorkerMaterialAssets([]),
    /MATERIAL_ASSETS_INVALID_FOR_DESKTOP_RENDER/,
  );
});
