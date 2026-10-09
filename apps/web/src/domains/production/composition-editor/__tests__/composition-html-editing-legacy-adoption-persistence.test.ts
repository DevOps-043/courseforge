import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { prepareLegacyHtmlEditingPilot } from "../html-editing/html-editing-legacy-instrumentation.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { prepareHtmlEditingLegacyAdoption } from "../composition-html-editing-legacy-adoption.server";
import { SupabaseHtmlLegacyAdoptionRepository } from "../composition-html-editing-legacy-adoption-repository.server";
import { htmlLegacyAdoptionCandidateSchema, htmlLegacyAdoptionReceiptSchema,
  type HtmlLegacyAdoptionCandidate, type HtmlLegacyAdoptionReceipt } from "../composition-html-editing-legacy-adoption.contract";
import { computeHtmlLegacyAdoptionRequestSha256 } from "../composition-html-editing-legacy-adoption-digest.server";

function fixture() {
  const native = createHtmlEditingRevisionFixture(), binding = native.authority.authoritativeBinding;
  const anchor = { organizationId: uuid, documentId: uuid, clipId: binding.clipId, revisionId: other };
  const pilot = prepareLegacyHtmlEditingPilot({ sourceHtml: native.current.revision.sourceHtml,
    authoritativeAnchor: { ...anchor, documentSha256: binding.documentSha256 }, templateId: "legacy_intro", templateVersion: 1,
    grantedAssetIds: native.authority.grantedAssetIds, imageSources: native.authority.imageSources });
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({ format: "courseforge-html-editable-catalog-v1",
    organizationId: uuid, templates: [pilot.candidate.template] }));
  const candidate: HtmlLegacyAdoptionCandidate = { ...anchor, candidateId: other, expectedDocumentHash: binding.documentSha256,
    originalSourceSha256: pilot.original.sha256, candidateSourceSha256: pilot.candidate.sha256, provenanceSha256: pilot.provenanceSha256,
    templateId: "legacy_intro", templateVersion: 1, encodedPilot: JSON.stringify(pilot),
    approval: { reviewerId: uuid, evidenceSha256: "d".repeat(64), completedReviews: [...pilot.requiredReviews] } };
  const command = { organizationId: uuid, documentId: uuid, clipId: binding.clipId, actorId: uuid, operationId: other,
    request: { candidateId: other, provenanceSha256: pilot.provenanceSha256, expectedDocumentHash: binding.documentSha256 } };
  const prepared = prepareHtmlEditingLegacyAdoption({ document: native.document, expectedDocumentHash: binding.documentSha256,
    anchor, templateId: candidate.templateId, templateVersion: candidate.templateVersion, encodedPilot: candidate.encodedPilot,
    expectedProvenanceSha256: pilot.provenanceSha256, catalog, grantedAssetIds: native.authority.grantedAssetIds, imageSources: native.authority.imageSources });
  const receipt: HtmlLegacyAdoptionReceipt = { scope: "HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
    owner: { actorId: uuid, organizationId: uuid, draftId: uuid }, clipId: binding.clipId,
    operationId: other, requestSha256: computeHtmlLegacyAdoptionRequestSha256(command), request: command.request,
    acknowledgment: { status: "CONFIRMED", compositionDocumentHash: prepared.documentHash,
      compositionDocumentVersion: 2, revisionVersion: 1, revisionSha256: prepared.initialRevisionSha256 } };
  const context = { ...anchor, documentHash: binding.documentSha256, document: native.document,
    grantedAssetIds: [...native.authority.grantedAssetIds] };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const state = { candidate: candidate as unknown, context: context as unknown, receipt: receipt as unknown,
    read: { status: "NOT_FOUND" } as unknown, failName: "", failMessage: "PRIVATE_SECRET_SOURCE", stage: true as unknown };
  const client = { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({ name, args });
    const data = name === "read_html_editing_legacy_adoption_operation" ? state.read
      : name === "read_html_editing_legacy_candidate" ? state.candidate
        : name === "read_html_editing_bootstrap_context" ? state.context
          : name === "record_html_editing_legacy_candidate" ? state.stage : state.receipt;
    return { data, error: state.failName === name ? { message: state.failMessage } : null };
  } }) } as unknown as SupabaseClient;
  return { native, candidate, context, command, prepared, receipt, state, calls,
    repository: new SupabaseHtmlLegacyAdoptionRepository(client, catalog) };
}

test("adoption command digest binds full ownership, clip, operation, candidate and CAS", () => {
  const f = fixture(), command = f.command;
  const expected = createHash("sha256").update(JSON.stringify(["courseforge-html-legacy-adoption-command-v1",
    uuid, uuid, command.clipId, uuid, other, other, command.request.provenanceSha256, command.request.expectedDocumentHash])).digest("hex");
  assert.equal(computeHtmlLegacyAdoptionRequestSha256(command), expected);
  for (const key of ["organizationId", "documentId", "actorId", "operationId"] as const)
    assert.notEqual(computeHtmlLegacyAdoptionRequestSha256({ ...command, [key]: key === "operationId" ? uuid : other }), expected);
  assert.notEqual(computeHtmlLegacyAdoptionRequestSha256({ ...command, clipId: "another" }), expected);
  for (const [key, value] of [["candidateId", uuid], ["provenanceSha256", "e".repeat(64)], ["expectedDocumentHash", "e".repeat(64)]] as const)
    assert.notEqual(computeHtmlLegacyAdoptionRequestSha256({ ...command, request: { ...command.request, [key]: value } }), expected);
  assert.throws(() => computeHtmlLegacyAdoptionRequestSha256({ ...command, sourceHtml: "untrusted" }));
});

test("one adoption RPC receives independently regenerated native, revision and resource dependencies", async () => {
  const f = fixture(), before = JSON.stringify(f.native.document);
  assert.deepEqual(await f.repository.commit(f.command), f.receipt);
  assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_legacy_adoption_operation", "read_html_editing_legacy_candidate",
    "read_html_editing_bootstrap_context", "commit_html_editing_legacy_adoption"]);
  const args = f.calls.at(-1)!.args;
  assert.deepEqual(args.p_document, f.prepared.document); assert.deepEqual(args.p_revision, f.prepared.initialRevision);
  assert.equal(args.p_document_hash, f.prepared.documentHash); assert.equal(args.p_revision_sha256, f.prepared.initialRevisionSha256);
  assert.deepEqual(args.p_used_asset_ids, [uuid]); assert.equal(args.p_request_sha256, f.receipt.requestSha256);
  assert.equal((args.p_revision as typeof f.prepared.initialRevision).manifest.binding.documentSha256, f.command.request.expectedDocumentHash);
  assert.notEqual(args.p_document_hash, f.command.request.expectedDocumentHash);
  assert.equal(JSON.stringify(f.native.document), before);
});

test("historical replay returns receipt without current preparation, compilation or another write", async () => {
  const f = fixture(); f.state.read = { status: "RECORDED", receipt: f.receipt }; f.state.context = null; f.state.candidate = null;
  assert.deepEqual(await f.repository.commit(f.command), f.receipt);
  assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_legacy_adoption_operation"]);
  f.calls.length = 0;
  assert.deepEqual(await f.repository.readOperation(f.command), f.state.read);
  assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_legacy_adoption_operation"]);
});

test("candidate substitutions and absent human review never reach commit", async () => {
  for (const key of ["organizationId", "documentId", "clipId", "candidateId", "provenanceSha256", "expectedDocumentHash",
    "originalSourceSha256", "candidateSourceSha256", "revisionId", "encodedPilot", "approval"] as const) {
    const f = fixture();
    f.state.candidate = { ...f.candidate, [key]: key === "clipId" ? "another" : key === "approval" ? undefined
      : key.endsWith("Sha256") || key === "expectedDocumentHash" ? "e".repeat(64)
        : key === "encodedPilot" ? "{}" : uuid === f.candidate[key] ? other : uuid };
    await assert.rejects(f.repository.commit(f.command));
    assert.equal(f.calls.some(call => call.name === "commit_html_editing_legacy_adoption"), false);
  }
});

test("stale, foreign, replaced native context and revoked grants stop adoption before a write", async () => {
  for (const key of ["organizationId", "documentId", "clipId", "revisionId", "documentHash", "document", "grantedAssetIds"] as const) {
    const f = fixture(); f.state.context = { ...f.context,
      [key]: key === "clipId" ? "another" : key === "documentHash" ? "e".repeat(64)
        : key === "document" ? { ...f.native.document, canvas: { ...f.native.document.canvas, width: 100 } }
          : key === "grantedAssetIds" ? [] : f.context[key] === uuid ? other : uuid };
    await assert.rejects(f.repository.commit(f.command));
    assert.equal(f.calls.some(call => call.name === "commit_html_editing_legacy_adoption"), false);
  }
});

test("staging requires explicit complete human approval and verifies native/catalogue before recording", async () => {
  const f = fixture(); assert.deepEqual(await f.repository.stageReviewedCandidate(f.candidate), {
    recorded: true, created: true, candidateId: other, provenanceSha256: f.candidate.provenanceSha256,
  });
  assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_bootstrap_context", "record_html_editing_legacy_candidate"]);
  f.state.stage = false; assert.equal((await f.repository.stageReviewedCandidate(f.candidate)).created, false);
  for (const approval of [{ ...f.candidate.approval, completedReviews: [] },
    { ...f.candidate.approval, evidenceSha256: "" }, { ...f.candidate.approval, completedReviews: ["QA_PASS"] }]) {
    assert.equal(htmlLegacyAdoptionCandidateSchema.safeParse({ ...f.candidate, approval }).success, false);
  }
  const wrong = fixture(); wrong.candidate.originalSourceSha256 = "e".repeat(64);
  await assert.rejects(wrong.repository.stageReviewedCandidate(wrong.candidate));
  assert.equal(wrong.calls.some(call => call.name === "record_html_editing_legacy_candidate"), false);
});

test("unconfirmed or contradictory adoption ACK never retries, registers separately or compensates", async () => {
  for (const key of ["failure", "owner", "operation", "request", "digest", "native", "revision", "oversized"] as const) {
    const f = fixture();
    if (key === "failure") f.state.failName = "commit_html_editing_legacy_adoption";
    else if (key === "oversized") f.state.receipt = { ...f.receipt, secret: "s".repeat(5000) };
    else f.state.receipt = { ...f.receipt,
      ...(key === "owner" ? { owner: { ...f.receipt.owner, actorId: other } } :
        key === "operation" ? { operationId: uuid } : key === "request" ? { request: { ...f.receipt.request, candidateId: uuid } } :
          key === "digest" ? { requestSha256: "e".repeat(64) } :
            { acknowledgment: { ...f.receipt.acknowledgment, [key === "native" ? "compositionDocumentHash" : "revisionSha256"]: "e".repeat(64) } }),
    };
    await assert.rejects(f.repository.commit(f.command), error => String(error) === "HtmlLegacyAdoptionPersistenceError: HTML_LEGACY_ADOPTION_COMMIT_UNCONFIRMED");
    assert.equal(f.calls.filter(call => call.name.startsWith("commit_")).length, 1);
    assert.equal(f.calls.some(call => call.name.startsWith("register_") || call.name.startsWith("append_")), false);
  }
});

test("receipt recovery validates identity and historical scope without trusting source/current claims", async () => {
  const f = fixture(); assert.equal(htmlLegacyAdoptionReceiptSchema.safeParse(f.receipt).success, true);
  for (const receipt of [{ ...f.receipt, scope: "CURRENT" }, { ...f.receipt, sourceHtml: "SECRET" },
    { ...f.receipt, owner: { ...f.receipt.owner, organizationId: other } },
    { ...f.receipt, requestSha256: "e".repeat(64) },
    { ...f.receipt, acknowledgment: { ...f.receipt.acknowledgment, compositionDocumentHash: f.command.request.expectedDocumentHash } }]) {
    f.state.read = { status: "RECORDED", receipt }; f.calls.length = 0;
    await assert.rejects(f.repository.readOperation(f.command));
    assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_legacy_adoption_operation"]);
  }
});

test("abort and deterministic SQL conflicts remain bounded and do not disclose provider details", async () => {
  const f = fixture(), abort = new AbortController(); abort.abort();
  await assert.rejects(f.repository.commit(f.command, abort.signal), /READ_UNAVAILABLE/); assert.equal(f.calls.length, 0);
  for (const message of ["HTML_LEGACY_ADOPTION_CONFLICT", "HTML_LEGACY_ADOPTION_ID_REUSED"]) {
    const conflict = fixture(); conflict.state.failName = "commit_html_editing_legacy_adoption"; conflict.state.failMessage = message;
    await assert.rejects(conflict.repository.commit(conflict.command), /HTML_LEGACY_ADOPTION_CONFLICT/);
    assert.equal(conflict.calls.filter(call => call.name.startsWith("commit_")).length, 1);
  }
});

test("prepared SQL preserves transaction, root-lock, service-only and original-history boundaries (static, not DB execution)", () => {
  const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261008100000_html_editing_legacy_adoption.sql"), "utf8");
  assert.match(sql, /^-- PREPARED ONLY/); assert.match(sql, /BEGIN;[\s\S]*COMMIT;\s*$/);
  assert.equal((sql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length, 2);
  assert.match(sql, /FROM PUBLIC,anon,authenticated,service_role/); assert.match(sql, /FOR UPDATE NOWAIT/);
  const commit = sql.slice(sql.indexOf("CREATE FUNCTION public.commit_html_editing_legacy_adoption"), sql.indexOf("CREATE FUNCTION public.read_html_editing_legacy_adoption_operation"));
  const append = commit.indexOf("SELECT * INTO append_result FROM public.append_video_composition_draft_document_v2");
  assert.ok(append > commit.indexOf("p_document IS DISTINCT FROM expected_document"));
  assert.ok(commit.indexOf("INSERT INTO private.composition_html_templates") > append);
  assert.ok(commit.indexOf("INSERT INTO private.composition_html_legacy_adoption_receipts") > commit.indexOf("INSERT INTO private.composition_html_revisions"));
  assert.doesNotMatch(sql, /CREATE OR REPLACE|DELETE FROM|UPDATE public\.video_composition_draft_documents/);
  assert.doesNotMatch(commit, /register_html_editing_template/);
  assert.match(sql, /IF NOT FOUND THEN RETURN jsonb_build_object\('status','NOT_FOUND'\)/);
});
