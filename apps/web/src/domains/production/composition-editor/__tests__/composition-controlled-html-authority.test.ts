import assert from "node:assert/strict";
import test from "node:test";
import { createHtmlEditingReferenceFixture } from "./composition-html-editing-reference-fixtures";
import { htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { controlledRenderExecutionContractSchema } from "../composition-render-execution-contract";
import { controlledRenderQueueClaimSchema } from "../qa/composition-controlled-render-worker-contract";
import { createControlledHtmlEditingAuthorityReader } from "../qa/composition-controlled-html-authority.service";

function fixture() {
  const reference = createHtmlEditingReferenceFixture();
  assert.ok(reference.contract.schemaVersion === 4);
  reference.contract.renderExecution = controlledRenderExecutionContractSchema.parse({
    policy: "CONTROLLED_FILES_AND_BROWSER_SESSION_V1", backend: "CONTROLLED", sdkVersion: "0.7.106",
    expectedBrowser: { protocolVersion: "1.3", product: "Chrome/test", revision: "test", userAgent: "test", jsVersion: "test" },
    files: Object.fromEntries(["node", "producer", "engine", "runtime", "browser", "encoder", "decoder"]
      .map(role => [role, { sha256: "a".repeat(64), sizeBytes: 10 }])),
  });
  const claim = controlledRenderQueueClaimSchema.parse({ organizationId: uuid, requestId: uuid, revisionId: uuid,
    productionJobId: uuid, workerId: "host", leaseToken: other, issuanceId: uuid, attempt: 1,
    supervisorId: "supervisor", keyId: "key", action: "EXECUTE", executionId: null, contract: reference.contract });
  const row = { documentId: uuid, imageAssets: [uuid, other].map(productionAssetId => ({productionAssetId,
    checksum: "a".repeat(64), fileSizeBytes: 1024, mimeType: "image/png" as const,
    storageBucket: "production-assets", storagePath: "html/image.png"})),
    compilation: { document: reference.native.document, documentHash: reference.native.documentHash,
    revisions: [{ authoritativeBinding: reference.input.authority.authoritativeBinding,
      revision: reference.input.next.revision, grantedAssetIds: [uuid, other] }] } };
  const state = { data: structuredClone(row) as unknown, error: null as unknown, failure: null as Error | null,
    onRead: undefined as (() => void) | undefined };
  const calls: Array<{ name: string; args: Record<string, unknown>; signal: AbortSignal }> = [];
  const supabase = { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    calls.push({ name, args, signal }); state.onRead?.();
    if (state.failure) throw state.failure;
    return { data: state.data, error: state.error };
  } }) };
  const reader = createControlledHtmlEditingAuthorityReader({ supabase: supabase as never, claim });
  const request = { organizationId: uuid, revisionId: uuid, documentHash: reference.native.documentHash };
  return { reader, request, row, reference, claim, supabase, state, calls };
}

test("claim reader issues one bounded lineage/lease RPC without accepting an archive actor or draft", async () => {
  const f = fixture();
  const result = await f.reader(f.request);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.name, "read_controlled_render_html_editing_authority");
  assert.deepEqual(f.calls[0]!.args, { p_organization_id: uuid, p_request_id: uuid, p_revision_id: uuid,
    p_production_job_id: uuid, p_worker_lease_token: other, p_document_hash: f.request.documentHash });
  assert.ok(f.calls[0]!.signal instanceof AbortSignal);
  assert.deepEqual(result.scope, { organizationId: uuid, documentId: uuid });
  assert.equal(result.authorities[0]!.authoritativeBinding.documentId, uuid);
  assert.ok(!("encodedRevision" in result.authorities[0]!));
});

test("claim-bound reader rejects foreign organization/revision/hash before touching backend", async () => {
  const f = fixture();
  for (const request of [{ ...f.request, organizationId: other }, { ...f.request, revisionId: other },
    { ...f.request, documentHash: "a".repeat(64) }]) {
    await assert.rejects(f.reader(request), /HTML_LINEAGE_MISMATCH/);
  }
  assert.equal(f.calls.length, 0);
});

test("RESUME is never a permit to obtain new HTML render authority", async () => {
  const f = fixture();
  const reader = createControlledHtmlEditingAuthorityReader({ supabase: f.supabase as never,
    claim: { ...f.claim, action: "RESUME", executionId: uuid } });
  await assert.rejects(reader(f.request), /HTML_LINEAGE_MISMATCH/);
  assert.equal(f.calls.length, 0);
});

test("reader uses fresh grants on every call and rejects revocation instead of caching permission", async () => {
  const f = fixture();
  await f.reader(f.request);
  f.row.compilation.revisions[0]!.grantedAssetIds = [];
  f.state.data = f.row;
  await assert.rejects(f.reader(f.request), /HTML_AUTHORITY_INVALID/);
  assert.equal(f.calls.length, 2);
});

test("wrong resolved draft, independent template anchor or selected revision cannot pass lineage integrity", async () => {
  for (const mismatch of ["draft", "anchor", "revision", "native"] as const) {
    const f = fixture();
    if (mismatch === "draft") f.row.documentId = other;
    if (mismatch === "anchor") f.row.compilation.revisions[0]!.authoritativeBinding = {
      ...f.row.compilation.revisions[0]!.authoritativeBinding, templateVersion: 999 };
    if (mismatch === "revision") f.row.compilation.revisions[0]!.revision = f.reference.input.current.revision;
    if (mismatch === "native") f.row.compilation.document.variables.title = "Different saved document";
    f.state.data = f.row;
    await assert.rejects(f.reader(f.request), /HTML_AUTHORITY_INVALID/);
  }
});

test("bounded strict authority response rejects excessive bytes, missing rows and forged extra authority", async () => {
  for (const response of [null, {}, { padding: "x".repeat(16 * 1024 * 1024 + 1) },
    { ...fixture().row, actorId: other }, { ...fixture().row, scope: { organizationId: other } }]) {
    const f = fixture(); f.state.data = response;
    await assert.rejects(f.reader(f.request), /HTML_AUTHORITY_INVALID/);
  }
});

test("RPC denial and transport failure are safe, single-attempt reads without leaking backend internals", async () => {
  for (const failure of ["rpc", "transport"] as const) {
    const f = fixture();
    if (failure === "rpc") f.state.error = { message: "PRIVATE_DATABASE_DETAIL" };
    else f.state.failure = new Error("PRIVATE_DATABASE_DETAIL");
    await assert.rejects(f.reader(f.request), error => error instanceof Error
      && error.message === "CONTROLLED_RENDER_HTML_AUTHORITY_UNAVAILABLE");
    assert.equal(f.calls.length, 1);
  }
});

test("pre-abort and abort during RPC prevent returning successful authority", async () => {
  for (const stage of ["before", "during"] as const) {
    const f = fixture(); const cancellation = new AbortController();
    const reason = new Error("CONTROLLED_TEST_CANCELLED");
    if (stage === "before") cancellation.abort(reason);
    else f.state.onRead = () => cancellation.abort(reason);
    await assert.rejects(f.reader({ ...f.request, signal: cancellation.signal }), error => error === reason);
    assert.equal(f.calls.length, stage === "before" ? 0 : 1);
  }
});

test("invalid claim is rejected at construction and cannot trigger an RPC", () => {
  const f = fixture();
  assert.throws(() => createControlledHtmlEditingAuthorityReader({ supabase: f.supabase as never,
    claim: { ...f.claim, leaseToken: "invalid" } }));
  assert.equal(f.calls.length, 0);
});

test("image identities must exactly cover currently granted IDs with safe bounded records", async () => {
  for (const shape of ["missing", "extra", "duplicate", "unsafe", "svg", "absent"] as const) {
    const f = fixture();
    if (shape === "missing") f.row.imageAssets.pop();
    if (shape === "extra") f.row.imageAssets.push({...f.row.imageAssets[0]!, productionAssetId: "33333333-3333-4333-8333-333333333333"});
    if (shape === "duplicate") f.row.imageAssets.push(f.row.imageAssets[0]!);
    if (shape === "unsafe") f.row.imageAssets[0]!.storagePath = "../escape";
    if (shape === "svg") (f.row.imageAssets[0] as {mimeType: string}).mimeType = "image/svg+xml";
    f.state.data = shape === "absent" ? {documentId: f.row.documentId, compilation: f.row.compilation} : f.row;
    await assert.rejects(f.reader(f.request), /HTML_AUTHORITY_INVALID/);
  }
});
