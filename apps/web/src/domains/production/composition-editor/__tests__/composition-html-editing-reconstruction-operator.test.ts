import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHtmlReconstructionOperatorWorkflow } from "../composition-html-editing-reconstruction-operator.server";
import { executeHtmlReconstructionOperatorCommand as execute } from "../composition-html-editing-reconstruction-operator-command.server";
import { createHtmlReconstructionReviewJournal } from "../composition-html-editing-reconstruction-review-journal.server";
import { createHtmlReconstructionOperationJournal } from "../composition-html-editing-reconstruction-journal.server";
import { HtmlReconstructionRepository } from "../composition-html-editing-reconstruction-repository.server";
import { createHtmlReconstructionOperatorHost } from "../composition-html-editing-reconstruction-operator-host.server";
import { createReconstructionPersistenceFixture } from "./composition-html-editing-reconstruction-persistence-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

async function fixture() {
  const f = await createReconstructionPersistenceFixture();
  await mkdir(join(process.cwd(), ".tmp"), {recursive: true});
  const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-reconstruction-operator-"));
  const reviewRoot = join(root, "reviews"), operationRoot = join(root, "operations"), key = Buffer.alloc(32, 19);
  await mkdir(reviewRoot); await mkdir(operationRoot);
  const reviewJournal = createHtmlReconstructionReviewJournal({rootDirectory: reviewRoot, integrityKey: key});
  const operationJournal = createHtmlReconstructionOperationJournal({rootDirectory: operationRoot, integrityKey: key});
  const repository = new HtmlReconstructionRepository(f.supabase, f.verify, operationJournal.preserveCreationIntent);
  let recorded = false, revoked = false, loseReview = false, prepares = 0, reviewWrites = 0;
  const ports = {prepare: async () => {prepares++; return structuredClone(f.artifact);}, handoff: f.stageInput.handoff,
    repository, operationJournal, reviewJournal, storeArchive: f.stageInput.storeArchive,
    reviews: {
      recordReviewed: async () => {
        assert.deepEqual(await reviewJournal.read(other), f.review); recorded = true; reviewWrites++;
        if (loseReview) throw new Error("lost review ACK");
        return {record: f.review, created: true, revoked: false};
      },
      read: async () => recorded ? {status: "RECORDED" as const, record: structuredClone(f.review), revoked} : {status: "NOT_FOUND" as const},
      revoke: async () => {revoked = true; return {status: "RECORDED" as const, record: f.review, revoked};},
    }};
  const workflow = createHtmlReconstructionOperatorWorkflow(ports);
  const identity = {actorId: uuid, organizationId: uuid};
  const commandPorts = {workflow, authenticate: async () => identity, runtime: async () => {throw new Error("unexpected runtime");}, signal: AbortSignal.timeout(60_000)};
  const {reviewerId: _reviewer, ...approval} = f.review.approval; void _reviewer;
  const reviewCommand = {action: "REVIEW", locator: f.review.locator, approval};
  const stageCommand = {action: "STAGE", candidateId: other, operationId: other};
  const createCommand = {action: "CREATE", operationId: other, confirmation: "CREATE_INDEPENDENT_CONTENT_WITHOUT_ACTIVATING_OR_CHANGING_ORIGINAL"};
  return {...f, root, reviewRoot, key, reviewJournal, operationJournal, ports, commandPorts, reviewCommand, stageCommand, createCommand,
    loseReview: () => {loseReview = true;}, counts: () => ({prepares, reviewWrites}), cleanup: () => rm(root, {recursive: true, force: true})};
}

test("operator connects review, one stage and explicit isolated creation through concrete journals", async () => {
  const f = await fixture();
  try {
    await execute(f.reviewCommand, f.commandPorts); assert.equal(f.state.uploads, 0); assert.deepEqual(f.state.calls, []);
    const staged = await execute(f.stageCommand, f.commandPorts);
    assert.ok(staged); assert.equal(f.state.uploads, 1); assert.equal(f.state.receipt, undefined);
    const created = await execute(f.createCommand, f.commandPorts);
    assert.ok("status" in created); assert.equal(created.status, "CREATED_INDEPENDENT_CONTENT_NOT_PUBLISHED");
    assert.ok("editorPath" in created);
    assert.equal(created.editorPath, `/admin/assembly/reconstruction/${f.review.locator.targetDocumentId}?compositionId=${f.review.locator.targetCompositionId}`);
    const read = await execute({action: "READ_CREATION", operationId: other}, f.commandPorts);
    assert.ok("status" in read); assert.equal(read.status, "RECORDED"); assert.deepEqual(f.counts(), {prepares: 0, reviewWrites: 1});
    assert.ok("editorPath" in read); assert.equal(read.editorPath, created.editorPath);
    assert.deepEqual(await f.operationJournal.readCreationIntent(other), f.state.claim);
  } finally {await f.cleanup();}
});

test("lost review ACK survives restart; recovery never repeats the attestation or prepares content", async () => {
  const f = await fixture();
  try {
    f.loseReview(); await assert.rejects(execute(f.reviewCommand, f.commandPorts), /lost review ACK/);
    const workflow = createHtmlReconstructionOperatorWorkflow({...f.ports,
      reviewJournal: createHtmlReconstructionReviewJournal({rootDirectory: f.reviewRoot, integrityKey: f.key})});
    const recovered = await execute({action: "READ_REVIEW", candidateId: other}, {...f.commandPorts, workflow});
    assert.ok("status" in recovered); assert.equal(recovered.status, "RECORDED");
    await assert.rejects(execute(f.reviewCommand, {...f.commandPorts, workflow}), /JOURNAL_UNCONFIRMED/);
    assert.deepEqual(f.counts(), {prepares: 0, reviewWrites: 1}); assert.deepEqual(f.state.calls, []);
  } finally {await f.cleanup();}
});

test("lost stage/create acknowledgements recover read-only without uploading or creating again", async () => {
  const f = await fixture();
  try {
    await execute(f.reviewCommand, f.commandPorts); f.state.failAfter = "candidate";
    await assert.rejects(execute(f.stageCommand, f.commandPorts), /UNCONFIRMED/);
    const staged = await execute({action: "READ_STAGING", operationId: other}, f.commandPorts);
    assert.ok("status" in staged); assert.equal(staged.status, "RECORDED");
    f.state.failAfter = "create"; await assert.rejects(execute(f.createCommand, f.commandPorts), /UNCONFIRMED/);
    const calls = f.state.calls.length;
    const created = await execute({action: "READ_CREATION", operationId: other}, f.commandPorts);
    assert.ok("status" in created); assert.equal(created.status, "RECORDED");
    assert.equal(f.state.calls.length, calls + 1); assert.equal(f.state.uploads, 1);
    assert.equal(f.state.calls.filter(name => name === "create_html_reconstruction").length, 1);
    assert.deepEqual(f.counts(), {prepares: 0, reviewWrites: 1});
  } finally {await f.cleanup();}
});

test("command cannot select actor/tenant/runtime, bypass confirmation or reuse historical approval", async () => {
  const f = await fixture();
  try {
    for (const input of [{...f.reviewCommand, actorId: other}, {...f.reviewCommand, approval: {...f.reviewCommand.approval, reviewerId: other}},
      {...f.stageCommand, organizationId: other}, {...f.stageCommand, runtime: {}}, {...f.createCommand, confirmation: "yes"},
      {action: "CREATE", operationId: other}, {...f.reviewCommand, locator: {scope: "HISTORICAL_STAGING_LOCATOR_NOT_APPROVAL_OR_PUBLICATION"}}]) {
      await assert.rejects(execute(input, f.commandPorts));
    }
    assert.deepEqual(f.counts(), {prepares: 0, reviewWrites: 0}); assert.deepEqual(f.state.calls, []);
  } finally {await f.cleanup();}
});

test("cross-tenant/reviewer journal recovery and withdrawn review cannot reach storage or creation", async () => {
  const f = await fixture();
  try {
    await execute(f.reviewCommand, f.commandPorts);
    for (const identity of [{actorId: other, organizationId: uuid}, {actorId: uuid, organizationId: other}]) {
      await assert.rejects(execute({action: "READ_REVIEW", candidateId: other}, {...f.commandPorts, authenticate: async () => identity}), /FORBIDDEN/);
      await assert.rejects(execute(f.stageCommand, {...f.commandPorts, authenticate: async () => identity}), /FORBIDDEN/);
    }
    await execute({action: "WITHDRAW_REVIEW", candidateId: other, confirmation: "WITHDRAW_NEW_CONTENT_REVIEW"}, f.commandPorts);
    await assert.rejects(execute(f.stageCommand, f.commandPorts), /REVIEW_UNAVAILABLE/);
    assert.equal(f.state.uploads, 0); assert.deepEqual(f.state.calls, []);
  } finally {await f.cleanup();}
});

test("review intent tampering, wrong key and partial state do not authorize remote writes", async () => {
  const f = await fixture();
  try {
    await f.reviewJournal.preserve(f.review);
    await assert.rejects(createHtmlReconstructionReviewJournal({rootDirectory: f.reviewRoot,
      integrityKey: Buffer.alloc(32, 20)}).read(other), /UNAVAILABLE/);
    const path = join(f.reviewRoot, other, "review-intent.json"), original = await readFile(path);
    const tampered = JSON.parse(original.toString()); tampered.record.approval.evidenceSha256 = "f".repeat(64);
    await writeFile(path, JSON.stringify(tampered));
    await assert.rejects(execute(f.stageCommand, f.commandPorts), /JOURNAL_UNAVAILABLE/);
    await assert.rejects(execute(f.reviewCommand, f.commandPorts), /JOURNAL_UNCONFIRMED/);
    assert.deepEqual(f.counts(), {prepares: 0, reviewWrites: 0}); assert.deepEqual(f.state.calls, []);
  } finally {await f.cleanup();}
});

test("cancelled command performs no authentication, journal or backend action", async () => {
  let authenticated = false; const f = await fixture();
  try {
    await assert.rejects(execute(f.reviewCommand, {...f.commandPorts, signal: AbortSignal.abort(),
      authenticate: async () => {authenticated = true; return {actorId: uuid, organizationId: uuid};}}));
    assert.equal(authenticated, false); assert.deepEqual(f.state.calls, []);
  } finally {await f.cleanup();}
});

test("concrete host refuses identical/nested roots before contacting any backend", async () => {
  const f = await fixture();
  try {
    const config = {...f.source.configuration, readCatalog: () => f.reconstruction.catalog, integrityKey: f.key};
    await assert.rejects(createHtmlReconstructionOperatorHost({...config, handoffRoot: f.root, reviewRoot: f.root, operationRoot: f.reviewRoot}), /DISJOINT/);
    await assert.rejects(createHtmlReconstructionOperatorHost({...config, handoffRoot: f.root, reviewRoot: f.reviewRoot, operationRoot: join(f.root, "operations")}), /DISJOINT/);
    assert.deepEqual(f.state.calls, []); assert.equal(f.state.uploads, 0);
  } finally {await f.cleanup();}
});
