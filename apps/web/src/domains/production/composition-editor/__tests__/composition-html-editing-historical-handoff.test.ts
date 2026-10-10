import assert from "node:assert/strict";
import test from "node:test";
import { link, mkdir, mkdtemp, readFile, writeFile, rm, unlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHistoricalHtmlOperatorHandoff } from "../composition-html-editing-historical-handoff.server";
import { createHistoricalHtmlCandidatePreparer } from "../composition-html-editing-historical-candidate.server";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { createHistoricalHtmlOperatorWorkflow } from "../composition-html-editing-historical-operator.server";
import { HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS } from "../composition-html-editing-snapshot-republication-review.contract";

async function fixture() {
  const source = await createHistoricalCandidatePreparationFixture();
  const artifact = await createHistoricalHtmlCandidatePreparer(source.configuration)(source.input);
  const testRoot = join(process.cwd(), ".tmp"); await mkdir(testRoot, {recursive: true});
  const rootDirectory = await mkdtemp(join(testRoot, "cap029-private-handoff-")), integrityKey = Buffer.alloc(32, 7);
  return {artifact, rootDirectory, integrityKey, handoff: createHistoricalHtmlOperatorHandoff({rootDirectory, integrityKey})};
}

test("private handoff survives host restart with exact ZIP bytes and no acquisition/rebuild", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save(f.artifact);
    const reloaded = await createHistoricalHtmlOperatorHandoff({rootDirectory: f.rootDirectory, integrityKey: f.integrityKey}).load(locator);
    assert.deepEqual(reloaded, f.artifact);
    assert.deepEqual(await readFile(join(f.rootDirectory, locator.candidateId, "candidate.zip")), f.artifact.prepared.archiveBytes);
    assert.doesNotMatch(await readFile(join(f.rootDirectory, locator.candidateId, "handoff.json"), "utf8"), /private-test-key|integrityKey/);
    await assert.rejects(f.handoff.save(f.artifact), /SAVE_UNCONFIRMED/);
    assert.deepEqual((await f.handoff.load(locator)).prepared.archiveBytes, f.artifact.prepared.archiveBytes);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("ZIP/metadata/locator/seal tampering never produces a trusted artifact", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save(f.artifact), path = join(f.rootDirectory, locator.candidateId);
    for (const filename of ["candidate.zip", "artifact.json", "handoff.json"]) {
      const file = join(path, filename), original = await readFile(file), changed = Buffer.from(original);
      changed[0] = changed[0]! ^ 1; await writeFile(file, changed);
      await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/);
      await writeFile(file, original);
    }
    await assert.rejects(f.handoff.load({...locator, projectHash: "f".repeat(64)}), /HANDOFF_UNAVAILABLE/);
    await assert.rejects(createHistoricalHtmlOperatorHandoff({rootDirectory: f.rootDirectory, integrityKey: Buffer.alloc(32, 8)}).load(locator), /HANDOFF_UNAVAILABLE/);
    assert.deepEqual(await f.handoff.load(locator), f.artifact);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("incomplete receipt is preserved and cannot be silently overwritten or resumed", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save(f.artifact), path = join(f.rootDirectory, locator.candidateId);
    await unlink(join(path, "handoff.json"));
    await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/);
    await assert.rejects(f.handoff.save(f.artifact), /SAVE_UNCONFIRMED/);
    assert.deepEqual(await readFile(join(path, "candidate.zip")), f.artifact.prepared.archiveBytes);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("hard-linked artifact files are refused instead of trusting a second writable alias", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save(f.artifact), path = join(f.rootDirectory, locator.candidateId);
    await link(join(path, "candidate.zip"), join(path, "second-alias.zip"));
    await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/);
    await unlink(join(path, "second-alias.zip"));
    assert.deepEqual(await f.handoff.load(locator), f.artifact);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("configuration, scope traversal and pre-abort fail closed", async () => {
  assert.throws(() => createHistoricalHtmlOperatorHandoff({rootDirectory: "relative", integrityKey: Buffer.alloc(32)}), /CONFIGURATION_INVALID/);
  assert.throws(() => createHistoricalHtmlOperatorHandoff({rootDirectory: tmpdir(), integrityKey: Buffer.alloc(31)}), /CONFIGURATION_INVALID/);
  const f = await fixture();
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.handoff.save(f.artifact, controller.signal), {name: "AbortError"});
    const locator = await f.handoff.save(f.artifact);
    await assert.rejects(f.handoff.load({...locator, candidateId: "../outside"}), /HANDOFF_UNAVAILABLE/);
    await assert.rejects(f.handoff.load(locator, controller.signal), {name: "AbortError"});
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("operator staging reloads exact frozen bytes and approval, never reruns preparation", async () => {
  const f = await fixture();
  try {
    let prepares = 0, stages = 0;
    const workflow = createHistoricalHtmlOperatorWorkflow({
      prepare: async () => {prepares++; return f.artifact;}, handoff: f.handoff,
      storeArchive: async () => {throw new Error("remote writes forbidden in this test");},
      repository: {
        stageReviewedCandidate: async input => {
          stages++; assert.deepEqual(input.artifact, f.artifact);
          assert.equal(input.approval.reviewedProjectHash, f.artifact.prepared.projectHash);
          return {candidateId: input.artifact.provenance.candidateId, candidateSha256: "a".repeat(64), created: true,
            locator: {scope: "HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION" as const,
              ...input.artifact.provenance, reviewerId: input.approval.reviewerId,
              projectHash: input.artifact.prepared.projectHash, evidenceSha256: input.approval.evidenceSha256, candidateSha256: "a".repeat(64)}};
        },
        readStaging: async () => ({status: "NOT_FOUND" as const}),
      },
    });
    const source = await createHistoricalCandidatePreparationFixture();
    const locator = await workflow.prepareForReview(source.input);
    assert.equal(prepares, 1); assert.equal(stages, 0);
    await workflow.stageAfterReview({locator, approval: {reviewerId: f.artifact.review.actorId,
      reviewedProjectHash: locator.projectHash, evidenceSha256: "b".repeat(64),
      completedReviews: [...HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS]}});
    assert.equal(prepares, 1); assert.equal(stages, 1);
    await writeFile(join(f.rootDirectory, locator.candidateId, "candidate.zip"), "corrupt");
    await assert.rejects(workflow.stageAfterReview({locator, approval: {reviewerId: f.artifact.review.actorId,
      reviewedProjectHash: locator.projectHash, evidenceSha256: "b".repeat(64), completedReviews: [...HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS]}}));
    assert.equal(stages, 1);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});
