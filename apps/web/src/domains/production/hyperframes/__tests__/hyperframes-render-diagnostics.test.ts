import assert from "node:assert/strict";
import { test } from "node:test";
import { formatRenderElapsed, isRenderTerminal, renderElapsedSeconds, renderStageLabel, sanitizeRenderDiagnostic } from "../hyperframes-render-diagnostics";
import { HyperframesRenderPollingService } from "../hyperframes-render-polling.service";
import { HyperframesRenderDiagnosticsService } from "../hyperframes-render-diagnostics.service";

test("elapsed time survives reloads and stops at the persisted completion time", () => {
  const created = "2026-09-02T18:02:53Z";
  const finished = "2026-09-02T19:32:27Z";
  assert.equal(formatRenderElapsed(renderElapsedSeconds(created, null, Date.parse(finished))), "01:29:34");
  assert.equal(formatRenderElapsed(renderElapsedSeconds(created, finished, Date.parse(finished) + 999_000)), "01:29:34");
  assert.equal(renderElapsedSeconds("invalid", null), 0);
  assert.equal(renderElapsedSeconds(finished, created), 0);
});

test("provider and import queues/uploads are distinguished, and provider completion is not final delivery", () => {
  assert.equal(renderStageLabel("QUEUED", "NONE"), "En cola de HeyGen");
  assert.equal(renderStageLabel("UPLOADING", "NONE"), "Subiendo ZIP a HeyGen");
  assert.equal(renderStageLabel("COMPLETED", "UPLOADING"), "Guardando video final");
  assert.equal(renderStageLabel("COMPLETED", "RETRY_SCHEDULED"), "Importación pendiente de reintento");
  assert.equal(isRenderTerminal({ jobStatus: "RETRY_SCHEDULED", importStatus: "RETRY_SCHEDULED", cancelledAt: null }), false);
  assert.equal(isRenderTerminal({ jobStatus: "CANCELLED", importStatus: "FAILED", cancelledAt: "2026-09-02" }), true);
});

test("diagnostics remove signed URLs and credentials from provider messages", () => {
  const message = sanitizeRenderDiagnostic("HTTP 401 https://host/path?token=secret Bearer abc.def api_key=private-value");
  assert.ok(message.includes("HTTP 401"));
  assert.ok(!message.includes("secret") && !message.includes("abc.def") && !message.includes("private-value"));
});

test("polling terminal and importing requests never calls HeyGen or resets import backoff", async () => {
  for (const [row, action] of [
    [{ cancelled_at: "2026-09-02", import_status: "FAILED", provider_status: "COMPLETED" }, "CANCELLED"],
    [{ import_status: "FAILED", provider_status: "COMPLETED" }, "FAIL"],
    [{ import_status: "COMPLETED", provider_status: "COMPLETED" }, "COMPLETED"],
    [{ import_status: "RETRY_SCHEDULED", provider_status: "COMPLETED" }, "IMPORT_QUEUED"],
  ] as const) {
    const filters: unknown[] = [];
    const query = { select() { return query; }, eq(...args: unknown[]) { filters.push(args); return query; },
      async maybeSingle() { return { data: { id: "request", ...row }, error: null }; } };
    const db = { from(table: string) { assert.equal(table, "hyperframes_render_requests"); return query; } };
    const client = { getRender() { throw new Error("Must not contact provider"); } };
    const result = await new HyperframesRenderPollingService(db as never, client as never).poll({ requestId: "request", organizationId: "tenant" });
    assert.equal(result.action, action);
    assert.deepEqual(filters, [["id", "request"], ["organization_id", "tenant"]]);
  }
});

test("cancellation passes tenant and request to the atomic RPC and fails closed", async () => {
  const db = { async rpc(name: string, params: unknown) {
    assert.equal(name, "cancel_hyperframes_render");
    assert.deepEqual(params, { p_organization_id: "tenant", p_request_id: "request" });
    return { data: null, error: new Error("database unavailable") };
  } };
  await assert.rejects(new HyperframesRenderDiagnosticsService(db as never).cancel("tenant", "request"), /database unavailable/);
});
