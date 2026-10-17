import assert from "node:assert/strict";
import test from "node:test";
import { executeHistoricalHtmlOperatorCommand } from "../composition-html-editing-historical-operator-command.server";
import { HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS } from "../composition-html-editing-snapshot-republication-review.contract";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function fixture() {
  const calls: unknown[] = [];
  const locator = {candidateId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid,
    projectHash: "a".repeat(64), metadataSha256: "b".repeat(64)};
  const ports = {signal: new AbortController().signal, authenticate: async () => ({actorId: other, organizationId: uuid}),
    runtime: async () => {calls.push("runtime"); return {} as never;},
    workflow: {prepareForReview: async (input: unknown) => {calls.push(input); return locator;},
      stageAfterReview: async (input: unknown) => {calls.push(input); return {} as never;},
      readStaging: async (input: unknown) => {calls.push(input); return {status: "NOT_FOUND" as const};}}};
  const approval = {reviewedProjectHash: locator.projectHash, evidenceSha256: "c".repeat(64), completedReviews: [...HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS]};
  return {ports, calls, locator, approval};
}

test("operator PREPARE installs only host-authenticated identity and runtime", async () => {
  const f = fixture();
  await executeHistoricalHtmlOperatorCommand({action: "PREPARE", compositionId: uuid, draftId: uuid, revisionId: uuid, candidateId: other}, f.ports);
  assert.equal(f.calls[0], "runtime");
  assert.deepEqual((f.calls[1] as {request: unknown}).request, {actorId: other, organizationId: uuid, compositionId: uuid, draftId: uuid, revisionId: uuid});
});

test("operator STAGE binds reviewer to authenticated host and does not load runtime", async () => {
  const f = fixture();
  await executeHistoricalHtmlOperatorCommand({action: "STAGE", locator: f.locator, approval: f.approval}, f.ports);
  assert.equal(f.calls.length, 1);
  assert.equal((f.calls[0] as {approval: {reviewerId: string}}).approval.reviewerId, other);
});

test("operator rejects injected identity/runtime/approval reviewer and foreign tenant before workflow", async () => {
  const f = fixture();
  for (const input of [
    {action: "PREPARE", compositionId: uuid, draftId: uuid, revisionId: uuid, candidateId: other, actorId: uuid},
    {action: "STAGE", locator: f.locator, approval: {...f.approval, reviewerId: uuid}},
    {action: "STAGE", locator: {...f.locator, organizationId: other}, approval: f.approval},
    {action: "STAGE", locator: f.locator, approval: f.approval, renderProfile: {}},
  ]) await assert.rejects(executeHistoricalHtmlOperatorCommand(input, f.ports));
  assert.equal(f.calls.length, 0);
});

test("operator recovery binds reviewer and never invokes prepare/stage/runtime on auth failure or abort", async () => {
  const f = fixture(), {metadataSha256: omittedMetadata, ...identity} = f.locator;
  void omittedMetadata;
  const locator = {...identity, scope: "HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION", reviewerId: other,
    evidenceSha256: "c".repeat(64), candidateSha256: "d".repeat(64)};
  await executeHistoricalHtmlOperatorCommand({action: "READ_STAGING", locator}, f.ports);
  assert.deepEqual(f.calls, [locator]); f.calls.length = 0;
  await assert.rejects(executeHistoricalHtmlOperatorCommand({action: "READ_STAGING", locator: {...locator, reviewerId: uuid}}, f.ports));
  await assert.rejects(executeHistoricalHtmlOperatorCommand({action: "READ_STAGING", locator}, {...f.ports, authenticate: async () => {throw new Error("denied");}}));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(executeHistoricalHtmlOperatorCommand({action: "READ_STAGING", locator}, {...f.ports, signal: controller.signal}));
  assert.equal(f.calls.length, 0);
});
