import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { HtmlReconstructionReviewRepository } from "../composition-html-editing-reconstruction-review-repository.server";
import { htmlReconstructionReviewRecordSchema, HTML_RECONSTRUCTION_REQUIRED_REVIEWS,
  type HtmlReconstructionReviewRecord } from "../composition-html-editing-reconstruction.contract";
import { createHtmlHistoricalReconstructionArchivePreparer } from "../composition-html-editing-reconstruction-archive.server";
import { createHtmlReconstructionSlideResourceAcquirer } from "../composition-html-editing-reconstruction-resources.server";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { createHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

async function fixture() {
  const source = await createHistoricalCandidatePreparationFixture(), reconstruction = createHtmlReconstructionFixture();
  const artifact = await createHtmlHistoricalReconstructionArchivePreparer({supabase: source.configuration.supabase,
    storageOrigin: source.configuration.supabaseUrl, fetchResource: source.configuration.fetchImpl,
    readCatalog: () => reconstruction.catalog, acquireResources: createHtmlReconstructionSlideResourceAcquirer(source.configuration.supabase)})(
    {...source.input, reconstruction: {target: reconstruction.target, document: reconstruction.document,
      expectedDocumentHash: reconstruction.expectedDocumentHash}});
  const locator = {scope: "RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION" as const,
    candidateId: other, organizationId: uuid, sourceCompositionId: uuid, sourceDraftId: uuid,
    targetCompositionId: artifact.candidate.target.compositionId, targetDocumentId: artifact.candidate.target.documentId,
    targetRevisionId: artifact.candidate.target.revisionId, projectHash: artifact.prepared.projectHash, metadataSha256: "a".repeat(64)};
  const approval = {candidateId: other, reviewerId: uuid, evidenceSha256: "e".repeat(64), reviewedProjectHash: locator.projectHash,
    reviewedMetadataSha256: locator.metadataSha256, completedReviews: [...HTML_RECONSTRUCTION_REQUIRED_REVIEWS] as [...typeof HTML_RECONSTRUCTION_REQUIRED_REVIEWS]};
  const record = htmlReconstructionReviewRecordSchema.parse({scope: "RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY",
    locator, origin: artifact.candidate.origin, approval});
  let loads = 0;
  // Trusted port fake. Actual filesystem/HMAC verification has its own suite.
  const handoff = {load: async () => {loads++; return structuredClone(artifact);}, save: async () => {throw new Error("unexpected save");}};
  return {source, artifact, locator, approval, record, handoff, authenticatedReviewerId: uuid, loads: () => loads};
}

function fakeRepository(respond: (name: string, record: HtmlReconstructionReviewRecord, signal: AbortSignal) => unknown) {
  const calls: string[] = [];
  const repository = new HtmlReconstructionReviewRepository({rpc: (name: string, parameters: {p_org: string; p_actor: string; p_record: HtmlReconstructionReviewRecord}) => {
    calls.push(name);
    assert.equal(parameters.p_org, parameters.p_record.locator.organizationId);
    assert.equal(parameters.p_actor, parameters.p_record.approval.reviewerId);
    return {abortSignal: async (signal: AbortSignal) => ({data: await respond(name, parameters.p_record, signal), error: null})};
  }} as never);
  return {repository, calls};
}

test("independent review is attested once with exact source/target/ZIP/evidence, no Storage or content creation", async () => {
  const f = await fixture(), original = structuredClone(f.artifact), reads = f.source.state.archiveReads;
  const rpc = fakeRepository((name, record) => {
    assert.equal(name, "record_html_reconstruction_review");
    assert.deepEqual(record, f.record);
    return {record, created: true, revoked: false};
  });
  assert.deepEqual(await rpc.repository.recordReviewed(f), {record: f.record, created: true, revoked: false});
  assert.equal(f.loads(), 1); assert.deepEqual(structuredClone(f.artifact), original);
  assert.equal(f.source.state.archiveReads, reads);
  assert.deepEqual(rpc.calls, ["record_html_reconstruction_review"]);
});

test("uncertain review ACK is recovered with a read only, without load/compile/another write", async () => {
  const f = await fixture(); let persisted: HtmlReconstructionReviewRecord | undefined;
  const rpc = fakeRepository((name, record) => {
    if (name === "record_html_reconstruction_review") {persisted = structuredClone(record); throw new Error("private service failure");}
    assert.equal(name, "read_html_reconstruction_review"); return {status: "RECORDED", record: persisted, revoked: false};
  });
  await assert.rejects(rpc.repository.recordReviewed(f), /^Error: HTML_RECONSTRUCTION_REVIEW_UNCONFIRMED$/);
  const reads = f.source.state.archiveReads;
  assert.deepEqual(await rpc.repository.read(f.record, uuid), {status: "RECORDED", record: f.record, revoked: false});
  assert.equal(f.loads(), 1); assert.equal(f.source.state.archiveReads, reads);
  assert.deepEqual(rpc.calls, ["record_html_reconstruction_review", "read_html_reconstruction_review"]);
});

test("NOT_FOUND reconciliation never permits another write and current authority failures are safe", async () => {
  const f = await fixture(), missing = fakeRepository(() => ({status: "NOT_FOUND"}));
  assert.deepEqual(await missing.repository.read(f.record, uuid), {status: "NOT_FOUND"});
  assert.deepEqual(missing.calls, ["read_html_reconstruction_review"]); assert.equal(f.loads(), 0);
  const revokedActor = fakeRepository(() => {throw new Error("private tenant role and resource details");});
  await assert.rejects(revokedActor.repository.read(f.record, uuid), /^Error: HTML_RECONSTRUCTION_REVIEW_UNCONFIRMED$/);
  assert.equal(revokedActor.calls.length, 1);
});

test("reviewer/hash/review-label mismatches and invalid handoff stop before persistence", async () => {
  const f = await fixture(), rpc = fakeRepository(() => {throw new Error("unexpected RPC");});
  for (const approval of [{...f.approval, reviewerId: other}, {...f.approval, reviewedProjectHash: "b".repeat(64)},
    {...f.approval, reviewedMetadataSha256: "b".repeat(64)}, {...f.approval, completedReviews: ["AUTHORIZED_REPUBLICATION"]}])
    await assert.rejects(rpc.repository.recordReviewed({...f, approval: approval as typeof f.approval}));
  await assert.rejects(rpc.repository.recordReviewed({...f, handoff: {...f.handoff, load: async () => {throw new Error("invalid seal");}}}));
  await assert.rejects(rpc.repository.read(f.record, other), /REVIEW_FORBIDDEN/);
  assert.deepEqual(rpc.calls, []);
});

test("ACKs for changed evidence, origin, scope or shape cannot confirm the reviewed content", async () => {
  const f = await fixture();
  for (const mutation of ["evidence", "origin", "scope", "extra", "oversize"] as const) {
    const rpc = fakeRepository((_name, record) => {
      const changed = structuredClone(record);
      if (mutation === "evidence") changed.approval.evidenceSha256 = "f".repeat(64);
      if (mutation === "origin") changed.origin.bundleSha256 = "f".repeat(64);
      if (mutation === "scope") Object.assign(changed, {scope: "CREATED"});
      return {...{record: changed, created: true, revoked: false},
        ...(mutation === "extra" ? {createdComposition: true} : {}), ...(mutation === "oversize" ? {private: "x".repeat(5000)} : {})};
    });
    await assert.rejects(rpc.repository.recordReviewed(f)); assert.equal(rpc.calls.length, 1);
  }
});

test("withdrawal keeps immutable review receipts, never reinstates or mutates source content", async () => {
  const f = await fixture(); let revoked = false;
  const rpc = fakeRepository((name, record) => {
    if (name === "revoke_html_reconstruction_review") revoked = true;
    return name === "record_html_reconstruction_review" ? {record, created: false, revoked}
      : {status: "RECORDED", record, revoked};
  });
  assert.equal((await rpc.repository.revoke(f.record, uuid)).revoked, true);
  assert.deepEqual(await rpc.repository.read(f.record, uuid), {status: "RECORDED", record: f.record, revoked: true});
  await assert.rejects(rpc.repository.recordReviewed(f), /REVIEW_REVOKED/);
  const missing = fakeRepository(() => ({status: "NOT_FOUND"}));
  await assert.rejects(missing.repository.revoke(f.record, uuid), /ACK_INVALID/);
});

test("identities are captured before awaits and cancelled operations never contact the database", async () => {
  const f = await fixture(), expected = structuredClone(f.record);
  const rpc = fakeRepository((_name, record, signal) => {assert.equal(signal.aborted, false); return {record, created: true, revoked: false};});
  const pending = rpc.repository.recordReviewed(f);
  f.approval.evidenceSha256 = "f".repeat(64); f.locator.metadataSha256 = "f".repeat(64);
  assert.deepEqual((await pending).record, expected);
  const controller = new AbortController(); controller.abort();
  const cancelled = fakeRepository(() => {throw new Error("unexpected RPC");});
  await assert.rejects(cancelled.repository.read(expected, uuid, controller.signal), error => (error as Error).name === "AbortError");
  await assert.rejects(cancelled.repository.recordReviewed({...f, locator: expected.locator, approval: expected.approval,
    signal: controller.signal}), error => (error as Error).name === "AbortError");
  assert.deepEqual(cancelled.calls, []);
});

test("review record requires a separate target and exact provenance/approval, with no arbitrary fields", async () => {
  const f = await fixture();
  for (const mutation of ["composition", "document", "revision", "project", "candidate", "tenant", "extra"] as const) {
    const record = structuredClone(f.record);
    if (mutation === "composition") record.locator.targetCompositionId = record.origin.compositionId;
    if (mutation === "document") record.locator.targetDocumentId = record.origin.draftId;
    if (mutation === "revision") record.locator.targetRevisionId = record.origin.revisionId;
    if (mutation === "project") record.locator.projectHash = record.approval.reviewedProjectHash = record.origin.projectHash;
    if (mutation === "candidate") record.approval.candidateId = uuid;
    if (mutation === "tenant") record.origin.organizationId = other;
    if (mutation === "extra") Object.assign(record, {grants: [uuid]});
    assert.equal(htmlReconstructionReviewRecordSchema.safeParse(record).success, false);
  }
});

test("prepared review SQL has a private service-only boundary and does not compile historical HTML or write original content", async () => {
  const sql = await readFile("../../supabase/migrations/20261009150000_html_reconstruction_review.sql", "utf8");
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON private\.composition_html_reconstruction_reviews FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /public\.read_html_editing_snapshot_archive\(p_org,p_actor/);
  assert.match(sql, /ON CONFLICT \(organization_id,candidate_id\) DO NOTHING/);
  assert.match(sql, /stored\.record IS DISTINCT FROM p_record/);
  assert.match(sql, /SET revoked = true/);
  assert.doesNotMatch(sql, /SET revoked = false|read_html_editing_compilation\(|INSERT INTO public\.|UPDATE public\.|DELETE FROM/i);
  for (const rpc of ["record", "read", "revoke"]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${rpc}_html_reconstruction_review\\(uuid,uuid,jsonb\\) FROM PUBLIC,anon,authenticated`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${rpc}_html_reconstruction_review\\(uuid,uuid,jsonb\\) TO service_role`));
  }
});
