import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createHtmlEditingSnapshotArchiveStore } from "../composition-html-editing-snapshot-storage.server";
import { htmlEditingFixtureId as uuid } from "./composition-html-editing-test-fixtures";
import { createPreparedHtmlArchiveFixture } from "./composition-html-editing-snapshot-archive-fixtures";
import { publishCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-publication.server";

const bytes = new Uint8Array([1,2,3,4]);
const projectHash = createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const calls: RequestInit[] = []; const urls: string[] = [];
  const state = {status: 201, failUpload: false, readback: () => new Response(bytes, {headers: {"content-type": "application/zip"}})};
  const store = createHtmlEditingSnapshotArchiveStore({supabaseUrl: "https://project.supabase.co", serviceRoleKey: "test-only-secret",
    fetchImpl: async (url, init) => {
      calls.push(init!); urls.push(String(url));
      if (init!.method === "POST") {
        if (state.failUpload) throw new Error("test-only-secret");
        return new Response(null, {status: state.status});
      }
      return state.readback();
    }});
  const controller = new AbortController();
  return {store, state, calls, urls, controller, input: {organizationId: uuid, compositionId: uuid, projectHash,
    bytes, contentType: "application/zip" as const, signal: controller.signal}};
}

test("new upload and explicit conflict both require exact streamed readback", async () => {
  for (const status of [200,201,409]) {
    const f = fixture(); f.state.status = status;
    const receipt = await f.store(f.input);
    assert.deepEqual(receipt, {projectHash, sizeBytes: bytes.length, storageBucket: "production-assets",
      storagePath: `composition-snapshots/${uuid}/${uuid}/${projectHash}.zip`});
    assert.deepEqual(f.calls.map(call => call.method), ["POST", "GET"]);
    assert.equal(f.urls[0], f.urls[1]);
    for (const call of f.calls) {
      assert.equal(call.signal, f.controller.signal); assert.equal(call.redirect, "error");
      assert.equal(call.credentials, "omit"); assert.equal(call.cache, "no-store");
    }
    assert.equal(new Headers(f.calls[0]!.headers).get("x-upsert"), "false");
  }
});

test("invalid scope/hash/bytes and pre-abort prevent any network request", async () => {
  const f = fixture();
  for (const patch of [{organizationId: "../elsewhere"}, {projectHash: "f".repeat(64)}, {bytes: new Uint8Array()}]) {
    await assert.rejects(f.store({...f.input, ...patch}));
  }
  f.controller.abort(); await assert.rejects(f.store(f.input)); assert.equal(f.calls.length, 0);
});

test("lost upload and non-conflict errors never retry or perform readback", async () => {
  for (const status of [400,401,403,404,429,500]) {
    const f = fixture(); f.state.status = status;
    await assert.rejects(f.store(f.input), /HTML_EDITING_STORAGE_VERIFICATION_UNAVAILABLE/);
    assert.equal(f.calls.length, 1);
  }
  const f = fixture(); f.state.failUpload = true;
  await assert.rejects(f.store(f.input), error => error instanceof Error && !error.message.includes("test-only-secret"));
  assert.equal(f.calls.length, 1);
});

test("readback rejects wrong bytes, size, MIME, ranges, compression and error status", async () => {
  const responses = [() => new Response(new Uint8Array([4,3,2,1]), {headers: {"content-type":"application/zip"}}),
    () => new Response(new Uint8Array([1]), {headers: {"content-type":"application/zip"}}),
    () => new Response(new Uint8Array([1,2,3,4,5]), {headers: {"content-type":"application/zip"}}),
    () => new Response(bytes, {headers: {"content-type":"text/html"}}),
    () => new Response(bytes, {headers: {"content-type":"application/zip", "content-length":"3"}}),
    () => new Response(bytes, {headers: {"content-type":"application/zip", "content-range":"bytes 0-3/4"}}),
    () => new Response(bytes, {headers: {"content-type":"application/zip", "content-encoding":"gzip"}}),
    () => new Response(null, {status: 403})];
  for (const response of responses) {
    const f = fixture(); f.state.readback = response;
    await assert.rejects(f.store(f.input), /HTML_EDITING_STORAGE_VERIFICATION_UNAVAILABLE/);
    assert.deepEqual(f.calls.map(call => call.method), ["POST", "GET"]);
  }
});

test("oversized stream is cancelled immediately and does not yield a receipt", async () => {
  const f = fixture(); let cancelled = false;
  f.state.readback = () => new Response(new ReadableStream({start(controller) {controller.enqueue(new Uint8Array(5));},
    cancel() {cancelled = true;}}), {headers: {"content-type":"application/zip"}});
  await assert.rejects(f.store(f.input)); assert.equal(cancelled, true);
});

test("abort cancels a pending stream and withholds receipt", async () => {
  const f = fixture(); let cancelled = false;
  f.state.readback = () => new Response(new ReadableStream({pull() {f.controller.abort();},
    cancel() {cancelled = true;}}), {headers: {"content-type":"application/zip"}});
  await assert.rejects(f.store(f.input)); assert.equal(cancelled, true);
});

test("credentials cannot be sent through insecure or malformed host configuration", () => {
  for (const url of ["http://project.supabase.co", "https://user:pass@project.supabase.co", "https://project.supabase.co/path",
    "https://project.supabase.co?query=secret", "https://project.supabase.co#fragment", "https://project.supabase.co:8443"]) {
    assert.throws(() => createHtmlEditingSnapshotArchiveStore({supabaseUrl:url, serviceRoleKey:"test-only-secret"}), /CONFIGURATION_INVALID/);
  }
});

test("publication uses concrete Storage adapter for the real prepared ZIP before atomic repository port", async () => {
  const prepared = await createPreparedHtmlArchiveFixture(); let uploaded: Uint8Array | undefined; let commits = 0;
  const store = createHtmlEditingSnapshotArchiveStore({supabaseUrl:"https://project.supabase.co", serviceRoleKey:"test-only-secret",
    fetchImpl: async (_url, init) => {
      if (init!.method === "POST") {uploaded = new Uint8Array(init!.body as Uint8Array); return new Response(null, {status:201});}
      return new Response(uploaded! as BodyInit, {headers:{"content-type":"application/zip"}});
    }});
  const result = await publishCompositionHtmlEditingSnapshot({...prepared.input, compositionId:uuid,
    expectedActiveRevisionId:null, operationId:uuid, ports:{recordPublicationIntent:async input => ({status:"RECORDED",identity:input.identity,
      expectedActiveRevisionId:input.expectedActiveRevisionId,archiveSizeBytes:input.archiveSizeBytes}),
      storeImmutableArchive:store, commitSnapshotAtomically:async input => {
      commits++; assert.equal(input.archive.projectHash, createHash("sha256").update(uploaded!).digest("hex"));
      return {operationId:uuid, organizationId:uuid, compositionId:uuid, draftId:uuid, documentHash:input.documentHash,
        projectHash:input.archive.projectHash, revisionId:uuid, revisionNumber:1, activeRevisionId:uuid, disposition:"CREATED"};
    }}});
  assert.equal(commits,1); assert.equal(result.scope,"REGISTERED_BY_HOST_PORT_NOT_RENDERED");
});
