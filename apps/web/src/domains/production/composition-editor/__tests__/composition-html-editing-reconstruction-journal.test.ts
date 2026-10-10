import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile, rm, link } from "node:fs/promises";
import { join } from "node:path";
import { createHtmlReconstructionOperationJournal } from "../composition-html-editing-reconstruction-journal.server";
import { htmlReconstructionStagingSchema } from "../composition-html-editing-reconstruction.contract";
import { createReconstructionPersistenceFixture } from "./composition-html-editing-reconstruction-persistence-fixtures";
import { HtmlReconstructionRepository } from "../composition-html-editing-reconstruction-repository.server";
import { htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

async function fixture() {
  const f = await createReconstructionPersistenceFixture(), parent = join(process.cwd(), ".tmp");
  await mkdir(parent, {recursive: true});
  const rootDirectory = await mkdtemp(join(parent, "cap029-reconstruction-journal-")), integrityKey = Buffer.alloc(32, 17);
  const staging = htmlReconstructionStagingSchema.parse({scope: "RECONSTRUCTION_STAGING_NOT_CREATION_OR_PUBLICATION",
    operationId: other, review: f.review, candidateSha256: f.candidate.candidateSha256,
    archiveSizeBytes: f.artifact.prepared.archiveBytes.length});
  return {...f, staging, rootDirectory, integrityKey, journal: createHtmlReconstructionOperationJournal({rootDirectory, integrityKey})};
}

test("private operation journal survives restart and separates staging from one explicit creation attempt", async () => {
  const f = await fixture();
  try {
    assert.deepEqual(await f.journal.preserveStaging(f.staging), f.staging);
    const restarted = createHtmlReconstructionOperationJournal({rootDirectory: f.rootDirectory, integrityKey: f.integrityKey});
    assert.deepEqual(await restarted.readStaging(other), f.staging);
    await assert.rejects(restarted.readCreationIntent(other), /JOURNAL_UNAVAILABLE/);
    assert.deepEqual(await restarted.preserveCreationIntent(f.staging), f.staging);
    assert.deepEqual(await restarted.readCreationIntent(other), f.staging);
    await assert.rejects(restarted.preserveStaging(f.staging), /WRITE_UNCONFIRMED/);
    await assert.rejects(restarted.preserveCreationIntent(f.staging), /WRITE_UNCONFIRMED/);
    assert.deepEqual(f.state.calls, []); assert.equal(f.state.uploads, 0);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("candidate changes, phase swapping, hard links and wrong keys cannot become journal authority", async () => {
  const f = await fixture();
  try {
    await f.journal.preserveStaging(f.staging);
    await assert.rejects(f.journal.preserveCreationIntent({...f.staging, candidateSha256: "b".repeat(64)}), /WRITE_UNCONFIRMED/);
    const path = join(f.rootDirectory, other, "operation.json"), original = await readFile(path);
    await writeFile(join(f.rootDirectory, other, "creation-intent.json"), original);
    await assert.rejects(f.journal.readCreationIntent(other), /JOURNAL_UNAVAILABLE/);
    await assert.rejects(createHtmlReconstructionOperationJournal({rootDirectory: f.rootDirectory,
      integrityKey: Buffer.alloc(32, 18)}).readStaging(other), /JOURNAL_UNAVAILABLE/);
    const altered = JSON.parse(original.toString()); altered.staging.review.approval.evidenceSha256 = "f".repeat(64);
    await writeFile(path, JSON.stringify(altered)); await assert.rejects(f.journal.readStaging(other), /JOURNAL_UNAVAILABLE/);
    await writeFile(path, original); await link(path, join(f.rootDirectory, other, "copy.json"));
    await assert.rejects(f.journal.readStaging(other), /JOURNAL_UNAVAILABLE/);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("partial operation directories are kept and never adopted; configuration and cancellation fail closed", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.rootDirectory, other));
    await assert.rejects(f.journal.preserveStaging(f.staging), /WRITE_UNCONFIRMED/);
    await assert.rejects(f.journal.readStaging(other), /JOURNAL_UNAVAILABLE/);
    assert.throws(() => createHtmlReconstructionOperationJournal({rootDirectory: "relative", integrityKey: f.integrityKey}), /CONFIGURATION_INVALID/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.journal.readStaging(other, controller.signal), error => (error as Error).name === "AbortError");
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("concrete journal is written/read back before stage/create and restart recovery performs only receipt reads", async () => {
  const f = await fixture();
  try {
    const repository = new HtmlReconstructionRepository(f.supabase, f.verify, f.journal.preserveCreationIntent);
    const result = await repository.stage({...f.stageInput, preserveStaging: f.journal.preserveStaging});
    assert.deepEqual(await f.journal.readStaging(other), result.staging);
    f.state.failAfter = "create";
    await assert.rejects(repository.create(result.staging, f.stageInput.authenticatedReviewerId), /OPERATION_UNCONFIRMED/);
    const restarted = createHtmlReconstructionOperationJournal({rootDirectory: f.rootDirectory, integrityKey: f.integrityKey});
    const identity = await restarted.readCreationIntent(other), before = f.state.calls.length;
    assert.equal((await repository.readCreation(identity, f.stageInput.authenticatedReviewerId)).status, "RECORDED");
    assert.deepEqual(f.state.calls.slice(before), ["read_html_reconstruction_creation"]);
    assert.equal(f.state.calls.filter(name => name === "create_html_reconstruction").length, 1);
    assert.equal(f.state.uploads, 1);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});
