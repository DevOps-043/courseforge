import assert from "node:assert/strict";
import { test } from "node:test";
import { load } from "../../../app/login/__tests__/source-test-loader";
import { documentFixture } from "./delivery-documents.fixture";

test("la lectura devuelve la versión confirmada si el worker guardó entre las dos consultas", async () => {
  const { id, context, workspace } = documentFixture();
  const previous = { ...workspace, revision: workspace.revision - 1, document: { ...workspace.document, materials: {} } };
  const run = { status: "COMPLETED", operation: "MATERIALS", expected_revision: workspace.revision };
  let reads = 0;
  const query = {
    select(fields: string) { assert.match(fields, /expected_revision/); return query; },
    eq() { return query; }, order() { return query; }, limit() { return query; },
    async maybeSingle() { return { data: run, error: null }; },
  };
  const { deliverySnapshot } = load<typeof import("../services/delivery-api")>("src/domains/course-delivery/services/delivery-api.ts", {
    "./delivery-access": { requireDeliveryAccess: async () => ({ tenant: { organizationId: id }, admin: { from: () => query } }) },
    "./delivery-repository": { readDeliveryWorkspace: async () => ++reads === 1 ? previous : workspace, readDeliveryContext: async () => context },
    "./delivery-readiness": { deliveryReadiness: () => ({}) },
    "./delivery-commands": {}, "./delivery-settings": {}, "./delivery-live": {},
    "../../../lib/server/background-function-client": {},
    "../config/delivery-enabled": { deliveryEnabled: () => true },
  });
  const snapshot = await deliverySnapshot(id, false);
  assert.equal(reads, 2);
  assert.equal(snapshot.run?.status, "COMPLETED");
  assert.equal(snapshot.workspace.revision, workspace.revision);
  assert.ok(snapshot.workspace.document.materials[id]?.documents);
});
