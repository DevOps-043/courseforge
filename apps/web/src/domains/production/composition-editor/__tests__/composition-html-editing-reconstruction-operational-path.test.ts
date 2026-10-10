import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createSelectedReconstructionResourceFixture } from "./composition-html-editing-reconstruction-selected-resource-fixtures";
import { htmlEditingFixtureId as actor, htmlEditingFixtureOtherId as candidateId } from "./composition-html-editing-test-fixtures";
import { createHtmlReconstructionOperatorHost } from "../composition-html-editing-reconstruction-operator-host.server";
import { executeHtmlReconstructionOperatorCommand as execute } from "../composition-html-editing-reconstruction-operator-command.server";
import { HTML_RECONSTRUCTION_REQUIRED_REVIEWS, type HtmlReconstructionReviewRecord,
  type HtmlReconstructionStaging, htmlReconstructionCreationReceiptSchema } from "../composition-html-editing-reconstruction.contract";
import type { HtmlReconstructionCandidate } from "../composition-html-editing-reconstruction-candidate.server";
import { readAuthorizedHtmlReconstructionOpening } from "../composition-html-editing-reconstruction-opening.server";

test("concrete private factory connects prepare/sealed review/current selection/upload/create/recovery/opening without original edits", async () => {
  const f = await createSelectedReconstructionResourceFixture(), original = structuredClone(f.source.original.compilation.document);
  await mkdir(".tmp", {recursive: true}); const root = await mkdtemp(join(process.cwd(), ".tmp", "cap029-reconstruction-path-"));
  const handoffRoot = join(root, "handoff"), reviewRoot = join(root, "reviews"), operationRoot = join(root, "operations");
  await Promise.all([handoffRoot, reviewRoot, operationRoot].map(path => mkdir(path)));
  let reviewed: HtmlReconstructionReviewRecord | undefined, staging: HtmlReconstructionStaging | undefined;
  let stored: HtmlReconstructionCandidate | undefined, receipt: z.infer<typeof htmlReconstructionCreationReceiptSchema> | undefined;
  let uploaded: Uint8Array | undefined, uploadUrl = "", uploads = 0, creates = 0, reviewWrites = 0, lostReview = true, lostCreate = true;
  const calls: string[] = [], operationId = "33333333-3333-4333-8333-333333333333";
  const supabase = {...f.configuration.supabase, rpc: (name: string, parameters: Record<string, unknown>) => {
    if (name === "read_html_reconstruction_selected_resources" || !name.includes("reconstruction")) return f.configuration.supabase.rpc(name, parameters);
    return {abortSignal: async (signal: AbortSignal) => {
      signal.throwIfAborted(); calls.push(name); assert.equal(parameters.p_org, actor); assert.equal(parameters.p_actor, actor);
      let result: unknown;
      if (name === "record_html_reconstruction_review") {
        const intent = JSON.parse(await readFile(join(reviewRoot, candidateId, "review-intent.json"), "utf8"));
        assert.deepEqual(intent.record, parameters.p_record); reviewed = structuredClone(parameters.p_record as HtmlReconstructionReviewRecord); reviewWrites++;
        if (lostReview) throw new Error("SYNTHETIC_LOST_REVIEW_ACK");
        result = {record: reviewed, created: true, revoked: false};
      } else if (name === "read_html_reconstruction_review") result = reviewed ? {status: "RECORDED", record: reviewed, revoked: false} : {status: "NOT_FOUND"};
      else if (name === "record_html_reconstruction_staging") {
        assert.ok(reviewed); assert.deepEqual((parameters.p_staging as HtmlReconstructionStaging).review, reviewed);
        assert.equal(uploads, 0); staging = structuredClone(parameters.p_staging as HtmlReconstructionStaging); result = {staging, created: true};
      } else if (name === "record_html_reconstruction_candidate") {
        assert.equal(uploads, 1); stored = structuredClone(parameters.p_candidate as HtmlReconstructionCandidate); result = true;
      } else if (name === "read_html_reconstruction_staging") result = staging ? {status: stored ? "RECORDED" : "CLAIM_RECORDED_CANDIDATE_UNCONFIRMED", staging} : {status: "NOT_FOUND"};
      else if (name === "read_html_reconstruction_candidate") result = stored;
      else if (name === "read_html_reconstruction_creation") result = receipt ? {status: "RECORDED", receipt} : {status: "NOT_FOUND"};
      else if (name === "create_html_reconstruction") {
        assert.ok(stored && staging); creates++;
        assert.deepEqual(stored.content.candidate.target.resourceSelection, f.selection);
        assert.equal(stored.content.candidate.usedAssetIds.length, 6); assert.equal(stored.content.prepared.fontManifest.length, 1);
        assert.equal(stored.content.candidate.target.documentId, candidateId);
        receipt = {scope: "RECONSTRUCTION_CREATION_RECEIPT_NOT_PUBLICATION_OR_CURRENT_STATE", staging, documentHash: stored.content.candidate.documentHash,
          nativeVersion: 1, activated: false, originalDraftChanged: false, materialComponentId: null};
        if (lostCreate) throw new Error("SYNTHETIC_LOST_CREATE_ACK"); result = receipt;
      } else {
        assert.equal(name, "read_html_reconstruction_opening"); assert.ok(stored && staging && receipt);
        assert.equal(parameters.p_draft, candidateId); assert.equal(parameters.p_composition, candidateId);
        result = {scope: "AUTHORIZED_RECONSTRUCTION_OPENING_NOT_DOCUMENT_OR_PUBLICATION", organizationId: actor,
          compositionId: candidateId, draftId: candidateId, candidateId, operationId, seedRevisionId: candidateId,
          seedDocumentHash: receipt.documentHash, currentDocumentHash: receipt.documentHash, currentVersion: 1,
          materialComponentId: null, activeRevisionId: null};
      }
      return {data: structuredClone(result), error: null};
    }};
  }} as unknown as SupabaseClient;
  const fetchImpl = (async (url: RequestInfo | URL, options?: RequestInit) => {
    if (String(url).includes(`/object/production-assets/composition-snapshots/${actor}/${candidateId}/`)) {
      if (options?.method === "POST") {
        assert.equal((options.headers as Record<string,string>)["x-upsert"], "false");
        uploads++; uploaded = new Uint8Array(options.body as Uint8Array); uploadUrl = String(url); return new Response(null, {status: 201});
      }
      assert.equal(options?.method, "GET"); assert.equal(String(url), uploadUrl); assert.ok(uploaded);
      return new Response(uploaded as BodyInit, {headers: {"content-type": "application/zip", "content-length": String(uploaded.length)}});
    }
    return f.configuration.fetchImpl(url, options);
  }) as typeof fetch;
  try {
    const configuration = {...f.configuration, supabase, fetchImpl, handoffRoot, reviewRoot, operationRoot,
      integrityKey: Buffer.alloc(32, 21), readCatalog: () => f.reconstruction.catalog};
    const identity = {actorId: actor, organizationId: actor}, workflow = await createHtmlReconstructionOperatorHost(configuration);
    const ports = {workflow, authenticate: async () => identity, signal: AbortSignal.timeout(60_000),
      runtime: async () => ({renderProfile: f.input.renderProfile, renderExecution: f.input.renderExecution, animationRuntimeSha256: f.input.animationRuntimeSha256})};
    const prepared = await execute({action: "PREPARE", compositionId: actor, draftId: actor, revisionId: actor, candidateId,
      reconstruction: f.input.reconstruction}, ports);
    assert.ok("locator" in prepared && prepared.locator); assert.equal(uploads, 0); assert.equal(reviewWrites, 0);
    const reviewCommand = {action: "REVIEW", locator: prepared.locator, approval: {candidateId,
      evidenceSha256: "e".repeat(64), reviewedProjectHash: prepared.locator.projectHash, reviewedMetadataSha256: prepared.locator.metadataSha256,
      completedReviews: [...HTML_RECONSTRUCTION_REQUIRED_REVIEWS]}};
    await assert.rejects(execute(reviewCommand, ports), /REVIEW_UNCONFIRMED/);
    const restarted = await createHtmlReconstructionOperatorHost(configuration);
    const recoveredPorts = {...ports, workflow: restarted}; lostReview = false;
    const recoveredReview = await execute({action: "READ_REVIEW", candidateId}, recoveredPorts);
    assert.ok("status" in recoveredReview && recoveredReview.status === "RECORDED");
    await assert.rejects(execute(reviewCommand, recoveredPorts), /JOURNAL_UNCONFIRMED/); assert.equal(reviewWrites, 1);
    await execute({action: "STAGE", candidateId, operationId}, recoveredPorts); assert.equal(uploads, 1); assert.equal(creates, 0);
    await assert.rejects(execute({action: "CREATE", operationId,
      confirmation: "CREATE_INDEPENDENT_CONTENT_WITHOUT_ACTIVATING_OR_CHANGING_ORIGINAL"}, recoveredPorts), /UNCONFIRMED/);
    const resourceReads = f.calls.length, fontFetches = f.source.state.fontFetches, sourceReads = f.source.state.archiveReads;
    f.state.deny = true; lostCreate = false;
    const recoveredCreation = await execute({action: "READ_CREATION", operationId}, recoveredPorts);
    assert.ok("status" in recoveredCreation && recoveredCreation.status === "RECORDED");
    assert.ok("editorPath" in recoveredCreation); assert.ok(recoveredCreation.editorPath.includes(candidateId));
    assert.equal(f.calls.length, resourceReads); assert.equal(f.source.state.fontFetches, fontFetches); assert.equal(f.source.state.archiveReads, sourceReads);
    const opening = await readAuthorizedHtmlReconstructionOpening({supabase, request: {...identity, compositionId: candidateId, draftId: candidateId}});
    assert.equal(opening.materialComponentId, null); assert.equal(opening.activeRevisionId, null); assert.equal(opening.seedDocumentHash, receipt!.documentHash);
    assert.equal(creates, 1); assert.equal(uploads, 1); assert.equal(calls.filter(name => name === "create_html_reconstruction").length, 1);
    assert.deepEqual(f.source.original.compilation.document, original);
    assert.equal(f.source.state.queries.includes("video_composition_draft_assets"), false);
  } finally {
    assert.equal(dirname(resolve(root)), resolve(process.cwd(), ".tmp"));
    await rm(root, {recursive: true, force: true});
  }
});
