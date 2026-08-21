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
            return Promise.resolve({ data: rows[table] || null, error: null });
          },
          order() {
            return query;
          },
          select() {
            return query;
          },
        };
        return query;
      },
    },
    filters,
  };
}

describe("HyperFrames render recovery", () => {
  it("returns the latest durable request and scopes every lookup to the organization", async () => {
    const stub = createSupabaseStub({
      hyperframes_render_requests: {
        id: "request-1",
        provider_render_id: "provider-1",
        provider_status: "RUNNING",
      },
      production_jobs: { id: "job-1" },
      video_compositions: { material_component_id: "component-1" },
    });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findLatestForComposition({
      compositionId: "composition-1",
      organizationId: "organization-1",
    });

    assert.deepEqual(result, {
      id: "request-1",
      providerRenderId: "provider-1",
      providerStatus: "RUNNING",
    });
    assert.equal(
      stub.filters.filter(
        (filter) => filter.column === "organization_id" && filter.value === "organization-1",
      ).length,
      3,
    );
  });

  it("recovers an upload before HeyGen has returned a render id", async () => {
    const stub = createSupabaseStub({
      hyperframes_render_requests: {
        id: "request-uploading",
        provider_render_id: null,
        provider_status: "UPLOADING",
      },
      production_jobs: { id: "job-uploading" },
      video_compositions: { material_component_id: "component-1" },
    });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findLatestForComposition({
      compositionId: "composition-1",
      organizationId: "organization-1",
    });

    assert.deepEqual(result, {
      id: "request-uploading",
      providerRenderId: null,
      providerStatus: "UPLOADING",
    });
  });

  it("does not expose a request when the composition has no scoped component", async () => {
    const stub = createSupabaseStub({ video_compositions: null });
    const service = new HyperframesRenderRecoveryService(stub.client as never);

    const result = await service.findLatestForComposition({
      compositionId: "composition-1",
      organizationId: "organization-1",
    });

    assert.equal(result, null);
  });
});
