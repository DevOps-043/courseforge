import assert from "node:assert/strict";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { readCompositionHtmlEditingCompilation, readCompositionHtmlEditingSnapshot } from "../composition-html-editing-reader.service";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import { hashCompositionDocument } from "../composition-document.service";
import { buildCompositionHtmlEditingPreviewCsp } from "../composition-html-editing-preview-csp.server";

function readerFixture() {
  const input = createHtmlEditingRevisionFixture();
  const native = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.current.revision, revisionSha256: input.current.sha256 });
  const row = { document: native.document, documentHash: native.documentHash,
    revisions: [{ authoritativeBinding: input.authority.authoritativeBinding,
      revision: input.current.revision, grantedAssetIds: [uuid, other] }] };
  const state = { data: structuredClone(row) as unknown, error: null as unknown };
  const calls: Array<{ name: string; args: Record<string, unknown>; signal: AbortSignal }> = [];
  const supabase = { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    calls.push({ name, args, signal }); return { data: state.data, error: state.error };
  } }) } as unknown as SupabaseClient;
  const request = { actorId: uuid, organizationId: uuid, documentId: uuid, documentHash: native.documentHash, supabase };
  return { input, native, row, state, calls, request };
}

test("reader requests saved native hash and yields exactly the historical revision, not latest", async () => {
  const host = readerFixture();
  const result = await readCompositionHtmlEditingCompilation(host.request);
  assert.deepEqual(host.calls[0]!.args, { p_actor_id: uuid, p_organization_id: uuid, p_draft_id: uuid,
    p_document_hash: host.native.documentHash });
  assert.equal(host.calls[0]!.name, "read_html_editing_compilation");
  assert.ok(host.calls[0]!.signal instanceof AbortSignal);
  assert.equal(JSON.parse(result.context.revisions[0]!.encodedRevision).version, 1);
  assert.equal(host.input.next.revision.version, 2);
  const html = await compileCompositionPreview({ document: result.document, documentHash: host.native.documentHash,
    htmlEditingCompilation: result.context, target: "HYPERFRAMES_RENDER", assetUrls: new Map([
      [uuid, `conformance-media/${uuid}`],
      ["40000000-0000-4000-8000-000000000002", "conformance-media/40000000-0000-4000-8000-000000000002"],
    ]) });
  assert.match(html, /Original/);
  assert.doesNotMatch(html, /Changed/);
});

test("authorized exact reader and interactive compiler produce a hash-pinned editable CSP without mutating HTML", async () => {
  const host = readerFixture();
  const result = await readCompositionHtmlEditingCompilation(host.request);
  const html = await compileCompositionPreview({ document: result.document, documentHash: host.native.documentHash,
    htmlEditingCompilation: result.context, target: "INTERACTIVE_PREVIEW", previewGeneration: 1,
    assetUrls: new Map([[uuid, `conformance-media/${uuid}`],
      ["40000000-0000-4000-8000-000000000002", "conformance-media/40000000-0000-4000-8000-000000000002"]]) });
  const before = html;
  const policy = buildCompositionHtmlEditingPreviewCsp(html);
  assert.match(policy, /script-src 'sha256-/); assert.match(policy, /sandbox allow-scripts/);
  assert.doesNotMatch(policy, /unsafe-inline|unsafe-eval|allow-same-origin/);
  assert.equal(html, before); assert.equal(host.calls.length, 1);
  assert.equal(host.calls[0].args.p_document_hash, host.native.documentHash);
});

test("provider returning latest instead of selected revision is rejected", async () => {
  const host = readerFixture();
  host.row.revisions[0]!.revision = host.input.next.revision;
  host.state.data = host.row;
  await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /INVALID_REVISION/);
});

test("snapshot producer prepares frozen content from one authorized exact read without durable grants", async () => {
  const host = readerFixture();
  const result = await readCompositionHtmlEditingSnapshot(host.request);
  assert.equal(host.calls.length, 1);
  assert.equal(JSON.parse(result.bundle.encodedBundle).revisions[0].version, 1);
  assert.doesNotMatch(result.bundle.encodedBundle, /grantedAssetIds|imageSources/);
  assert.equal(hashCompositionDocument(result.document), host.native.documentHash);
});

test("reader rejects replaced native document and inconsistent document hashes", async () => {
  for (const mismatch of ["response", "document"] as const) {
    const host = readerFixture();
    if (mismatch === "response") host.row.documentHash = "f".repeat(64);
    else host.row.document.variables.title = "Different document";
    host.state.data = host.row;
    await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /INVALID_REVISION/);
  }
});

test("foreign independent template anchors and undeclared or revoked grants reject historical reads", async () => {
  for (const replacement of ["anchor", "foreignGrant", "revokedGrant"] as const) {
    const host = readerFixture();
    if (replacement === "anchor") host.row.revisions[0]!.authoritativeBinding.organizationId = other;
    else host.row.revisions[0]!.grantedAssetIds = replacement === "foreignGrant"
      ? ["33333333-3333-4333-8333-333333333333"] : [];
    host.state.data = host.row;
    await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /INVALID_REVISION/);
  }
});

test("missing, duplicate and malformed response entries cannot be treated as successful reads", async () => {
  for (const shape of ["missing", "duplicate", "unknown"] as const) {
    const host = readerFixture();
    if (shape === "missing") host.row.revisions = [];
    else if (shape === "duplicate") host.row.revisions.push(host.row.revisions[0]!);
    host.state.data = shape === "unknown" ? { ...host.row, unchecked: true } : host.row;
    await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /INVALID_REVISION/);
  }
});

test("legacy documents without native pointers cannot consume historical HTML rows", async () => {
  const host = readerFixture();
  host.row.document = host.input.document;
  host.row.documentHash = hashCompositionDocument(host.row.document);
  host.request.documentHash = host.row.documentHash;
  host.state.data = host.row;
  await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /INVALID_REVISION/);
});

test("oversized responses are rejected before revision parsing", async () => {
  const host = readerFixture();
  host.state.data = { padding: "x".repeat(16 * 1024 * 1024 + 1) };
  await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /INVALID_REVISION/);
});

test("provider errors and transport exceptions are safe, non-retried read failures", async () => {
  const host = readerFixture();
  host.state.error = { message: "PRIVATE_DATABASE_DETAIL" };
  await assert.rejects(readCompositionHtmlEditingCompilation(host.request), error =>
    error instanceof Error && error.message === "HTML_EDITING_READ_UNAVAILABLE");
  assert.equal(host.calls.length, 1);
  host.request.supabase = { rpc: () => { throw new Error("PRIVATE_DATABASE_DETAIL"); } } as unknown as SupabaseClient;
  await assert.rejects(readCompositionHtmlEditingCompilation(host.request), /READ_UNAVAILABLE/);
});

test("invalid or pre-cancelled requests do not issue privileged calls", async () => {
  const host = readerFixture();
  await assert.rejects(readCompositionHtmlEditingCompilation({ ...host.request, actorId: "invalid" }), /INVALID_REVISION/);
  await assert.rejects(readCompositionHtmlEditingCompilation({ ...host.request, documentHash: "invalid" }), /INVALID_REVISION/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(readCompositionHtmlEditingCompilation({ ...host.request, signal: controller.signal }));
  assert.equal(host.calls.length, 0);
});
