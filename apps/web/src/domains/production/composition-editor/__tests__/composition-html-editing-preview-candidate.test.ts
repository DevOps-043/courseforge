import assert from "node:assert/strict";
import test from "node:test";
import type {SupabaseClient} from "@supabase/supabase-js";
import {prepareHtmlHistoricalReconstruction} from "../composition-html-editing-historical-reconstruction.server";
import {createMultipageHtmlReconstructionFixture} from "./composition-html-editing-reconstruction-fixtures";
import {freezeCompositionHtmlEditingSnapshot} from "../composition-html-editing-snapshot-bundle.server";
import {hashCompositionDocument} from "../composition-document-hash";
import {projectHtmlPreviewCandidateSnapshot, readHtmlPreviewCandidateSnapshot} from "../composition-html-editing-preview-candidate.server";
import {buildCompositionAgentProposal} from "../composition-agent-proposal.service";
import {prepareCompositionAgentProposalApplication} from "../composition-agent-proposal-store.service";
import {buildHtmlEditingPreviewPageUrl} from "../composition-html-editing-preview-url";
import {readHtmlPreviewCandidateQuery} from "../composition-html-editing-preview-candidate.contract";
import {issueHtmlPreviewResourceCapability, verifyHtmlPreviewResourceCapability, HTML_PREVIEW_CAPABILITY_POLICY} from "../composition-html-editing-preview-capability.server";
import {resolveHtmlPreviewCandidateIdentity} from "../composition-html-editing-preview-candidate.client";
import {canonicalCompositionDocumentJson} from "../composition-document-canonical-json";
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {join} from "node:path";
import {createHtmlEditingPreviewHost} from "../composition-html-editing-preview-host.client";

const actor = "11111111-1111-4111-8111-111111111111", other = "33333333-3333-4333-8333-333333333333";
function fixture(kind: "AGENT_PROPOSAL" | "PRESET_APPLICATION" = "PRESET_APPLICATION") {
  const f = createMultipageHtmlReconstructionFixture(), prepared = prepareHtmlHistoricalReconstruction(f);
  const document = prepared.document, baseHash = hashCompositionDocument(document);
  const context = {organizationId: f.origin.organizationId, documentId: f.target.documentId, documentHash: baseHash,
    revisions: prepared.initialRevisions.map(initial => ({encodedRevision: JSON.stringify(initial.revision),
      authoritativeBinding: initial.revision.manifest.binding, grantedAssetIds: f.grantedAssetIds, imageSources: f.imageSources}))};
  const base = {document, context, bundle: freezeCompositionHtmlEditingSnapshot({document, context})};
  const envelope = buildCompositionAgentProposal({document, baseDocumentHash: baseHash, proposalId: other,
    patch: {source: "AGENT", summary: "Adjust clip opacity", operations: [{type: "clip.layout", clipId: document.clips[0].id, layout: {opacity: 0.7}}]}});
  const candidate = prepareCompositionAgentProposalApplication({document, baseDocumentHash: baseHash, envelope}).document;
  const candidateHash = hashCompositionDocument(candidate);
  const row: Record<string, unknown> = {id: other, draft_id: context.documentId, organization_id: actor, created_by: actor,
    status: "PENDING", expires_at: "2050-01-01T00:00:00Z", base_document_hash: baseHash,
    ...(kind === "AGENT_PROPOSAL" ? {envelope} : {proposed_document: candidate, proposed_document_hash: candidateHash})};
  const state = {latestHash: baseHash, reads: 0, rpcReads: 0, storageError: false};
  const client = {from(table: string) {
    const query = {select() {return query;}, eq(column: string, value: unknown) {
      if (column === "created_by") assert.equal(value, actor); return query;
    }, order() {return query;}, limit(value: number) {assert.equal(value, 1); return query;},
    abortSignal: async (signal: AbortSignal) => {signal.throwIfAborted(); state.reads++;
      return {error: state.storageError ? {message: "private database error"} : null,
        data: table === "video_composition_draft_documents" ? [{document_hash: state.latestHash, version: 1}] : [structuredClone(row)]};}};
    return query;
  }} as unknown as SupabaseClient;
  const input = {actorId: actor, organizationId: actor, documentId: context.documentId, documentHash: candidateHash,
    candidate: {kind, id: other}, supabase: client};
  const ports = {readSnapshot: async (request: {documentHash: string}) => {
    state.rpcReads++; assert.equal(request.documentHash, baseHash); return base;
  }};
  return {base, candidate, candidateHash, row, state, input, ports};
}
for (const kind of ["AGENT_PROPOSAL", "PRESET_APPLICATION"] as const) test(`${kind} reads the saved authority and projects exact candidate content without mutation`, async () => {
  const f = fixture(kind), before = structuredClone(f.base.document);
  const result = await readHtmlPreviewCandidateSnapshot(f.input, f.ports);
  assert.equal(result.context.documentHash, f.candidateHash); assert.deepEqual(result.document, f.candidate);
  assert.notEqual(result.bundle.sha256, f.base.bundle.sha256); assert.equal(f.state.rpcReads, 1);
  assert.deepEqual(f.base.document, before); assert.equal(f.base.context.documentHash, hashCompositionDocument(before));
});
test("projection retains only surviving exact references, preserving original HTML bytes", () => {
  const f = fixture(), candidate = structuredClone(f.candidate), before = structuredClone(f.base.document);
  candidate.clips = candidate.clips.slice(0, 2); candidate.htmlEditing!.items = candidate.htmlEditing!.items.slice(0, 2);
  const result = projectHtmlPreviewCandidateSnapshot(f.base, candidate, hashCompositionDocument(candidate));
  assert.equal(result.context.revisions.length, 2); assert.deepEqual(f.base.document, before);
  assert.equal(result.document.clips[0].source.type, "DECK_SLIDE");
});
test("new/mutated pointers, source, hash or missing HTML cannot synthesize authority", () => {
  for (const mutation of ["pointer", "source", "hash", "missing"] as const) {
    const f = fixture(), candidate = structuredClone(f.candidate);
    if (mutation === "pointer") candidate.htmlEditing!.items[0].revisionSha256 = "f".repeat(64);
    if (mutation === "source" && candidate.clips[0].source.type === "DECK_SLIDE") candidate.clips[0].source.html += "<p>new</p>";
    if (mutation === "missing") delete candidate.htmlEditing;
    assert.throws(() => projectHtmlPreviewCandidateSnapshot(f.base, candidate,
      mutation === "hash" ? "f".repeat(64) : hashCompositionDocument(candidate)), /UNAVAILABLE/);
  }
});
test("creator, tenant, draft, pending state and finite expiry deny before authority acquisition", async () => {
  for (const field of ["created_by", "organization_id", "draft_id", "status", "expires_at"] as const) {
    const f = fixture(); f.row[field] = field === "status" ? "APPLIED" : field === "expires_at" ? "not-a-date" : other;
    await assert.rejects(readHtmlPreviewCandidateSnapshot(f.input, f.ports), {message: "HTML_PREVIEW_CANDIDATE_UNAVAILABLE"});
    assert.equal(f.state.rpcReads, 0);
  }
  const expired = fixture(); expired.row.expires_at = "2000-01-01T00:00:00Z";
  await assert.rejects(readHtmlPreviewCandidateSnapshot(expired.input, expired.ports), /UNAVAILABLE/);
  assert.equal(expired.state.rpcReads, 0);
});
test("base changes, DTO mismatches, invalid envelopes and database failure cannot mint a candidate snapshot", async () => {
  for (const change of ["base", "candidateHash", "storedHash", "envelopeId", "envelopeBase", "database"] as const) {
    const f = fixture(change.startsWith("envelope") ? "AGENT_PROPOSAL" : "PRESET_APPLICATION");
    if (change === "base") f.state.latestHash = "f".repeat(64);
    if (change === "candidateHash") f.input.documentHash = "f".repeat(64);
    if (change === "storedHash") f.row.proposed_document_hash = "f".repeat(64);
    if (change === "envelopeId") (f.row.envelope as {proposalId: string}).proposalId = actor;
    if (change === "envelopeBase") (f.row.envelope as {baseDocumentHash: string}).baseDocumentHash = "f".repeat(64);
    if (change === "database") f.state.storageError = true;
    await assert.rejects(readHtmlPreviewCandidateSnapshot(f.input, f.ports), {message: "HTML_PREVIEW_CANDIDATE_UNAVAILABLE"});
  }
});
test("query and URL selectors reject ambiguity and preserve exact handshake identity", () => {
  const session = {version: 1 as const, nonce: "b".repeat(64), documentHash: "c".repeat(64), previewGeneration: 3};
  for (const kind of ["AGENT_PROPOSAL", "PRESET_APPLICATION"] as const) {
    const url = new URL(buildHtmlEditingPreviewPageUrl(actor, session, undefined, {kind, id: other}), "https://app.test");
    assert.deepEqual(readHtmlPreviewCandidateQuery(url.searchParams), {kind, id: other});
    assert.equal(url.searchParams.get("documentHash"), session.documentHash);
    assert.throws(() => buildHtmlEditingPreviewPageUrl(actor, session, actor, {kind, id: other}), /SELECTOR_INVALID/);
  }
  for (const query of [`proposalId=${other}&applicationId=${other}`, `proposalId=${other}&proposalId=${other}`, "applicationId=bad"])
    assert.throws(() => readHtmlPreviewCandidateQuery(new URLSearchParams(query)));
});
test("HMAC capabilities bind the candidate selector without making legacy tokens require it", () => {
  const key = new Uint8Array(32).fill(9), claims = {format: "courseforge-html-preview-resource-v1" as const,
    actorId: actor, organizationId: actor, documentId: actor, audience: "https://app.test",
    session: {version: 1 as const, nonce: "b".repeat(64), documentHash: "c".repeat(64), previewGeneration: 3},
    bundleSha256: "d".repeat(64), inventoryFingerprint: "e".repeat(64), localPath: `conformance-media/${actor}`,
    checksum: "a".repeat(64), fileSizeBytes: 10, mimeType: "image/png", issuedAt: 100, expiresAt: 400};
  // Use the actual centralized lifetime; no test-specific permission duration.
  claims.expiresAt = claims.issuedAt + HTML_PREVIEW_CAPABILITY_POLICY.lifetimeSeconds;
  for (const candidate of [undefined, {kind: "AGENT_PROPOSAL" as const, id: other}]) {
    const token = issueHtmlPreviewResourceCapability({...claims, candidate}, key);
    const result = verifyHtmlPreviewResourceCapability({token, key, audience: claims.audience, documentId: actor, nowSeconds: 101});
    assert.deepEqual(result.candidate, candidate);
    if (candidate) {
      const [body, signature] = token.split(".");
      const forged = JSON.parse(Buffer.from(body, "base64url").toString("utf8")); forged.candidate.id = actor;
      assertInvalidCapability(`${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`, key);
    }
  }
});
function assertInvalidCapability(token: string, key: Uint8Array) {
  assert.throws(() => verifyHtmlPreviewResourceCapability({token, key, audience: "https://app.test", documentId: actor, nowSeconds: 101}), /CAPABILITY_INVALID/);
}

test("browser candidate digest matches the host simulation and existing canonical hash format exactly", async () => {
  const f = fixture("AGENT_PROPOSAL"), envelope = f.row.envelope as {operations: import("../editor-patch.types").CompositionEditorPatchOperation[]};
  const before = structuredClone(f.base.document);
  const identity = await resolveHtmlPreviewCandidateIdentity({document: f.base.document, documentHash: f.base.context.documentHash,
    candidate: {kind: "AGENT_PROPOSAL", id: other, baseDocumentHash: f.base.context.documentHash, operations: envelope.operations}});
  assert.equal(identity?.documentHash, f.candidateHash); assert.deepEqual(f.base.document, before);
  assert.equal(createHash("sha256").update(canonicalCompositionDocumentJson(f.base.document)).digest("hex"), f.base.context.documentHash);
  const canonical = canonicalCompositionDocumentJson({z: [2, {c: false, a: null}], a: "ü"});
  assert.equal(canonical, '{"a":"ü","z":[2,{"a":null,"c":false}]}');
});
test("preset browser identity preserves the server candidate pin and rejects stale base, malformed hash and cancellation", async () => {
  const f = fixture(), input = {document: f.base.document, documentHash: f.base.context.documentHash,
    candidate: {kind: "PRESET_APPLICATION" as const, id: other, baseDocumentHash: f.base.context.documentHash, documentHash: f.candidateHash}};
  assert.equal((await resolveHtmlPreviewCandidateIdentity(input))?.documentHash, f.candidateHash);
  await assert.rejects(resolveHtmlPreviewCandidateIdentity({...input, candidate: {...input.candidate, baseDocumentHash: "f".repeat(64)}}), /BASE_CHANGED/);
  await assert.rejects(resolveHtmlPreviewCandidateIdentity({...input, candidate: {...input.candidate, documentHash: "bad"}}), /INVALID/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(resolveHtmlPreviewCandidateIdentity({...input, signal: controller.signal}));
  const pendingController = new AbortController();
  const pending = resolveHtmlPreviewCandidateIdentity({...input, signal: pendingController.signal}); pendingController.abort();
  await assert.rejects(pending);
});
test("UI consumer uses active candidate URL/private channel and propagates the selector through resource renewal", () => {
  const root = join(process.cwd(), "src/domains/materials/components/composition-editor");
  const source = readFileSync(join(root, "NativeCompositionPreview.tsx"), "utf8");
  const hook = readFileSync(join(root, "useCompositionHtmlCandidatePreview.ts"), "utf8");
  assert.match(source, /const previewUrl = htmlCandidatePreview\.active \? htmlCandidatePreview\.url \|\| "about:blank"/);
  assert.match(source, /const url = baseline \? comparisonBaselineUrl : previewUrl/);
  assert.match(source, /candidate: readHtmlPreviewCandidateQuery\(query\)/);
  assert.match(source, /activeOrganizationId === organizationId && iframe\.src === expectedFrameUrl/);
  assert.match(source, /holder\.current !== host \|\| iframe\.src !== expectedFrameUrl/);
  assert.match(source, /holder\.current\.matchesSession\(session\)/);
  assert.match(hook, /resolved\?\.request === request/);
  assert.match(hook, /return \(\) => controller\.abort\(\)/);
  assert.doesNotMatch(hook, /setTimeout|fetch\(/);
  const session = {version: 1 as const, documentHash: "a".repeat(64), previewGeneration: 2, nonce: "b".repeat(64)};
  const host = createHtmlEditingPreviewHost({session, onEvent() {}, onFailure() {}});
  assert.equal(host.matchesSession({...session}), true);
  for (const changed of [{...session, documentHash: "c".repeat(64)}, {...session, nonce: "d".repeat(64)}, {...session, previewGeneration: 3}])
    assert.equal(host.matchesSession(changed), false);
  host.dispose();
});
