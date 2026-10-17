import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { HistoricalHtmlPublicationRepository } from "../composition-html-editing-historical-publication-repository.server";
import { HTML_HISTORICAL_PUBLICATION_MODE, htmlHistoricalPublicationApprovalSchema, htmlHistoricalPublicationReceiptSchema,
  type HtmlHistoricalStagingLocator } from "../composition-html-editing-historical-publication.contract";
import { historicalHtmlPublicationRequestPreimage } from "../composition-html-editing-historical-publication-preimage";
import { HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS } from "../composition-html-editing-snapshot-republication-review.contract";
import { prepareCompositionHtmlEditingSnapshotArchive } from "../composition-html-editing-snapshot-archive.server";
import { publishCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-publication.server";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

const command = {organizationId: uuid, compositionId: uuid, draftId: uuid, actorId: uuid, operationId: uuid,
  request: {candidateId: uuid, candidateSha256: "a".repeat(64)}};
const receipt = {...command, scope: "HISTORICAL_PUBLICATION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED" as const,
  requestSha256: createHash("sha256").update(historicalHtmlPublicationRequestPreimage(command)).digest("hex"),
  originalRevisionId: uuid, originalProjectHash: "b".repeat(64), projectHash: "c".repeat(64),
  revisionId: other, revisionNumber: 2, activeRevisionIdAtCommit: uuid, currentDraftHashAtCommit: "d".repeat(64),
  activated: false as const, draftChanged: false as const};

test("historical receipt replay reads metadata only, without compiler, Storage or activation", async () => {
  const calls: string[] = [];
  const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string) => {
    calls.push(name); return {abortSignal: async () => ({data: {status: "RECORDED", receipt}, error: null})};
  }} as never);
  assert.deepEqual(await repository.commit(command), receipt);
  assert.deepEqual(calls, ["read_html_historical_publication_operation"]);
});

test("historical recovery rejects mismatched owner, request, digest and activating ACK", async () => {
  for (const patch of [{actorId: other}, {request: {...command.request, candidateId: other}},
    {requestSha256: "e".repeat(64)}, {activated: true}, {draftChanged: true}, {activeRevisionIdAtCommit: other}]) {
    const repository = new HistoricalHtmlPublicationRepository({rpc: () => ({abortSignal: async () =>
      ({data: {status: "RECORDED", receipt: {...receipt, ...patch}}, error: null})})} as never);
    await assert.rejects(repository.readOperation(command));
  }
});

test("receipt cannot silently reuse original identity or claim rendered/current authority", () => {
  for (const patch of [{revisionId: uuid}, {projectHash: receipt.originalProjectHash}, {scope: "RENDERED"}, {sourceHtml: "private"}])
    assert.equal(htmlHistoricalPublicationReceiptSchema.safeParse({...receipt, ...patch}).success, false);
});

test("private RPC exceptions do not escape as provider details and are not retried", async () => {
  let calls = 0;
  const repository = new HistoricalHtmlPublicationRepository({rpc: () => ({abortSignal: async () => {
    calls++; throw new Error("credential and internal database details");
  }})} as never);
  await assert.rejects(repository.readOperation(command), /^Error: HTML_HISTORICAL_OPERATION_UNCONFIRMED$/);
  assert.equal(calls, 1);
});

test("aborted recovery never contacts database", async () => {
  const repository = new HistoricalHtmlPublicationRepository({rpc: () => {throw new Error("unexpected RPC");}} as never);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(repository.readOperation(command, controller.signal), error => (error as Error).name === "AbortError");
});

async function stagedFixture() {
  const fixture = await createPreparedHtmlArchiveFixture();
  const original = await prepareCompositionHtmlEditingSnapshotArchive(fixture.input);
  const provenance = {organizationId: uuid, compositionId: uuid, draftId: uuid, candidateId: uuid,
    originalRevisionId: uuid, originalProjectHash: original.projectHash, originalBundleSha256: original.bundle.sha256,
    documentId: uuid, documentHash: original.documentHash, candidateBundleSha256: original.bundle.sha256,
    publicationMode: HTML_HISTORICAL_PUBLICATION_MODE};
  const prepared = await prepareCompositionHtmlEditingSnapshotArchive({...fixture.input, historicalRepublication: provenance});
  const artifact = {scope: "PREPARED_HISTORICAL_ARCHIVE_NOT_APPROVED_UPLOADED_OR_PUBLISHED" as const,
    provenance, prepared, review: {} as never};
  const approval = htmlHistoricalPublicationApprovalSchema.parse({reviewerId: uuid, evidenceSha256: "f".repeat(64), reviewedProjectHash: prepared.projectHash,
    completedReviews: [...HTML_SNAPSHOT_REPUBLICATION_REQUIRED_REVIEWS]});
  let recorded: Record<string, unknown> | undefined;
  const base = fixture.input.supabase as unknown as {rpc(name: string, args: Record<string, unknown>): unknown};
  const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string, args: Record<string, unknown>) =>
    name === "record_html_historical_candidate" ? {abortSignal: async () => {recorded = args; return {data: true, error: null};}}
      : name === "record_html_historical_staging_locator" ? {abortSignal: async () => ({data: {locator: args.p_locator, created: true}, error: null})}
      : base.rpc(name, args)} as never);
  const storeArchive = async (input: {bytes: Uint8Array; projectHash: string}) => ({projectHash: input.projectHash,
    sizeBytes: input.bytes.length, storageBucket: "production-assets" as const,
    storagePath: `composition-snapshots/${uuid}/${uuid}/${input.projectHash}.zip`});
  const recordStagingLocator = async (locator: HtmlHistoricalStagingLocator) => ({locator: structuredClone(locator), created: true});
  return {fixture, repository, artifact, approval, storeArchive, recordStagingLocator, recorded: () => recorded};
}

test("approved full ZIP is staged privately with separate provenance, without active publication RPC", async () => {
  const fixture = await stagedFixture();
  const result = await fixture.repository.stageReviewedCandidate(fixture);
  assert.equal(result.created, true); assert.match(result.candidateSha256, /^[a-f0-9]{64}$/);
  const payload = fixture.recorded()!.p_payload as {prepared: Record<string, unknown>};
  assert.equal("archiveBytes" in payload.prepared, false);
  assert.notEqual(fixture.artifact.prepared.projectHash, fixture.artifact.provenance.originalProjectHash);
});

test("bundle-only approval cannot authorize full historical ZIP upload", async () => {
  const fixture = await stagedFixture(); let uploaded = false;
  await assert.rejects(fixture.repository.stageReviewedCandidate({...fixture,
    approval: {...fixture.approval, reviewedProjectHash: fixture.artifact.prepared.bundle.sha256},
    storeArchive: async input => {uploaded = true; return fixture.storeArchive(input);}}), /CANDIDATE_INVALID/);
  assert.equal(uploaded, false); assert.equal(fixture.recorded(), undefined);
});

test("fresh historical commit reauthorizes exact candidate then sends one inactive transaction", async () => {
  const fixture = await stagedFixture(); const staged = await fixture.repository.stageReviewedCandidate(fixture);
  const intent = {...command, request: {candidateId: staged.candidateId, candidateSha256: staged.candidateSha256}};
  const candidate = fixture.recorded()!.p_payload;
  const base = fixture.fixture.input.supabase as unknown as {rpc(name: string, args: Record<string, unknown>): unknown};
  const calls: string[] = [];
  const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === "read_html_historical_publication_operation") return {abortSignal: async () => ({data: {status: "NOT_FOUND"}, error: null})};
    if (name === "read_html_historical_candidate") return {abortSignal: async () => ({data: candidate, error: null})};
    if (name === "commit_html_historical_publication") {
      const registration = args.p_registration as {manifest: Record<string, unknown>};
      assert.deepEqual(registration.manifest.historical_html_republication, fixture.artifact.provenance);
      return {abortSignal: async () => ({data: {...receipt, ...intent, requestSha256: args.p_request_sha256,
        originalProjectHash: fixture.artifact.provenance.originalProjectHash, projectHash: fixture.artifact.prepared.projectHash}, error: null})};
    }
    return base.rpc(name, args);
  }} as never);
  const result = await repository.commit(intent);
  assert.equal(result.activated, false); assert.equal(result.draftChanged, false);
  assert.equal(calls.filter(name => name === "commit_html_historical_publication").length, 1);
  assert.equal(calls.includes("commit_html_editing_snapshot"), false);
});

test("authorized candidate projection compiles current authority and rechecks privately without exposing source", async () => {
  const fixture = await stagedFixture(); const staged = await fixture.repository.stageReviewedCandidate(fixture);
  const candidate = fixture.recorded()!.p_payload; const calls: string[] = [];
  const base = fixture.fixture.input.supabase as unknown as {rpc(name: string, args: Record<string, unknown>): unknown};
  const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === "read_html_historical_candidate") return {abortSignal: async () => ({data: structuredClone(candidate), error: null})};
    return base.rpc(name, args);
  }} as never);
  const view = await repository.readCandidate({actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid,
    request: {candidateId: staged.candidateId, candidateSha256: staged.candidateSha256}});
  assert.equal(view.projectHash, fixture.artifact.prepared.projectHash);
  assert.equal(view.approval.reviewedProjectHash, view.projectHash);
  assert.equal(calls.filter(name => name === "read_html_historical_candidate").length, 2);
  assert.equal(calls.some(name => name.startsWith("commit_") || name.startsWith("record_")), false);
  assert.doesNotMatch(JSON.stringify(view), /sourceHtml|encodedBundle|storagePath|signedUrl|archiveBytes|grantedAssetIds/);
});

test("candidate read rejects swapped digest and authorization revoked during final recheck", async () => {
  for (const swapped of [true, false]) {
    const fixture = await stagedFixture(); const staged = await fixture.repository.stageReviewedCandidate(fixture);
    const candidate = fixture.recorded()!.p_payload; let reads = 0;
    const base = fixture.fixture.input.supabase as unknown as {rpc(name: string, args: Record<string, unknown>): unknown};
    const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string, args: Record<string, unknown>) => {
      if (name === "read_html_historical_candidate") return {abortSignal: async () => {
        reads++; return {data: candidate, error: reads > 1 ? {message: "PRIVATE_REVOKED"} : null};
      }};
      return base.rpc(name, args);
    }} as never);
    await assert.rejects(repository.readCandidate({actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid,
      request: {candidateId: staged.candidateId, candidateSha256: swapped ? "e".repeat(64) : staged.candidateSha256}}));
    assert.equal(reads, swapped ? 1 : 2);
  }
});

test("Storage mutation or wrong ACK prevents candidate registration", async () => {
  for (const mutate of [true, false]) {
    const fixture = await stagedFixture();
    await assert.rejects(fixture.repository.stageReviewedCandidate({...fixture, storeArchive: async input => {
      if (mutate) input.bytes[0] = input.bytes[0]! ^ 1;
      return {...await fixture.storeArchive(input), ...(mutate ? {} : {storagePath: "foreign.zip"})};
    }}), /STORAGE_ACK_INVALID/);
    assert.equal(fixture.recorded(), undefined);
  }
});

test("caller mutation during upload cannot replace the approved artifact", async () => {
  const fixture = await stagedFixture(); const hash = fixture.artifact.prepared.projectHash;
  await fixture.repository.stageReviewedCandidate({...fixture, storeArchive: async input => {
    fixture.artifact.prepared.archiveBytes.fill(0); fixture.artifact.prepared.projectHash = "e".repeat(64);
    return fixture.storeArchive(input);
  }});
  const payload = fixture.recorded()!.p_payload as {prepared: {projectHash: string}};
  assert.equal(payload.prepared.projectHash, hash);
});

test("staging persists exact locator before upload and refuses failed, substituted or cancelled journal ACK", async () => {
  for (const mode of ["fail", "substitute", "cancel"] as const) {
    const fixture = await stagedFixture(); let uploads = 0;
    const controller = new AbortController();
    await assert.rejects(fixture.repository.stageReviewedCandidate({...fixture, signal: controller.signal,
      recordStagingLocator: async locator => {
        assert.equal(uploads, 0);
        if (mode === "fail") throw new Error("operator journal failed");
        if (mode === "cancel") controller.abort();
        return {locator: mode === "substitute" ? {...locator, projectHash: "a".repeat(64)} : locator, created: true};
      }, storeArchive: async input => {uploads++; return fixture.storeArchive(input);}}));
    assert.equal(uploads, 0); assert.equal(fixture.recorded(), undefined);
  }
});

test("uncertain record leaves durable locator recoverable without another upload", async () => {
  const fixture = await stagedFixture(); let saved: HtmlHistoricalStagingLocator | undefined;
  let payload: unknown; const calls: string[] = [];
  const base = fixture.fixture.input.supabase as unknown as {rpc(name: string, args: Record<string, unknown>): unknown};
  const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string, args: Record<string, unknown>) => {
    calls.push(name);
    if (name === "record_html_historical_candidate") return {abortSignal: async () => {
      payload = args.p_payload; throw new Error("ACK lost after commit");
    }};
    if (name === "read_html_historical_staging") return {abortSignal: async () => ({data: {
      status: "RECORDED", locator: saved, revoked: true, scope: "HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY",
    }, error: null})};
    return base.rpc(name, args);
  }} as never);
  let uploads = 0;
  await assert.rejects(repository.stageReviewedCandidate({...fixture,
    recordStagingLocator: async locator => {saved = structuredClone(locator); return {locator: structuredClone(saved), created: true};},
    storeArchive: async input => {uploads++; return fixture.storeArchive(input);}}), /OPERATION_UNCONFIRMED/);
  assert.ok(saved); assert.ok(payload);
  const before = calls.length;
  const result = await repository.readStaging(saved);
  assert.equal(result.status, "RECORDED");
  if (result.status === "RECORDED") assert.equal(result.revoked, true);
  assert.deepEqual(calls.slice(before), ["read_html_historical_staging"]); assert.equal(uploads, 1);
});

test("default staging adapter records a durable service-only locator before upload", async () => {
  const fixture = await stagedFixture();
  const result = await fixture.repository.stageReviewedCandidate({...fixture, recordStagingLocator: undefined});
  assert.equal(result.locator.candidateSha256, result.candidateSha256);
  assert.equal(result.locator.projectHash, fixture.artifact.prepared.projectHash);
});

test("previously claimed staging locator blocks another upload, even with the same approved bytes", async () => {
  const fixture = await stagedFixture(); let uploads = 0;
  await assert.rejects(fixture.repository.stageReviewedCandidate({...fixture,
    recordStagingLocator: async locator => ({locator, created: false}),
    storeArchive: async input => {uploads++; return fixture.storeArchive(input);}}), /STAGING_ALREADY_ATTEMPTED_USE_RECOVERY/);
  assert.equal(uploads, 0); assert.equal(fixture.recorded(), undefined);
});

test("durable locator adapter validates owner correlation and strips no unknown payload fields", async () => {
  const fixture = await stagedFixture(); const result = await fixture.repository.stageReviewedCandidate(fixture);
  for (const mode of ["wrong", "extra"] as const) {
    let calls = 0;
    const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string, args: Record<string, unknown>) => {
      calls++; assert.equal(name, "record_html_historical_staging_locator");
      assert.equal(args.p_actor, uuid);
      return {abortSignal: async () => ({data: {locator: mode === "wrong" ? {...result.locator, reviewerId: other}
        : {...result.locator, sourceHtml: "forbidden"}, created: true}, error: null})};
    }} as never);
    await assert.rejects(repository.recordStagingLocator(result.locator)); assert.equal(calls, 1);
  }
});

test("staging recovery NOT_FOUND and substituted metadata never perform writes", async () => {
  const fixture = await stagedFixture(); const staged = await fixture.repository.stageReviewedCandidate(fixture);
  for (const substitute of [false, true]) {
    const calls: string[] = [];
    const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string) => {
      calls.push(name); return {abortSignal: async () => ({data: substitute ? {status: "RECORDED",
        locator: {...staged.locator, reviewerId: other}, revoked: false,
        scope: "HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY"} : {status: "NOT_FOUND"}, error: null})};
    }} as never);
    if (substitute) await assert.rejects(repository.readStaging(staged.locator), /LOCATOR_ACK_INVALID/);
    else assert.deepEqual(await repository.readStaging(staged.locator), {status: "NOT_FOUND"});
    assert.deepEqual(calls, ["read_html_historical_staging"]);
  }
});

test("locator-only recovery confirms journal but does not claim upload, approval or permission to retry", async () => {
  const fixture = await stagedFixture(); const staged = await fixture.repository.stageReviewedCandidate(fixture);
  for (const substitute of [false, true]) {
    const repository = new HistoricalHtmlPublicationRepository({rpc: (name: string) => {
      assert.equal(name, "read_html_historical_staging");
      return {abortSignal: async () => ({data: {status: "LOCATOR_RECORDED_STAGING_UNCONFIRMED",
        locator: {...staged.locator, ...(substitute ? {projectHash: "a".repeat(64)} : {})},
        scope: "HISTORICAL_STAGING_METADATA_NOT_COMMIT_AUTHORITY"}, error: null})};
    }} as never);
    if (substitute) await assert.rejects(repository.readStaging(staged.locator), /LOCATOR_ACK_INVALID/);
    else assert.equal((await repository.readStaging(staged.locator)).status, "LOCATOR_RECORDED_STAGING_UNCONFIRMED");
  }
});

test("staging recovery SQL is service-only, owner/digest bound, metadata-only and retains revocation", async () => {
  const sql = await readFile("../../supabase/migrations/20261009140000_read_html_historical_staging.sql", "utf8");
  const reader = sql.split("CREATE FUNCTION public.read_html_historical_staging")[1]!.split("END $$;")[0]!;
  assert.doesNotMatch(reader, /INSERT INTO|UPDATE .* SET|read_html_editing_compilation|validate_html_historical_candidate/);
  assert.match(sql, /composition_html_historical_staging_locators ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ON CONFLICT \(organization_id,candidate_id\) DO NOTHING/);
  assert.match(sql, /GET DIAGNOSTICS inserted = ROW_COUNT/);
  assert.match(sql, /BEFORE INSERT ON private.composition_html_historical_candidates/);
  assert.match(sql, /HTML_HISTORICAL_STAGING_CLAIM_REQUIRED/);
  assert.match(sql, /assert_html_historical_scope/); assert.match(sql, /stored.reviewer_id IS DISTINCT FROM p_actor/);
  assert.match(sql, /'revoked',stored.revoked/); assert.match(sql, /FROM PUBLIC,anon,authenticated/);
  assert.match(sql, /TO service_role/); assert.match(sql, /candidateSha256.*IS DISTINCT FROM p_candidate_sha256/);
});

test("normal active publisher refuses historical provenance before any external port", async () => {
  const fixture = await stagedFixture();
  await assert.rejects(publishCompositionHtmlEditingSnapshot({...fixture.fixture.input,
    historicalRepublication: fixture.artifact.provenance} as never), /REQUIRES_INACTIVE_WORKFLOW/);
});

test("prepared SQL keeps core state immutable and recovery independent of source recompilation", async () => {
  const sql = await readFile("../../supabase/migrations/20261009130000_html_historical_publication.sql", "utf8");
  assert.doesNotMatch(sql, /UPDATE\s+(?:public\.)?(?:video_compositions|video_composition_drafts|video_composition_draft_documents)\s+SET/i);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql, /INSERT INTO public\.video_composition_revisions/);
  assert.match(sql, /INSERT INTO private\.composition_html_historical_operations/);
  assert.match(sql, /FOR UPDATE NOWAIT/); assert.match(sql, /'activated',false,'draftChanged',false/);
  assert.match(sql, /UNIQUE \(organization_id,candidate_id\)/);
  assert.match(sql, /HTML_HISTORICAL_CANDIDATE_ALREADY_REGISTERED/);
  const recovery = sql.split("CREATE FUNCTION public.read_html_historical_publication_operation")[1]!.split("END $$;")[0]!;
  assert.doesNotMatch(recovery, /read_html_editing_compilation|INSERT INTO|UPDATE .* SET/);
  assert.match(recovery, /stored.actor_id IS DISTINCT FROM p_actor/);
});
