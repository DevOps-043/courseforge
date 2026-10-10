import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import JSZip from "jszip";
import { createHistoricalHtmlCandidatePreparer } from "../composition-html-editing-historical-candidate.server";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

test("full historical preparation acquires saved media/current authority and assembles independent V1/old-profile ZIP without writes", async () => {
  for (const kind of ["v1", "old"] as const) {
    const fixture = await createHistoricalCandidatePreparationFixture(kind), saved = JSON.stringify(fixture.original.compilation);
    const result = await createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input);
    assert.equal(result.scope, "PREPARED_HISTORICAL_ARCHIVE_NOT_APPROVED_UPLOADED_OR_PUBLISHED");
    assert.equal(result.provenance.originalProjectHash, fixture.identity.projectHash);
    assert.notEqual(result.prepared.projectHash, fixture.identity.projectHash);
    assert.equal(createHash("sha256").update(result.prepared.archiveBytes).digest("hex"), result.prepared.projectHash);
    assert.equal(result.prepared.bundle.sha256, result.review.candidateBundleSha256);
    const zip = await JSZip.loadAsync(result.prepared.archiveBytes);
    assert.deepEqual(JSON.parse(await zip.file("historical-html-republication.json")!.async("string")), result.provenance);
    assert.ok(zip.file("index.html")); assert.ok(zip.file("conformance-preview.html"));
    assert.deepEqual(result.prepared.assets.map(asset => asset.productionAssetId), fixture.prepared.assets.map(asset => asset.productionAssetId));
    assert.equal(fixture.state.archiveReads, 4); assert.equal(fixture.state.fetches, 2);
    assert.ok(fixture.state.exactReads >= 7); assert.ok(fixture.state.queries.includes("production_assets"));
    assert.equal(JSON.stringify(fixture.original.compilation), saved);
    assert.doesNotMatch(JSON.stringify(result.prepared), /private-test-key|token=private/);
  }
});

test("full preparation rejects current-profile migration, corrupt archive and untrusted sign origin", async () => {
  for (const failure of ["current", "zip", "origin"] as const) {
    const fixture = await createHistoricalCandidatePreparationFixture(failure === "current" ? "current" : "v1");
    fixture.state.corruptZip = failure === "zip"; fixture.state.redirectSign = failure === "origin";
    await assert.rejects(createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input), /^Error: HTML_HISTORICAL_CANDIDATE_PREPARATION_UNAVAILABLE$/);
  }
});

test("permission/media loss during assembly or final reread discards the whole candidate", async () => {
  for (const failure of ["media", "during-assembly", "final-review"] as const) {
    const fixture = await createHistoricalCandidatePreparationFixture();
    fixture.state.revokeMedia = failure === "media";
    fixture.state.beforeExactRead = count => {if (count === (failure === "during-assembly" ? 4 : failure === "final-review" ? 6 : -1)) fixture.state.revokeImages = true;};
    await assert.rejects(createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input), /PREPARATION_UNAVAILABLE/);
  }
});

test("preparer captures request/runtime/configuration before awaits instead of borrowing operator references", async () => {
  const fixture = await createHistoricalCandidatePreparationFixture();
  const prepare = createHistoricalHtmlCandidatePreparer(fixture.configuration);
  fixture.state.beforeArchiveRead = count => {
    if (count !== 1) return;
    fixture.input.request.actorId = other; fixture.input.candidateId = uuid;
    fixture.input.renderProfile.fps = 30 as never; fixture.input.renderExecution.sdkVersion = "mutated" as never;
    fixture.configuration.supabaseUrl = "https://attacker.example";
  };
  const result = await prepare(fixture.input);
  assert.equal(result.review.actorId, uuid); assert.equal(result.provenance.candidateId, other);
  assert.equal(result.prepared.contract.renderProfile.fps, 25);
  assert.equal(result.prepared.contract.schemaVersion, 4);
  if (result.prepared.contract.schemaVersion === 4) assert.equal(result.prepared.contract.renderExecution!.sdkVersion, "0.7.106");
});

test("module admission rejects a parallel preparer without I/O and releases capacity after cancellation", async () => {
  const fixture = await createHistoricalCandidatePreparationFixture();
  let release!: () => void, reached!: () => void;
  const pending = new Promise<void>(resolve => {release = resolve;}), started = new Promise<void>(resolve => {reached = resolve;});
  fixture.state.beforeArchiveRead = async count => {if (count === 1) {reached(); await pending;}};
  const controller = new AbortController(), prepare = createHistoricalHtmlCandidatePreparer(fixture.configuration);
  const first = prepare({...fixture.input, signal: controller.signal}); await started;
  try {
    const before = fixture.state.archiveReads;
    await assert.rejects(createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input), /PREPARATION_BUSY/);
    assert.equal(fixture.state.archiveReads, before);
  } finally {controller.abort(); release();}
  await assert.rejects(first, error => (error as Error).name === "AbortError");
  fixture.state.beforeArchiveRead = undefined;
  assert.equal((await prepare(fixture.input)).provenance.candidateId, other);
});

test("invalid runtime/identity and already-aborted inputs do no archive I/O and do not leak admission", async () => {
  const fixture = await createHistoricalCandidatePreparationFixture(), prepare = createHistoricalHtmlCandidatePreparer(fixture.configuration);
  for (const input of [{...fixture.input, candidateId: "invalid"}, {...fixture.input, animationRuntimeSha256: "invalid"}])
    await assert.rejects(prepare(input), /PREPARATION_UNAVAILABLE/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(prepare({...fixture.input, signal: controller.signal}));
  assert.equal(fixture.state.archiveReads, 0);
  assert.equal((await prepare(fixture.input)).provenance.candidateId, other);
});

test("full preparation pins downloaded font bytes and rechecks READY authority without a second download", async () => {
  const fixture = await createHistoricalCandidatePreparationFixture("v1", true);
  const result = await createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input);
  assert.equal(fixture.state.fontFetches, 1); assert.equal(fixture.state.fontReads, 2);
  const font = result.prepared.fontManifest[0]!;
  assert.equal(font.checksumSha256, fixture.font.checksum_sha256);
  const zip = await JSZip.loadAsync(result.prepared.archiveBytes);
  assert.deepEqual(await zip.file(`assets/fonts/${font.checksumSha256}.woff2`)!.async("nodebuffer"), fixture.fontBytes);
  assert.doesNotMatch(JSON.stringify(result.prepared.metadata), /private-test-key|Authorization|storage\/v1\/object/);
});

test("font integrity/MIME failures and revocation during preparation discard candidate", async () => {
  for (const failure of ["bytes", "mime", "revoked-after-assembly"] as const) {
    const fixture = await createHistoricalCandidatePreparationFixture("v1", true);
    fixture.state.corruptFont = failure === "bytes"; fixture.state.wrongFontMime = failure === "mime";
    fixture.state.beforeArchiveRead = count => {if (count === 3 && failure === "revoked-after-assembly") fixture.state.revokeFont = true;};
    await assert.rejects(createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input), /PREPARATION_UNAVAILABLE/);
    assert.equal(fixture.state.fontFetches, 1);
    if (failure === "revoked-after-assembly") assert.equal(fixture.state.fontReads, 2);
  }
});

test("non-HTML media unlinked during final historical review cannot escape final resource refresh", async () => {
  const fixture = await createHistoricalCandidatePreparationFixture();
  fixture.state.beforeArchiveRead = count => {if (count === 3) fixture.state.revokeMedia = true;};
  await assert.rejects(createHistoricalHtmlCandidatePreparer(fixture.configuration)(fixture.input), /PREPARATION_UNAVAILABLE/);
  assert.equal(fixture.state.archiveReads, 4);
});
