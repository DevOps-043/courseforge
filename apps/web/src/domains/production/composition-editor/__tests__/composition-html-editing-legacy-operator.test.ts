import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createLegacyOperatorFixture, actor, candidateId, otherActor } from "./composition-html-editing-legacy-operator-fixtures";
import { htmlLegacyOperatorCommandSchema } from "../composition-html-editing-legacy-operator.contract";
import { createHtmlLegacyOperatorHost } from "../composition-html-editing-legacy-operator-host.server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseHtmlLegacyAdoptionRepository } from "../composition-html-editing-legacy-adoption-repository.server";
import { htmlLegacyAdoptionReceiptSchema, type HtmlLegacyAdoptionReceipt } from "../composition-html-editing-legacy-adoption.contract";
import { hashCompositionDocument } from "../composition-document.service";
import { compositionEditorDocumentSchema } from "../composition-document.types";

const signal = () => AbortSignal.timeout(30_000);
async function stagedInput(f: Awaited<ReturnType<typeof createLegacyOperatorFixture>>) {
  const prepared = await f.workflow.execute(f.prepare, f.identity, signal());
  if (!prepared || prepared.status !== "PREPARED_LEGACY_PILOT_REQUIRES_REVIEW") throw new Error("PREPARATION_FAILED");
  return {action: "STAGE_REVIEWED" as const, locator: prepared.locator, approval: f.approval,
    confirmation: "REGISTER_REVIEWED_LEGACY_PILOT_WITHOUT_ADOPTING_OR_INSTALLING" as const};
}
test("operator commands never accept browser source/grants/actor, omitted review or automatic adoption", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    for (const added of [{sourceHtml: "PRIVATE"}, {actorId: otherActor}, {grantedAssetIds: [actor]}, {approval: true}])
      assert.equal(htmlLegacyOperatorCommandSchema.safeParse({...f.prepare, ...added}).success, false);
    const stage = await stagedInput(f);
    assert.equal(htmlLegacyOperatorCommandSchema.safeParse({...stage, approval: {...stage.approval, reviewerId: actor}}).success, false);
    assert.equal(htmlLegacyOperatorCommandSchema.safeParse({...stage, confirmation: "AUTO_APPROVE"}).success, false);
    assert.equal(htmlLegacyOperatorCommandSchema.safeParse({...stage, approval: {...stage.approval, completedReviews: []}}).success, false);
    assert.equal(htmlLegacyOperatorCommandSchema.safeParse({action: "ADOPT", candidateId}).success, false);
  } finally {await f.cleanup();}
});
test("concrete preparation/readback keeps original, pins native/source/profile and recovers by candidate UUID without installation", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    f.state.installed = false; const original = structuredClone(f.state.context);
    const prepared = await f.workflow.execute(f.prepare, f.identity, signal());
    assert.ok(prepared && prepared.status === "PREPARED_LEGACY_PILOT_REQUIRES_REVIEW");
    assert.notEqual(prepared.locator.originalSourceSha256, prepared.locator.candidateSourceSha256);
    assert.deepEqual(await f.workflow.execute({action: "READ_PREPARATION", candidateId}, f.identity, signal()), prepared);
    assert.deepEqual(f.state.context, original); assert.equal(f.state.mutations, 0);
    const stored = await f.handoff.read(prepared.locator, signal()); assert.equal(stored.encodedPilot, JSON.stringify(f.pilot));
    assert.equal(prepared.locator.expectedDocumentHash, f.context.documentHash);
    assert.doesNotMatch(JSON.stringify(prepared), /sourceHtml|encodedPilot|grantedAssetIds/);
  } finally {await f.cleanup();}
});
test("reviewer identity is current host input and durable intent precedes the single actual repository registration", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    const stage = await stagedInput(f), reviewer = {...f.identity, actorId: otherActor}, original = structuredClone(f.state.context);
    f.state.beforeRegister = async () => {
      const intent = await f.handoff.readRegistrationIntent(candidateId, signal());
      assert.equal(intent.approval.reviewerId, otherActor); assert.deepEqual(intent.locator, stage.locator);
      assert.equal(f.state.mutations, 0);
    };
    const result = await f.workflow.execute(stage, reviewer, signal());
    assert.ok(result && result.status === "LEGACY_CANDIDATE_REGISTERED_NOT_ADOPTED");
    assert.equal(f.state.mutations, 1); assert.deepEqual(f.state.context, original);
    const registration = f.calls.find(call => call.name === "record_html_editing_legacy_candidate")!;
    assert.equal(registration.parameters.p_actor_id, otherActor); assert.equal(f.state.stored!.approval.reviewerId, otherActor);
    assert.equal(f.state.stored!.originalSourceSha256, f.pilot.original.sha256);
    assert.equal(f.calls.some(call => /commit|append|register_html/.test(call.name)), false);
  } finally {await f.cleanup();}
});
test("lost registration ACK blocks a second write and recovers revoked history without source, grants, compiler or catalogue", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    const stage = await stagedInput(f); f.state.loseAck = true;
    await assert.rejects(f.workflow.execute(stage, f.identity, signal()), /COMMIT_UNCONFIRMED/);
    const preserved = await f.handoff.readRegistrationIntent(candidateId, signal());
    await assert.rejects(f.workflow.execute(stage, f.identity, signal()), /INTENT_UNCONFIRMED/);
    assert.equal(f.state.mutations, 1);
    f.state.contextUnavailable = true; f.state.installed = false; f.state.revoked = true; f.calls.length = 0;
    const result = await f.workflow.execute({action: "READ_REGISTRATION", candidateId}, f.identity, signal());
    assert.deepEqual(result, {status: "RECORDED", revoked: true, candidateId, provenanceSha256: preserved.locator.provenanceSha256,
      evidenceSha256: f.approval.evidenceSha256, trackingPreserved: true, currentGrant: false});
    assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_legacy_registration"]);
    assert.deepEqual(await f.handoff.readRegistrationIntent(candidateId, signal()), preserved);
  } finally {await f.cleanup();}
});
test("registration NOT_FOUND and revoked authority preserve intent and never authorize a registration retry", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    const stage = await stagedInput(f); f.state.beforeRegister = async () => {throw new Error("BEFORE_COMMIT_UNKNOWN");};
    await assert.rejects(f.workflow.execute(stage, f.identity, signal()));
    const preserved = await readFile(join(f.intentRoot, candidateId, "review-intent.json"));
    assert.deepEqual(await f.workflow.execute({action: "READ_REGISTRATION", candidateId}, f.identity, signal()), {status: "NOT_FOUND", trackingPreserved: true, currentGrant: false});
    f.state.deny = true; await assert.rejects(f.workflow.execute({action: "READ_REGISTRATION", candidateId}, f.identity, signal()));
    assert.deepEqual(await readFile(join(f.intentRoot, candidateId, "review-intent.json")), preserved);
    assert.equal(f.state.mutations, 0);
  } finally {await f.cleanup();}
});
test("current native/issuance/grant drift or missing installed catalogue prevents registration before intent", async () => {
  for (const drift of ["native", "issuance", "grant", "catalogue", "tenant"] as const) {
    const f = await createLegacyOperatorFixture();
    try {
      const stage = await stagedInput(f);
      if (drift === "native") f.state.context.document.clips[0]!.label = "Changed native";
      if (drift === "issuance") f.state.context.revisionId = otherActor;
      if (drift === "grant") f.state.context.grantedAssetIds = [];
      if (drift === "catalogue") f.state.installed = false;
      await assert.rejects(f.workflow.execute(stage, drift === "tenant" ? {...f.identity, organizationId: otherActor} : f.identity, signal()));
      await assert.rejects(f.handoff.readRegistrationIntent(candidateId, signal())); assert.equal(f.state.mutations, 0);
    } finally {await f.cleanup();}
  }
});
test("tampered handoff/locator or occupied preparation fails closed, without laundering a modified package", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    const stage = await stagedInput(f);
    await assert.rejects(f.workflow.execute({...stage, locator: {...stage.locator, preparationSha256: "f".repeat(64)}}, f.identity, signal()));
    await assert.rejects(f.workflow.execute(f.prepare, f.identity, signal()), /PREPARATION_UNCONFIRMED/);
    const path = join(f.handoffRoot, candidateId, "artifact.json"), artifact = JSON.parse(await readFile(path, "utf8"));
    artifact.body.encodedPilot = "{}"; await writeFile(path, JSON.stringify(artifact));
    await assert.rejects(f.workflow.execute(stage, f.identity, signal()), /PREPARATION_UNAVAILABLE/); assert.equal(f.state.mutations, 0);
  } finally {await f.cleanup();}
});
test("historical registration checks full recorded candidate and reviewer, not merely a matching candidate ID", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    const stage = await stagedInput(f); await f.workflow.execute(stage, f.identity, signal());
    f.state.stored!.approval.evidenceSha256 = "f".repeat(64);
    await assert.rejects(f.workflow.execute({action: "READ_REGISTRATION", candidateId}, f.identity, signal()), /CONFLICT/);
    const count = f.calls.length;
    await assert.rejects(f.workflow.execute({action: "READ_REGISTRATION", candidateId}, {...f.identity, actorId: otherActor}, signal()), /FORBIDDEN/);
    assert.equal(f.calls.length, count); assert.equal(f.state.mutations, 1);
  } finally {await f.cleanup();}
});

test("registered operator pilot is consumable by actual review/adoption repository with exact native pointer and historical receipt", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    const original = structuredClone(f.native.document), stage = await stagedInput(f);
    await f.workflow.execute(stage, f.identity, signal());
    let receipt: HtmlLegacyAdoptionReceipt | undefined, commits = 0;
    const client = {rpc: (name: string, parameters: Record<string, unknown>) => {
      if (name === "read_html_editing_legacy_candidate") return {abortSignal: async () => ({data: f.state.stored, error: null})};
      if (name === "read_html_editing_legacy_adoption_operation") return {abortSignal: async () => ({data: receipt
        ? {status: "RECORDED", receipt} : {status: "NOT_FOUND"}, error: null})};
      if (name === "commit_html_editing_legacy_adoption") return {abortSignal: async () => {
        const document = compositionEditorDocumentSchema.parse(parameters.p_document);
        assert.equal(hashCompositionDocument(document), parameters.p_document_hash);
        const clip = document.clips.find(item => item.id === f.prepare.clipId)!;
        assert.equal(clip.source.type, "DECK_SLIDE");
        if (clip.source.type !== "DECK_SLIDE") throw new Error();
        assert.equal(clip.source.html, f.pilot.candidate.sourceHtml);
        const pointer = document.htmlEditing!.items.find(item => item.clipId === clip.id)!;
        assert.equal(pointer.templateId, f.prepare.templateId);
        assert.equal(pointer.sourceSha256, f.pilot.candidate.sha256);
        assert.equal(pointer.revisionSha256, parameters.p_revision_sha256);
        assert.deepEqual(f.native.document, original); commits++;
        receipt = htmlLegacyAdoptionReceiptSchema.parse({scope: "HTML_LEGACY_ADOPTION_RECEIPT_NOT_CURRENT_STATE_OR_RENDERED",
          owner: {actorId: actor, organizationId: actor, draftId: actor}, clipId: clip.id, operationId: otherActor,
          requestSha256: parameters.p_request_sha256, request: parameters.p_request, acknowledgment: {status: "CONFIRMED",
            compositionDocumentHash: parameters.p_document_hash, compositionDocumentVersion: 2, revisionVersion: 1,
            revisionSha256: parameters.p_revision_sha256}});
        return {data: receipt, error: null};
      }};
      return f.supabase.rpc(name, parameters);
    }} as unknown as SupabaseClient;
    const repository = new SupabaseHtmlLegacyAdoptionRepository(client, f.catalog), command = {organizationId: actor, documentId: actor,
      clipId: f.prepare.clipId, actorId: actor, operationId: otherActor, request: {candidateId,
        provenanceSha256: stage.locator.provenanceSha256, expectedDocumentHash: stage.locator.expectedDocumentHash}};
    const review = await repository.readReviewedCandidate({...f.identity, documentId: actor, clipId: f.prepare.clipId,
      candidateId, expectedDocumentHash: stage.locator.expectedDocumentHash}, signal());
    assert.equal(review.originalSource, f.pilot.original.sourceHtml); assert.equal(review.candidateSource, f.pilot.candidate.sourceHtml);
    assert.deepEqual(await repository.commit(command, signal()), receipt);
    f.state.contextUnavailable = true; f.state.installed = false;
    assert.deepEqual(await new SupabaseHtmlLegacyAdoptionRepository(client).commit(command, signal()), receipt);
    assert.equal(commits, 1); assert.deepEqual(f.native.document, original);
    assert.equal(f.state.stored!.originalSourceSha256, f.pilot.original.sha256);
  } finally {await f.cleanup();}
});
test("root validation rejects nested/shared roots and pre-abort never dispatches a bootstrap read", async () => {
  const f = await createLegacyOperatorFixture();
  try {
    await assert.rejects(createHtmlLegacyOperatorHost({...f.configuration, intentRoot: f.handoffRoot}), /DISJOINT/);
    const nested = join(f.handoffRoot, "nested"); await mkdir(nested);
    await assert.rejects(createHtmlLegacyOperatorHost({...f.configuration, intentRoot: nested}), /DISJOINT/);
    const count = f.calls.length;
    await assert.rejects(f.workflow.execute(f.prepare, f.identity, AbortSignal.abort())); assert.equal(f.calls.length, count);
  } finally {await f.cleanup();}
});
test("registration recovery SQL is service-only current-authority historical read, including revoked records without recompilation/writes", async () => {
  const sql = (await readFile("../../supabase/migrations/20261010180000_read_html_editing_legacy_registration.sql", "utf8")).replace(/^\s*--.*$/gm, "");
  assert.match(sql, /state = 'ACTIVE' FOR SHARE/); assert.match(sql, /private\.assert_html_editing_actor/);
  assert.match(sql, /c\.reviewed_by = p_actor_id FOR SHARE/); assert.match(sql, /c\.revoked INTO candidate,revoked/);
  assert.match(sql, /'status','NOT_FOUND'/); assert.match(sql, /FROM PUBLIC,anon,authenticated/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|UPSERT)\b|AND NOT revoked|read_html_editing_bootstrap_context|html_editing_grants/);
});
