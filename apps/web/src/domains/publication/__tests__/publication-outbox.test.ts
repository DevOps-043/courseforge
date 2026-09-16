import assert from "node:assert/strict";
import test from "node:test";
import {
  hashPublicationPayload,
  isRecoverablePublicationOutbox,
  publicationOutboxPayloadSchema,
  publicationOutboxRequestSchema,
} from "../publication-outbox";

test("publication outbox hashes equivalent payloads deterministically", () => {
  const left = { course: { slug: "stable-course", title: "Course" }, modules: [], source: { artifact_id: "550e8400-e29b-41d4-a716-446655440000", platform: "courseengine" } };
  const right = { source: { platform: "courseengine", artifact_id: "550e8400-e29b-41d4-a716-446655440000" }, modules: [], course: { title: "Course", slug: "stable-course" } };
  assert.equal(hashPublicationPayload(left), hashPublicationPayload(right));
});

test("publication outbox validates its signed request and payload boundaries", () => {
  assert.equal(publicationOutboxRequestSchema.safeParse({ requestId: "550e8400-e29b-41d4-a716-446655440000" }).success, true);
  assert.equal(publicationOutboxRequestSchema.safeParse({ requestId: "invalid" }).success, false);
  assert.equal(publicationOutboxPayloadSchema.safeParse({
    source: { platform: "courseengine", artifact_id: "550e8400-e29b-41d4-a716-446655440000" },
    course: { slug: "stable-course" },
    modules: [],
  }).success, true);
});

test("publication reconciliation distinguishes stale queues and expired leases", () => {
  const now = Date.parse("2026-09-10T12:10:00.000Z");
  assert.equal(isRecoverablePublicationOutbox("QUEUED", null, "2026-09-10T12:08:00.000Z", now), true);
  assert.equal(isRecoverablePublicationOutbox("QUEUED", null, "2026-09-10T12:09:30.000Z", now), false);
  assert.equal(isRecoverablePublicationOutbox("RUNNING", "2026-09-10T12:09:59.000Z", "2026-09-10T12:09:00.000Z", now), true);
  assert.equal(isRecoverablePublicationOutbox("SENT", null, "2026-09-10T12:00:00.000Z", now), false);
});
