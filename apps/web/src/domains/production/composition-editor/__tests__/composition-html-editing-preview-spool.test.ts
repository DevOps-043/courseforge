import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { access, readFile, stat, open } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { spoolCompositionHtmlEditingPreviewResource } from "../composition-html-editing-preview-spool.server";
import { streamHtmlEditingPreviewStorageToSink, HTML_EDITING_PREVIEW_STORAGE_POLICY } from "../composition-html-editing-preview-storage.server";

const origin = "https://storage.example.test";
function fixture(bytes = new Uint8Array([1, 2, 3, 4])) {
  const identity = { checksum: createHash("sha256").update(bytes).digest("hex"), fileSizeBytes: bytes.byteLength,
    mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "native/sample.mp4" };
  const state = { signs: 0, fetches: 0, cancelled: 0, extraQuery: "", status: 200, failWrite: false };
  const supabase = { storage: { from: () => ({ createSignedUrl: async () => {
    state.signs++;
    return { data: { signedUrl: `${origin}/storage/v1/object/sign/production-assets/native/sample.mp4?token=private${state.extraQuery}` }, error: null };
  } }) } } as unknown as SupabaseClient;
  const fetchResource = (async () => {
    state.fetches++;
    let sent = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { if (sent) controller.close(); else { controller.enqueue(bytes); sent = true; } },
      cancel() { state.cancelled++; },
    });
    return new Response(stream, { status: state.status, headers: { "content-type": "video/mp4", "content-length": String(identity.fileSizeBytes) } });
  }) as typeof fetch;
  return { bytes, identity, state, input: { identity, supabase, storageOrigin: origin, fetchResource } };
}

test("private preview spool verifies actual file bytes and disposes only its owned file/directory, idempotently", async () => {
  const f = fixture(), resource = await spoolCompositionHtmlEditingPreviewResource(f.input);
  try {
    assert.deepEqual(new Uint8Array(await readFile(resource.filePath)), f.bytes);
    assert.deepEqual(await resource.readSmallBytes(), f.bytes);
    assert.equal((await stat(resource.filePath)).size, f.bytes.byteLength);
    assert.equal(resource.scope, "BYTE_VERIFIED_PRIVATE_PREVIEW_FILE_NOT_DECODE_OR_RENDER_EVIDENCE");
    assert.notEqual(resource.filePath, f.identity.storagePath);
  } finally { await Promise.all([resource.dispose(), resource.dispose()]); }
  await assert.rejects(access(resource.filePath), { code: "ENOENT" });
  await assert.rejects(access(path.dirname(resource.filePath)), { code: "ENOENT" });
  await resource.dispose();
});

test("streaming preview spool accepts content beyond the buffer budget without buffering the whole file", async () => {
  const f = fixture(), block = new Uint8Array(64 * 1024).fill(17), tail = new Uint8Array([19]);
  const repeats = HTML_EDITING_PREVIEW_STORAGE_POLICY.bufferedBytes / block.byteLength;
  const hash = createHash("sha256");
  for (let index = 0; index < repeats; index++) hash.update(block);
  hash.update(tail);
  f.identity.fileSizeBytes = HTML_EDITING_PREVIEW_STORAGE_POLICY.bufferedBytes + 1;
  f.identity.checksum = hash.digest("hex");
  let emitted = 0;
  const fetchResource = (async () => new Response(new ReadableStream<Uint8Array>({ pull(controller) {
    if (emitted < repeats) controller.enqueue(block);
    else if (emitted === repeats) controller.enqueue(tail);
    else controller.close();
    emitted++;
  } }), { headers: { "content-type": "video/mp4", "content-length": String(f.identity.fileSizeBytes) } })) as typeof fetch;
  const resource = await spoolCompositionHtmlEditingPreviewResource({ ...f.input, fetchResource });
  try {
    assert.equal((await stat(resource.filePath)).size, f.identity.fileSizeBytes);
    const file = await open(resource.filePath, "r");
    try {
      const last = new Uint8Array(1); await file.read(last, 0, 1, f.identity.fileSizeBytes - 1);
      assert.deepEqual(last, tail);
    } finally { await file.close(); }
  } finally { await resource.dispose(); }
});

test("spool rejects altered hash/truncation, unapproved query and pre-abort without returning any resource", async () => {
  for (const mutation of ["hash", "length", "query", "status"]) {
    const f = fixture();
    if (mutation === "hash") f.identity.checksum = "f".repeat(64);
    if (mutation === "length") f.identity.fileSizeBytes++;
    if (mutation === "query") f.state.extraQuery = "&download=anything";
    if (mutation === "status") f.state.status = 206;
    await assert.rejects(spoolCompositionHtmlEditingPreviewResource(f.input), /^HtmlEditingPreviewSpoolError: HTML_EDITING_PREVIEW_SPOOL_UNAVAILABLE$/);
    if (mutation === "query") assert.equal(f.state.fetches, 0);
  }
  const f = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(spoolCompositionHtmlEditingPreviewResource({ ...f.input, signal: controller.signal }));
  assert.equal(f.state.signs, 0);
});

test("unverified sink failure cancels acquisition and cannot produce a successful integrity result", async () => {
  const f = fixture(); let writes = 0;
  await assert.rejects(streamHtmlEditingPreviewStorageToSink({ ...f.input, writeChunk: async () => {
    writes++; throw new Error("private disk failure");
  } }), /^HtmlEditingPreviewStorageError: HTML_EDITING_PREVIEW_STORAGE_UNAVAILABLE$/);
  assert.equal(writes, 1);
});

test("stream rejects oversized transport chunks before copying or writing them", async () => {
  const f = fixture(new Uint8Array(HTML_EDITING_PREVIEW_STORAGE_POLICY.maximumChunkBytes + 1));
  let writes = 0;
  await assert.rejects(streamHtmlEditingPreviewStorageToSink({ ...f.input, writeChunk: async () => { writes++; } }));
  assert.equal(writes, 0);
});

test("small spool reads recheck disk bytes and reject changed size/hash rather than trusting acquisition metadata", async () => {
  for (const change of ["hash", "size"]) {
    const f = fixture(), resource = await spoolCompositionHtmlEditingPreviewResource(f.input);
    try {
      const file = await open(resource.filePath, "r+");
      try {
        if (change === "hash") await file.write(new Uint8Array([255]), 0, 1, 0);
        else await file.truncate(HTML_EDITING_PREVIEW_STORAGE_POLICY.bufferedBytes + 1);
      } finally { await file.close(); }
      await assert.rejects(resource.readSmallBytes(), /^HtmlEditingPreviewSpoolError: HTML_EDITING_PREVIEW_SPOOL_UNAVAILABLE$/);
    } finally { await resource.dispose(); }
    await assert.rejects(resource.readSmallBytes());
  }
});
