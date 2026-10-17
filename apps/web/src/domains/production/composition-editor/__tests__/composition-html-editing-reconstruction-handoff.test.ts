import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, unlink, link, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHtmlReconstructionHandoff, readReviewedHtmlReconstructionHandoff } from "../composition-html-editing-reconstruction-handoff.server";
import { createHtmlHistoricalReconstructionArchivePreparer } from "../composition-html-editing-reconstruction-archive.server";
import { createHtmlReconstructionSlideResourceAcquirer } from "../composition-html-editing-reconstruction-resources.server";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { createHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { HTML_RECONSTRUCTION_REQUIRED_REVIEWS } from "../composition-html-editing-reconstruction.contract";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

async function fixture() {
  const source = await createHistoricalCandidatePreparationFixture(), reconstruction = createHtmlReconstructionFixture();
  const artifact = await createHtmlHistoricalReconstructionArchivePreparer({supabase: source.configuration.supabase,
    storageOrigin: source.configuration.supabaseUrl, fetchResource: source.configuration.fetchImpl,
    readCatalog: () => reconstruction.catalog, acquireResources: createHtmlReconstructionSlideResourceAcquirer(source.configuration.supabase)})({
      ...source.input, reconstruction: {target: reconstruction.target, document: reconstruction.document,
        expectedDocumentHash: reconstruction.expectedDocumentHash}});
  const parent = join(process.cwd(), ".tmp"); await mkdir(parent, {recursive: true});
  const rootDirectory = await mkdtemp(join(parent, "cap029-reconstruction-handoff-")), integrityKey = Buffer.alloc(32, 13);
  return {artifact, rootDirectory, integrityKey, source,
    handoff: createHtmlReconstructionHandoff({rootDirectory, integrityKey})};
}

test("reconstruction handoff survives restart with exact new-content bytes and source/target metadata without recompilation", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save({candidateId: other, artifact: f.artifact}), reads = f.source.state.archiveReads;
    const loaded = await createHtmlReconstructionHandoff({rootDirectory: f.rootDirectory, integrityKey: f.integrityKey}).load(locator);
    assert.deepEqual(loaded, f.artifact); assert.equal(f.source.state.archiveReads, reads);
    assert.equal(locator.sourceCompositionId, uuid); assert.equal(locator.targetCompositionId, other);
    assert.equal(locator.scope, "RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION");
    assert.deepEqual(await readFile(join(f.rootDirectory, other, "candidate.zip")), f.artifact.prepared.archiveBytes);
    assert.doesNotMatch(await readFile(join(f.rootDirectory, other, "artifact.json"), "utf8"), /grantedAssetIds|imageSources|private-test-key/);
    await assert.rejects(f.handoff.save({candidateId: other, artifact: f.artifact}), /SAVE_UNCONFIRMED/);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("handoff captures bytes, metadata and key before asynchronous filesystem operations", async () => {
  const f = await fixture();
  try {
    const expectedBytes = Buffer.from(f.artifact.prepared.archiveBytes), expectedTitle = f.artifact.candidate.document.variables.title;
    const pending = f.handoff.save({candidateId: other, artifact: f.artifact});
    f.artifact.prepared.archiveBytes.fill(0); f.artifact.candidate.document.variables.title = "MUTATED"; f.integrityKey.fill(0);
    const locator = await pending, loaded = await f.handoff.load(locator);
    assert.deepEqual(loaded.prepared.archiveBytes, expectedBytes);
    assert.equal(loaded.candidate.document.variables.title, expectedTitle);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("file, locator, key and historical-domain seal tampering never yields reconstructed content", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save({candidateId: other, artifact: f.artifact}), directory = join(f.rootDirectory, other);
    for (const filename of ["candidate.zip", "artifact.json", "handoff.json"]) {
      const path = join(directory, filename), original = await readFile(path), changed = Buffer.from(original);
      changed[0] ^= 1; await writeFile(path, changed);
      await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/); await writeFile(path, original);
    }
    await assert.rejects(f.handoff.load({...locator, targetDocumentId: uuid}), /HANDOFF_UNAVAILABLE/);
    await assert.rejects(createHtmlReconstructionHandoff({rootDirectory: f.rootDirectory, integrityKey: Buffer.alloc(32, 14)}).load(locator), /HANDOFF_UNAVAILABLE/);
    const receiptPath = join(directory, "handoff.json"), receipt = JSON.parse(await readFile(receiptPath, "utf8"));
    receipt.seal = createHmac("sha256", f.integrityKey).update("COURSEFORGE_PRIVATE_HISTORICAL_HANDOFF_V1\n").update(JSON.stringify(locator)).digest("hex");
    await writeFile(receiptPath, JSON.stringify(receipt));
    await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("partial receipts and hard-linked files are retained and refused, never adopted or overwritten", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save({candidateId: other, artifact: f.artifact}), directory = join(f.rootDirectory, other);
    await link(join(directory, "candidate.zip"), join(directory, "second.zip"));
    await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/); await unlink(join(directory, "second.zip"));
    await unlink(join(directory, "handoff.json"));
    await assert.rejects(f.handoff.load(locator), /HANDOFF_UNAVAILABLE/);
    await assert.rejects(f.handoff.save({candidateId: other, artifact: f.artifact}), /SAVE_UNCONFIRMED/);
    assert.deepEqual(await readFile(join(directory, "candidate.zip")), f.artifact.prepared.archiveBytes);
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("independent review binds candidate, full ZIP, source/target metadata and authenticated reviewer", async () => {
  const f = await fixture();
  try {
    const locator = await f.handoff.save({candidateId: other, artifact: f.artifact});
    const approval = {candidateId: other, reviewerId: uuid, evidenceSha256: "e".repeat(64), reviewedProjectHash: locator.projectHash,
      reviewedMetadataSha256: locator.metadataSha256, completedReviews: [...HTML_RECONSTRUCTION_REQUIRED_REVIEWS] as [...typeof HTML_RECONSTRUCTION_REQUIRED_REVIEWS]};
    const input = {handoff: f.handoff, locator, approval, authenticatedReviewerId: uuid};
    const reviewed = await readReviewedHtmlReconstructionHandoff(input);
    assert.equal(reviewed.scope, "REVIEW_BOUND_RECONSTRUCTION_NOT_CURRENT_AUTHORITY_OR_CREATION");
    assert.deepEqual(reviewed.artifact, f.artifact);
    for (const failure of ["zip", "metadata", "candidate", "reviewer", "historical", "extra"] as const) {
      const changed = structuredClone(approval);
      if (failure === "zip") changed.reviewedProjectHash = "f".repeat(64);
      if (failure === "metadata") changed.reviewedMetadataSha256 = "f".repeat(64);
      if (failure === "candidate") changed.candidateId = uuid;
      if (failure === "reviewer") changed.reviewerId = other;
      if (failure === "historical") Object.assign(changed, {completedReviews: ["HISTORICAL_VISUAL_COMPARISON", "CURRENT_CONTENT_AND_ACCESSIBILITY", "AUTHORIZED_REPUBLICATION"]});
      if (failure === "extra") Object.assign(changed, {activated: true});
      await assert.rejects(readReviewedHtmlReconstructionHandoff({...input, approval: changed}), /REVIEW_UNAVAILABLE/);
    }
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});

test("configuration, traversal, inconsistent metadata and cancellation fail closed without replacement", async () => {
  assert.throws(() => createHtmlReconstructionHandoff({rootDirectory: "relative", integrityKey: Buffer.alloc(32)}), /CONFIGURATION_INVALID/);
  const f = await fixture();
  try {
    const controller = new AbortController(); controller.abort();
    await assert.rejects(f.handoff.save({candidateId: other, artifact: f.artifact}, controller.signal), {name: "AbortError"});
    const bad = {...f.artifact, prepared: {...f.artifact.prepared, metadata: {...f.artifact.prepared.metadata, bindings: []}}};
    await assert.rejects(f.handoff.save({candidateId: other, artifact: bad}), /SAVE_UNCONFIRMED/);
    const locator = await f.handoff.save({candidateId: other, artifact: f.artifact});
    await assert.rejects(f.handoff.load({...locator, candidateId: "../outside"}), /HANDOFF_UNAVAILABLE/);
    await assert.rejects(f.handoff.load(locator, controller.signal), {name: "AbortError"});
  } finally {await rm(f.rootDirectory, {recursive: true, force: true});}
});
