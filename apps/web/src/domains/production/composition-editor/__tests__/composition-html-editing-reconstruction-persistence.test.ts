import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createReconstructionPersistenceFixture } from "./composition-html-editing-reconstruction-persistence-fixtures";
import { readHtmlReconstructionCandidate } from "../composition-html-editing-reconstruction-candidate.server";
import { HtmlReconstructionRepository } from "../composition-html-editing-reconstruction-repository.server";
import { htmlReconstructionCreationReceiptSchema, type HtmlReconstructionStaging } from "../composition-html-editing-reconstruction.contract";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

test("staging preserves identity before any external write, uploads exact approved bytes once and persists independently", async () => {
  const f = await createReconstructionPersistenceFixture(), original = structuredClone(f.artifact), reads = f.source.state.exactReads;
  const staged = await f.repository.stage(f.stageInput);
  assert.equal(staged.created, true); assert.equal(f.state.uploads, 1); assert.equal(f.state.authorityCalls, 2);
  assert.deepEqual(f.state.events, ["authority", "local-journal", "record_html_reconstruction_staging", "upload-readback", "authority", "record_html_reconstruction_candidate"]);
  assert.deepEqual(f.state.stored, f.candidate); assert.deepEqual(structuredClone(f.artifact), original);
  assert.equal(f.source.state.exactReads, reads);
  assert.equal((await f.repository.readStaging(staged.staging, uuid)).status, "RECORDED");
});

test("JSONB key reordering preserves candidate identity but altered content/descriptor/digest is rejected", async () => {
  const f = await createReconstructionPersistenceFixture();
  const reorder = (entry: unknown): unknown => entry === null || typeof entry !== "object" ? entry
    : Array.isArray(entry) ? entry.map(reorder) : Object.fromEntries(Object.entries(entry).reverse().map(([key,value]) => [key,reorder(value)]));
  assert.deepEqual(readHtmlReconstructionCandidate(reorder(f.candidate)), f.candidate);
  for (const mutate of ["digest", "origin", "document", "manifest", "extra"] as const) {
    const changed = structuredClone(f.candidate);
    if (mutate === "digest") changed.candidateSha256 = "b".repeat(64);
    if (mutate === "origin") changed.content.candidate.origin.documentHash = "b".repeat(64);
    if (mutate === "document") changed.content.candidate.document.variables.title = "Different";
    if (mutate === "manifest") changed.registration.manifest.canvas_duration_seconds += 1;
    if (mutate === "extra") Object.assign(changed, {activate: true});
    assert.throws(() => readHtmlReconstructionCandidate(changed));
  }
});

test("lost claim ACK never uploads or retries; recovery only queries the preserved identity", async () => {
  const f = await createReconstructionPersistenceFixture(); let journal: HtmlReconstructionStaging | undefined;
  f.state.failAfter = "claim";
  await assert.rejects(f.repository.stage({...f.stageInput, preserveStaging: async staging => (journal = structuredClone(staging))}), /OPERATION_UNCONFIRMED/);
  assert.equal(f.state.uploads, 0); assert.ok(journal);
  assert.equal((await f.repository.readStaging(journal, uuid)).status, "CLAIM_RECORDED_CANDIDATE_UNCONFIRMED");
  assert.deepEqual(f.state.calls, ["record_html_reconstruction_staging", "read_html_reconstruction_staging"]);
});

test("lost candidate ACK reconciles without a second upload and existing claims cannot resume staging", async () => {
  const f = await createReconstructionPersistenceFixture(); f.state.failAfter = "candidate";
  await assert.rejects(f.repository.stage(f.stageInput), /OPERATION_UNCONFIRMED/);
  assert.ok(f.state.claim); assert.equal((await f.repository.readStaging(f.state.claim, uuid)).status, "RECORDED");
  f.state.failAfter = "";
  await assert.rejects(f.repository.stage(f.stageInput), /ALREADY_ATTEMPTED_USE_RECOVERY/);
  assert.equal(f.state.uploads, 1);
  assert.equal(f.state.calls.filter(name => name === "record_html_reconstruction_candidate").length, 1);
});

test("journal failure, invalid readback and mutated upload bytes fail without candidate registration", async () => {
  for (const failure of ["journal", "readback", "bytes"] as const) {
    const f = await createReconstructionPersistenceFixture();
    if (failure === "journal") await assert.rejects(f.repository.stage({...f.stageInput,
      preserveStaging: async () => {throw new Error("private path and secret");}}), /^Error: HTML_RECONSTRUCTION_JOURNAL_UNCONFIRMED$/);
    else await assert.rejects(f.repository.stage({...f.stageInput, storeArchive: async input => {
      if (failure === "bytes") input.bytes.fill(0);
      return {...f.candidate.registration.archive, ...(failure === "readback" ? {sizeBytes: 1} : {})};
    }}));
    assert.equal(f.state.stored, undefined);
    assert.equal(f.state.calls.includes("record_html_reconstruction_candidate"), false);
    if (failure === "journal") assert.deepEqual(f.state.calls, []);
  }
});

test("creation uses the durable candidate and returns an inactive isolated identity, never the original scope", async () => {
  const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
  const original = structuredClone(f.artifact), exactReads = f.source.state.exactReads, fetches = f.source.state.fetches;
  const receipt = await f.repository.create(staged.staging, uuid);
  assert.equal(receipt.activated, false); assert.equal(receipt.originalDraftChanged, false); assert.equal(receipt.materialComponentId, null);
  assert.equal(receipt.staging.review.locator.targetCompositionId, other); assert.equal(receipt.nativeVersion, 1);
  assert.deepEqual(f.state.calls.slice(-3), ["read_html_reconstruction_creation", "read_html_reconstruction_candidate", "create_html_reconstruction"]);
  assert.deepEqual(structuredClone(f.artifact), original); assert.equal(f.source.state.exactReads, exactReads);
  assert.equal(f.source.state.fetches, fetches); assert.equal(f.state.uploads, 1);
});

test("lost creation ACK is recovered by receipt and replay performs no second create/resource/compiler work", async () => {
  const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
  f.state.failAfter = "create";
  await assert.rejects(f.repository.create(staged.staging, uuid), /^Error: HTML_RECONSTRUCTION_OPERATION_UNCONFIRMED$/);
  f.state.withdrawn = true; f.source.state.revokeImages = true;
  const reads = f.source.state.archiveReads, queries = f.source.state.queries.length, authorities = f.state.authorityCalls;
  const recovered = await f.repository.readCreation(staged.staging, uuid);
  assert.equal(recovered.status, "RECORDED");
  const replayed = await f.repository.create(staged.staging, uuid); assert.deepEqual(replayed, f.state.receipt);
  assert.equal(f.state.calls.filter(name => name === "create_html_reconstruction").length, 1);
  assert.equal(f.state.authorityCalls, authorities); assert.equal(f.source.state.archiveReads, reads);
  assert.equal(f.source.state.queries.length, queries);
});

test("current image/catalog/origin authority drift blocks creation before its write", async () => {
  for (const failure of ["image", "catalog", "origin"] as const) {
    const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
    if (failure === "image") f.source.state.unlinkedProductionIds.add(f.source.original.image.id);
    if (failure === "catalog") f.reconstruction.catalog = new HtmlEditingTemplateCatalog(JSON.stringify({
      format: "courseforge-html-editable-catalog-v1", organizationId: uuid, templates: []}));
    if (failure === "origin") f.source.identity.projectHash = "b".repeat(64);
    await assert.rejects(f.repository.create(staged.staging, uuid), /CURRENT_AUTHORITY_UNAVAILABLE/);
    assert.equal(f.state.calls.includes("create_html_reconstruction"), false);
  }
});

test("current uploaded-font authority is rechecked without downloading/recompiling approved content", async () => {
  const f = await createReconstructionPersistenceFixture(true), staged = await f.repository.stage(f.stageInput);
  const fetches = f.source.state.fontFetches, exact = f.source.state.exactReads;
  assert.ok(fetches > 0); f.source.state.revokeFont = true;
  await assert.rejects(f.repository.create(staged.staging, uuid), /CURRENT_AUTHORITY_UNAVAILABLE/);
  assert.equal(f.state.calls.includes("create_html_reconstruction"), false);
  assert.equal(f.source.state.fontFetches, fetches); assert.equal(f.source.state.exactReads, exact);
});

test("withdrawal between host preflight and SQL creation is rejected, without compensating writes", async () => {
  const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
  f.state.before = name => {if (name === "create_html_reconstruction") f.state.withdrawn = true;};
  await assert.rejects(f.repository.create(staged.staging, uuid), /OPERATION_UNCONFIRMED/);
  assert.equal(f.state.receipt, undefined); assert.equal(f.state.uploads, 1);
  assert.equal(f.state.calls.filter(name => name === "create_html_reconstruction").length, 1);
});

test("wrong reviewer, substituted candidate and malformed/activating receipts cannot authorize a create", async () => {
  const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
  await assert.rejects(f.repository.create(staged.staging, other), /FORBIDDEN/);
  f.state.stored!.candidateSha256 = "b".repeat(64);
  await assert.rejects(f.repository.create(staged.staging, uuid));
  assert.equal(f.state.calls.includes("create_html_reconstruction"), false);
  const receipt = {scope: "RECONSTRUCTION_CREATION_RECEIPT_NOT_PUBLICATION_OR_CURRENT_STATE", staging: staged.staging,
    documentHash: f.candidate.content.candidate.documentHash, nativeVersion: 1, activated: false, originalDraftChanged: false, materialComponentId: null};
  for (const patch of [{activated: true}, {originalDraftChanged: true}, {materialComponentId: uuid}, {nativeVersion: 2}, {scope: "PUBLISHED"}])
    assert.equal(htmlReconstructionCreationReceiptSchema.safeParse({...receipt, ...patch}).success, false);
});

test("cancelled recovery contacts no database and NOT_FOUND does not trigger upload/create", async () => {
  const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
  const controller = new AbortController(); controller.abort(); const calls = f.state.calls.length;
  await assert.rejects(f.repository.readCreation(staged.staging, uuid, controller.signal), error => (error as Error).name === "AbortError");
  assert.equal(f.state.calls.length, calls);
  assert.deepEqual(await f.repository.readCreation(staged.staging, uuid), {status: "NOT_FOUND"});
  assert.equal(f.state.calls.includes("create_html_reconstruction"), false);
});

test("failed creation-intent preservation prevents a remote create and is not retried automatically", async () => {
  const f = await createReconstructionPersistenceFixture(), staged = await f.repository.stage(f.stageInput);
  const repository = new HtmlReconstructionRepository(f.supabase, f.verify,
    async () => {throw new Error("private filesystem details");});
  await assert.rejects(repository.create(staged.staging, uuid), /^Error: HTML_RECONSTRUCTION_JOURNAL_UNCONFIRMED$/);
  assert.equal(f.state.calls.includes("create_html_reconstruction"), false);
  assert.equal(f.state.receipt, undefined);
});

test("concurrent staging is refused without a queue and the admission slot is released on failure", async () => {
  const f = await createReconstructionPersistenceFixture();
  let release: (() => void) | undefined;
  const repository = new HtmlReconstructionRepository(f.supabase,
    async () => new Promise<void>(resolve => {release = resolve;}), f.preserveCreationIntent);
  const pending = repository.stage({...f.stageInput, preserveStaging: async () => {throw new Error("stop before remote writes");}});
  await assert.rejects(f.repository.stage(f.stageInput), /STAGING_BUSY/);
  // Fake handoff load has one await before reaching the authority port.
  for (let count = 0; count < 10 && !release; count++) await Promise.resolve();
  assert.ok(release); release(); await assert.rejects(pending, /JOURNAL_UNCONFIRMED/);
  assert.equal((await f.repository.stage(f.stageInput)).created, true);
});

test("authority ports cannot mutate the candidate that is persisted or leak provider details", async () => {
  const f = await createReconstructionPersistenceFixture();
  const repository = new HtmlReconstructionRepository(f.supabase, async candidate => {candidate.content.candidate.document.variables.title = "MUTATED";}, f.preserveCreationIntent);
  await repository.stage(f.stageInput); assert.deepEqual(f.state.stored, f.candidate);
  const broken = new HtmlReconstructionRepository(f.supabase, async () => {throw new Error("private backend details");}, f.preserveCreationIntent);
  await assert.rejects(broken.stage(f.stageInput), /^Error: HTML_RECONSTRUCTION_CURRENT_AUTHORITY_UNAVAILABLE$/);
});

test("contextual CSS SQL upgrade changes only admission shape and preserves every authority/review/resource check", async () => {
  const original = await readFile("../../supabase/migrations/20261010100000_html_reconstruction_candidates.sql", "utf8");
  const upgrade = await readFile("../../supabase/migrations/20261010130000_html_reconstruction_contextual_css.sql", "utf8");
  const functionBody = (sql: string) => {
    const normalized = sql.replace("CREATE OR REPLACE FUNCTION private.validate_html_reconstruction_candidate(",
      "CREATE FUNCTION private.validate_html_reconstruction_candidate(");
    const start = normalized.indexOf("CREATE FUNCTION private.validate_html_reconstruction_candidate(");
    const end = normalized.indexOf("$$;", start);
    assert.ok(start >= 0 && end > start);
    return normalized.slice(start, end + 3).replace(/\r\n/g, "\n");
  };
  const originalGuard = "OR document->'deckStyles' IS DISTINCT FROM 'null'::jsonb";
  const contextualGuard = `OR (document->'deckStyles' IS DISTINCT FROM 'null'::jsonb AND (
      jsonb_typeof(document->'deckStyles') IS DISTINCT FROM 'object'
      OR jsonb_typeof(document#>'{deckStyles,css}') IS DISTINCT FROM 'string'
      OR octet_length(document#>>'{deckStyles,css}') > 256000
      OR document#>'{deckStyles,fontUrls}' IS DISTINCT FROM '[]'::jsonb))`;
  assert.ok(functionBody(original).includes(originalGuard));
  assert.equal(functionBody(upgrade), functionBody(original).replace(originalGuard, contextualGuard));
  assert.match(upgrade, /FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(upgrade, /BEGIN;/); assert.match(upgrade, /COMMIT;/);
  assert.doesNotMatch(upgrade.replace(/^[\t ]*--.*$/gm, ""), /UPDATE public\.|DELETE FROM|DROP |GRANT /i);
});

test("prepared SQL creates content only under new IDs with no original UPDATE/UPSERT/activation", async () => {
  const candidates = await readFile("../../supabase/migrations/20261010100000_html_reconstruction_candidates.sql", "utf8");
  const creation = await readFile("../../supabase/migrations/20261010110000_create_html_reconstruction.sql", "utf8");
  assert.match(candidates, /private\.html_snapshot_resource_bindings\(/);
  assert.match(candidates, /private\.html_editing_grants\(/);
  assert.match(candidates, /review\.revoked/);
  assert.match(candidates, /HTML_RECONSTRUCTION_TARGET_EXISTS/);
  assert.match(creation, /FOR UPDATE NOWAIT/);
  assert.match(creation, /private\.validate_html_reconstruction_candidate\(/);
  assert.match(creation, /source_composition\.artifact_id,NULL,'Reconstrucción HTML','DRAFT',NULL,p_actor/);
  assert.match(creation, /VALUES\(new_draft,p_org,1,'courseforge-composition-v4'/);
  assert.match(creation, /INSERT INTO private\.composition_html_reconstruction_creations/);
  assert.doesNotMatch(creation, /manifest := manifest \|\|/);
  assert.doesNotMatch(creation.replace(/^[\t ]*--.*$/gm, ""), /UPDATE public\.|DELETE FROM|ON CONFLICT|append_video_composition|register_html_editing_template\(/i);
  assert.equal(creation.match(/read_html_editing_compilation\(/g)?.length, 1);
  assert.match(creation, /read_html_editing_compilation\(p_org,new_draft,p_actor/);
  assert.doesNotMatch(candidates, /read_html_editing_compilation\(|UPDATE public\.|DELETE FROM/i);
  for (const sql of [candidates, creation]) {
    assert.match(sql, /ENABLE ROW LEVEL SECURITY/); assert.match(sql, /FROM PUBLIC,anon,authenticated,service_role/);
    assert.match(sql, /TO service_role/); assert.match(sql, /SET lock_timeout = '2s'/);
  }
});
