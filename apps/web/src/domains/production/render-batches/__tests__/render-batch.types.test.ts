import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  renderBatchRequestSchema,
  renderWorkerCapacitySchema,
} from "../render-batch.types";

describe("render batch contracts", () => {
  it("defaults worker capacity conservatively to one concurrent job", () => {
    const capacity = renderWorkerCapacitySchema.parse({});

    assert.equal(capacity.maxConcurrentJobs, 1);
    assert.equal(capacity.runningJobs, 0);
    assert.equal(capacity.source, "UNKNOWN");
  });

  it("rejects unsafe worker concurrency limits", () => {
    assert.throws(() => renderWorkerCapacitySchema.parse({ maxConcurrentJobs: 0 }));
    assert.throws(() => renderWorkerCapacitySchema.parse({ maxConcurrentJobs: 9 }));
  });

  it("accepts a batch request with global template and per-item overrides", () => {
    const request = renderBatchRequestSchema.parse({
      artifactId: "11111111-1111-4111-8111-111111111111",
      defaultTemplateId: "22222222-2222-4222-8222-222222222222",
      assignmentMode: "MIXED",
      items: [
        {
          componentId: "33333333-3333-4333-8333-333333333333",
          templateId: "44444444-4444-4444-8444-444444444444",
          preferredWorkerId: "55555555-5555-4555-8555-555555555555",
          variables: { componentTitle: "Leccion 1" },
        },
      ],
    });

    assert.equal(request.assignmentMode, "MIXED");
    assert.equal(request.items[0].templateId, "44444444-4444-4444-8444-444444444444");
    assert.equal(request.items[0].preferredWorkerId, "55555555-5555-4555-8555-555555555555");
  });
});
