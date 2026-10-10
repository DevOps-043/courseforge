import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAuthorizedHtmlSnapshotInspection, withAuthorizedHtmlSnapshotArchive } from "../composition-html-editing-snapshot-inspection-read.server";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const origin = "https://storage.example.test", path = "html-editing-revisions.json";
const digest = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture() {
  const zip = new JSZip(); zip.file(path, "{}"); zip.file("preview.html", "never execute");
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer" });
  const request = { actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid, revisionId: uuid };
  const row = { ...request, scope: "AUTHORIZED_HISTORICAL_HTML_ARCHIVE_READ_ONLY", documentId: uuid,
    documentHash: "a".repeat(64), projectHash: digest(archiveBytes), archiveBytes: archiveBytes.length,
    storageBucket: "production-assets", storagePath: `composition-snapshots/${uuid}/${uuid}/${digest(archiveBytes)}.zip`,
    bundlePin: { schemaVersion: 1, path, sha256: digest("{}") } };
  const state = { reads: 0, signs: 0, fetches: 0, first: row as unknown, second: row as unknown,
    signingOrigin: origin, body: archiveBytes, mime: "application/zip", encoding: "identity" };
  const supabase = {
    rpc: (name: string, parameters: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
      signal.throwIfAborted(); state.reads++; assert.equal(name, "read_html_editing_snapshot_archive");
      assert.deepEqual(parameters, { p_org: uuid, p_actor: uuid, p_composition: uuid, p_draft: uuid, p_revision: uuid });
      return { data: state.reads === 1 ? state.first : state.second, error: null };
    } }),
    storage: { from: (bucket: string) => ({ createSignedUrl: async (storagePath: string, seconds: number) => {
      state.signs++; assert.equal(bucket, "production-assets"); assert.equal(storagePath, row.storagePath); assert.equal(seconds, 60);
      return { data: { signedUrl: `${state.signingOrigin}/storage/v1/object/sign/${bucket}/${storagePath}?token=private` }, error: null };
    } }) },
  } as unknown as SupabaseClient;
  const fetchResource = (async (_url: unknown, options: RequestInit) => {
    state.fetches++; assert.equal(options.redirect, "error"); assert.equal(options.credentials, "omit");
    assert.equal(options.cache, "no-store");
    return new Response(new Uint8Array(state.body), { headers: { "content-type": state.mime, "content-length": String(state.body.length), "content-encoding": state.encoding } });
  }) as typeof fetch;
  return { row, state, input: { request, supabase, storageOrigin: origin, fetchResource } };
}

test("authorized archive read checks exact identity before signing and reauthorizes after inspection", async () => {
  const f = await fixture(), result = await readAuthorizedHtmlSnapshotInspection(f.input);
  assert.equal(f.state.reads, 2); assert.equal(f.state.signs, 1); assert.equal(f.state.fetches, 1);
  assert.equal(result.scope, "AUTHORIZED_ARCHIVE_DIAGNOSTIC_NOT_EXECUTION_OR_PUBLICATION");
  assert.equal(result.diagnostic.status, "REJECTED"); assert.equal(result.diagnostic.reason, "INVALID_BUNDLE");
  assert.equal("storagePath" in result || "bundle" in result || "sourceHtml" in result || "signedUrl" in result, false);
  const guarded = await fixture();
  await withAuthorizedHtmlSnapshotArchive(guarded.input, async ({ request, identity }) => {
    assert.equal(Object.isFrozen(request), true); assert.equal(Object.isFrozen(identity), true);
    assert.equal(Object.isFrozen(identity.bundlePin), true);
    assert.throws(() => { identity.projectHash = "f".repeat(64); }, TypeError);
    return null;
  });
});

test("swapped owner, storage family, size and extra authority reject before allocation/signing", async () => {
  for (const change of [{ organizationId: other }, { actorId: other }, { draftId: other }, { revisionId: other },
    { storageBucket: "thumbnails" }, { storagePath: "other/tenant.zip" }, { archiveBytes: 209715201 }, { grantedAssetIds: [uuid] }]) {
    const f = await fixture(); f.state.first = { ...f.row, ...change };
    await assert.rejects(readAuthorizedHtmlSnapshotInspection(f.input), /^Error: HTML_SNAPSHOT_INSPECTION_READ_UNAVAILABLE$/);
    assert.equal(f.state.signs, 0); assert.equal(f.state.fetches, 0);
  }
});

test("post-acquisition authorization failure and changed immutable metadata discard diagnostic", async () => {
  for (const change of [null, { documentHash: "f".repeat(64) }, { documentId: other }, { bundlePin: { schemaVersion: 1, path, sha256: "f".repeat(64) } }]) {
    const f = await fixture(); f.state.second = change === null ? null : { ...f.row, ...change };
    await assert.rejects(readAuthorizedHtmlSnapshotInspection(f.input), /READ_UNAVAILABLE/);
    assert.equal(f.state.reads, 2); assert.equal(f.state.fetches, 1);
  }
});

test("trusted signed URL, ZIP MIME, identity encoding and actual checksum cannot be substituted", async () => {
  for (const failure of ["origin", "mime", "encoding", "body"] as const) {
    const f = await fixture();
    if (failure === "origin") f.state.signingOrigin = "https://attacker.test";
    if (failure === "mime") f.state.mime = "text/html";
    if (failure === "encoding") f.state.encoding = "gzip";
    if (failure === "body") { f.state.body = Buffer.from(f.state.body); f.state.body[0] = 0; }
    await assert.rejects(readAuthorizedHtmlSnapshotInspection(f.input), /READ_UNAVAILABLE/);
    assert.equal(f.state.reads, 1); assert.equal(f.state.fetches, failure === "origin" ? 0 : 1);
  }
});

test("archive read cancellation before authorization makes no DB, signing or fetch call", async () => {
  const f = await fixture(), controller = new AbortController(); controller.abort(new Error("READ_CANCELLED"));
  await assert.rejects(readAuthorizedHtmlSnapshotInspection({ ...f.input, signal: controller.signal }), /READ_CANCELLED/);
  assert.equal(f.state.reads, 0); assert.equal(f.state.signs, 0); assert.equal(f.state.fetches, 0);
});

test("process memory admission rejects concurrent archive buffering without queue and releases after failure", async () => {
  const f = await fixture(); let release!: () => void;
  const pending = new Promise<void>(resolveRead => { release = resolveRead; });
  const blockedClient = { rpc: () => ({ abortSignal: async () => { await pending; return { data: null, error: null }; } }) } as unknown as SupabaseClient;
  const first = readAuthorizedHtmlSnapshotInspection({ ...f.input, supabase: blockedClient });
  try {
    await assert.rejects(readAuthorizedHtmlSnapshotInspection(f.input), /READ_UNAVAILABLE/);
    assert.equal(f.state.reads, 0); assert.equal(f.state.signs, 0);
  } finally { release(); }
  await assert.rejects(first, /READ_UNAVAILABLE/);
  assert.equal((await readAuthorizedHtmlSnapshotInspection(f.input)).revisionId, uuid);
});

test("prepared archive RPC is service-only and checks current/historical scope without writes or compiler", () => {
  const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261009120000_read_html_editing_snapshot_archive.sql"), "utf8");
  assert.match(sql, /SECURITY DEFINER SET search_path = pg_catalog,public,private/);
  assert.match(sql, /private\.assert_html_editing_actor\(p_org,p_actor\)/);
  assert.match(sql, /id = p_revision AND organization_id = p_org AND composition_id = p_composition FOR SHARE/);
  assert.match(sql, /id = document_id AND organization_id = p_org/);
  assert.match(sql, /FROM PUBLIC,anon,authenticated/); assert.match(sql, /TO service_role/);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|CREATE TABLE)\b/i);
  assert.doesNotMatch(sql, /append_composition|read_html_editing_compilation|createSignedUrl/);
});
