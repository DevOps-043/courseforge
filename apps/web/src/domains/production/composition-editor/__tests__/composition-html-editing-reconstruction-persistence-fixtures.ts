import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlHistoricalReconstructionArchivePreparer } from "../composition-html-editing-reconstruction-archive.server";
import { createHtmlReconstructionSlideResourceAcquirer, createHtmlReconstructionCompositionResourceAcquirer } from "../composition-html-editing-reconstruction-resources.server";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { hashCompositionDocument } from "../composition-document.service";
import { createHtmlReconstructionAuthorityVerifier } from "../composition-html-editing-reconstruction-authority.server";
import { HtmlReconstructionRepository } from "../composition-html-editing-reconstruction-repository.server";
import { describeHtmlReconstructionCandidate, type HtmlReconstructionCandidate } from "../composition-html-editing-reconstruction-candidate.server";
import { htmlReconstructionReviewRecordSchema, HTML_RECONSTRUCTION_REQUIRED_REVIEWS,
  type HtmlReconstructionStaging } from "../composition-html-editing-reconstruction.contract";
import { createHistoricalCandidatePreparationFixture } from "./composition-html-editing-historical-candidate-fixtures";
import { createHtmlReconstructionFixture } from "./composition-html-editing-reconstruction-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

export async function createReconstructionPersistenceFixture(withFont = false) {
  const source = await createHistoricalCandidatePreparationFixture("v1", withFont), reconstruction = createHtmlReconstructionFixture();
  if (withFont) {
    reconstruction.document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
    const {clip, track} = createCompositionNativeOverlay({document: reconstruction.document, id: "new-font", kind: "TEXT", playheadSeconds: 0});
    if (clip.source.type !== "NATIVE_TEXT") throw new Error();
    clip.source.style.fontAssetId = source.font.id; clip.source.style.fontFamily = source.font.family;
    if (track) reconstruction.document.tracks.push(track); reconstruction.document.clips.push(clip);
    reconstruction.expectedDocumentHash = hashCompositionDocument(reconstruction.document);
  }
  const artifact = await createHtmlHistoricalReconstructionArchivePreparer({supabase: source.configuration.supabase,
    storageOrigin: source.configuration.supabaseUrl, fetchResource: source.configuration.fetchImpl,
    readCatalog: () => reconstruction.catalog, acquireResources: withFont
      ? createHtmlReconstructionCompositionResourceAcquirer(source.configuration) : createHtmlReconstructionSlideResourceAcquirer(source.configuration.supabase)})(
    {...source.input, reconstruction: {target: reconstruction.target, document: reconstruction.document,
      expectedDocumentHash: reconstruction.expectedDocumentHash}});
  const locator = {scope: "RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION" as const, candidateId: other,
    organizationId: uuid, sourceCompositionId: uuid, sourceDraftId: uuid, targetCompositionId: other,
    targetDocumentId: other, targetRevisionId: other, projectHash: artifact.prepared.projectHash, metadataSha256: "a".repeat(64)};
  const approval = {candidateId: other, reviewerId: uuid, evidenceSha256: "e".repeat(64), reviewedProjectHash: locator.projectHash,
    reviewedMetadataSha256: locator.metadataSha256, completedReviews: [...HTML_RECONSTRUCTION_REQUIRED_REVIEWS] as [...typeof HTML_RECONSTRUCTION_REQUIRED_REVIEWS]};
  const review = htmlReconstructionReviewRecordSchema.parse({scope: "RECONSTRUCTION_REVIEW_RECORD_NOT_CREATION_AUTHORITY",
    locator, origin: artifact.candidate.origin, approval});
  const {archiveBytes, ...prepared} = artifact.prepared;
  const candidate = describeHtmlReconstructionCandidate({review, archiveSizeBytes: archiveBytes.length,
    content: {scope: artifact.scope, candidate: artifact.candidate, prepared}});
  const state = {calls: [] as string[], events: [] as string[], claim: undefined as HtmlReconstructionStaging | undefined,
    stored: undefined as HtmlReconstructionCandidate | undefined, receipt: undefined as unknown, uploads: 0, withdrawn: false,
    failAfter: "" as "" | "claim" | "candidate" | "create", authorityCalls: 0,
    before: undefined as ((name: string, parameters: Record<string, unknown>) => void) | undefined};
  const base = source.configuration.supabase;
  const supabase = {...base, rpc: (name: string, parameters: Record<string, unknown>) => {
    if (!name.includes("reconstruction")) return base.rpc(name, parameters);
    return {abortSignal: async (signal: AbortSignal) => {
      signal.throwIfAborted(); state.calls.push(name); state.events.push(name); state.before?.(name, parameters);
      assert.equal(parameters.p_org, uuid); assert.equal(parameters.p_actor, uuid);
      const staging = parameters.p_staging as HtmlReconstructionStaging;
      let response: unknown;
      if (name === "record_html_reconstruction_staging") {
        if (state.withdrawn) return {data: null, error: {message: "private revoked review"}};
        const created = !state.claim; if (state.claim) assert.deepEqual(state.claim, staging); state.claim = structuredClone(staging);
        if (state.failAfter === "claim") throw new Error("private lost claim ACK");
        response = {staging: state.claim, created};
      } else if (name === "record_html_reconstruction_candidate") {
        assert.deepEqual(staging, state.claim); state.stored = structuredClone(parameters.p_candidate as HtmlReconstructionCandidate);
        if (state.failAfter === "candidate") throw new Error("private lost candidate ACK"); response = true;
      } else if (name === "read_html_reconstruction_staging") response = state.claim
        ? {status: state.stored ? "RECORDED" : "CLAIM_RECORDED_CANDIDATE_UNCONFIRMED", staging: state.claim} : {status: "NOT_FOUND"};
      else if (name === "read_html_reconstruction_candidate") {
        if (state.withdrawn) return {data: null, error: {message: "private revoked review"}};
        response = state.stored;
      } else if (name === "read_html_reconstruction_creation") response = state.receipt
        ? {status: "RECORDED", receipt: state.receipt} : {status: "NOT_FOUND"};
      else {
        assert.equal(name, "create_html_reconstruction"); assert.ok(state.stored); assert.deepEqual(staging, state.claim);
        if (state.withdrawn) return {data: null, error: {message: "private revoked review"}};
        state.receipt = {scope: "RECONSTRUCTION_CREATION_RECEIPT_NOT_PUBLICATION_OR_CURRENT_STATE", staging,
          documentHash: candidate.content.candidate.documentHash, nativeVersion: 1, activated: false, originalDraftChanged: false, materialComponentId: null};
        if (state.failAfter === "create") throw new Error("private lost creation ACK"); response = state.receipt;
      }
      return {data: structuredClone(response), error: null};
    }};
  }} as unknown as SupabaseClient;
  const concreteAuthority = createHtmlReconstructionAuthorityVerifier({supabase, readCatalog: () => reconstruction.catalog});
  const verify = async (input: HtmlReconstructionCandidate, signal: AbortSignal) => {
    state.authorityCalls++; state.events.push("authority"); await concreteAuthority(input, signal);
  };
  const preserveCreationIntent = async (staging: HtmlReconstructionStaging) => {state.events.push("local-create-intent"); return structuredClone(staging);};
  const repository = new HtmlReconstructionRepository(supabase, verify, preserveCreationIntent);
  const stageInput = {handoff: {load: async () => structuredClone(artifact), save: async () => {throw new Error("unexpected save");}},
    locator, approval, authenticatedReviewerId: uuid, operationId: other,
    preserveStaging: async (staging: HtmlReconstructionStaging) => {state.events.push("local-journal"); return structuredClone(staging);},
    storeArchive: async (input: {bytes: Uint8Array}) => {
      state.events.push("upload-readback"); state.uploads++; assert.deepEqual(input.bytes, new Uint8Array(archiveBytes));
      return structuredClone(candidate.registration.archive);
    }};
  return {source, reconstruction, artifact, review, candidate, state, supabase, repository, stageInput, verify, preserveCreationIntent};
}
