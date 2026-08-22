import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HyperframesRenderRecoveryService } from "../hyperframes-render-recovery.service";

function createSupabaseStub(rows: Record<string, unknown>) {
  const filters: Array<{ column: string; table: string; value: unknown }> = [];

  return {
    client: {
      from(table: string) {
        const query = {
          eq(column: string, value: unknown) {
            filters.push({ column, table, value });
            return query;
          },
          in(column: string, value: unknown) {
            filters.push({ column, table, value });
            return query;
          },
          limit() {
            return query;
          },
          maybeSingle() {
            const value = rows[table];
            return Promise.resolve({
              data: Array.isArray(value) ? value[0] || null : value || null,
              error: null,
            });
          },
          not(column: string, operator: string, value: unknown) {
            filters.push({ column: `${column}:${operator}`, table, value });
            return query;
          },
          order() {
            return query;
          },
          select() {
            return query;
          },
          then(resolve: (value: unknown) => void) {
            const value = rows[table];
            return Promise.resolve({
              data: Array.isArray(value) ? value : value ? [value] : [],
              error: null,
            }).then(resolve);
          },
        };
        return query;
      },
    },
    filters,
  };
}

const runningRequest = {
  composition_revision_id: "revision-1",
  id: "request-1",
  import_status: "NONE",
  provider_render_id: "provider-1",
  provider_status: "RUNNING",
};

describe("HyperFrames render recovery", () => {
  it("returns one request only when both id and organization match", async () => {
    const stub = createSupabaseStub({
      hyperframes_render_requests: runningRequest,
    });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findById({
      organizationId: "organization-1",
      requestId: "request-1",
    });

    assert.deepEqual(result, {
      compositionRevisionId: "revision-1",
      id: "request-1",
      importStatus: "NONE",
      providerRenderId: "provider-1",
      providerStatus: "RUNNING",
    });
    assert.ok(stub.filters.some(
      (filter) => filter.column === "id" && filter.value === "request-1",
    ));
    assert.ok(stub.filters.some(
      (filter) => filter.column === "organization_id" && filter.value === "organization-1",
    ));
  });

  it("returns the active request and scopes every ledger lookup to the organization", async () => {
    const stub = createSupabaseStub({
      hyperframes_render_requests: runningRequest,
      production_assets: [],
      production_jobs: { id: "job-1", status: "WAITING_PROVIDER" },
      video_compositions: { material_component_id: "component-1" },
    });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findLatestForComposition({
      compositionId: "composition-1",
      organizationId: "organization-1",
    });

    assert.deepEqual(result, {
      activeRender: {
        compositionRevisionId: "revision-1",
        id: "request-1",
        importStatus: "NONE",
        providerRenderId: "provider-1",
        providerStatus: "RUNNING",
      },
      completedVideo: null,
      latestRender: {
        compositionRevisionId: "revision-1",
        id: "request-1",
        importStatus: "NONE",
        providerRenderId: "provider-1",
        providerStatus: "RUNNING",
      },
    });
    assert.ok(stub.filters.every(
      (filter) => filter.column !== "organization_id" || filter.value === "organization-1",
    ));
  });

  it("keeps a completed asset available when the latest revision failed", async () => {
    const stub = createSupabaseStub({
      hyperframes_render_requests: [
        {
          composition_revision_id: "revision-current",
          id: "request-failed",
          import_status: "FAILED",
          production_job_id: "job-failed",
          provider_render_id: "provider-failed",
          provider_status: "FAILED",
        },
        {
          composition_revision_id: "revision-completed",
          id: "request-completed",
          import_status: "COMPLETED",
          production_job_id: "job-completed",
          provider_render_id: "provider-completed",
          provider_status: "COMPLETED",
        },
      ],
      production_assets: [{
        created_at: "2026-08-21T18:00:00Z",
        duration_seconds: 243,
        id: "asset-1",
        material_component_id: "component-1",
        production_job_id: "job-completed",
        public_url: "https://cdn.example.test/final.mp4",
        storage_path: "production-videos/final.mp4",
      }],
      production_jobs: { id: "job-failed", status: "FAILED" },
      video_compositions: { material_component_id: "component-1" },
    });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findLatestForComposition({
      compositionId: "composition-1",
      organizationId: "organization-1",
    });

    assert.equal(result?.activeRender, null);
    assert.equal(result?.latestRender?.id, "request-failed");
    assert.equal(result?.completedVideo?.assetId, "asset-1");
    assert.equal(
      result?.completedVideo?.compositionRevisionId,
      "revision-completed",
    );
  });

  it("does not expose data when the composition has no scoped component", async () => {
    const stub = createSupabaseStub({ video_compositions: null });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findLatestForComposition({
      compositionId: "composition-1",
      organizationId: "organization-1",
    });

    assert.equal(result, null);
  });
});
