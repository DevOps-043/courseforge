import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { htmlSnapshotHistoryPageSchema, type HtmlSnapshotHistoryPage } from "../composition-html-editing-snapshot-history.contract";
import { readAuthorizedHtmlSnapshotHistory } from "../composition-html-editing-snapshot-history.server";

const uuid = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const scope = { actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid };
function entry(number: number): HtmlSnapshotHistoryPage["entries"][number] {
  return { revisionId: `33333333-3333-4333-8333-${number.toString(16).padStart(12, "0")}`, revisionNumber: number,
    snapshot: true, draftId: uuid, documentHash: "a".repeat(64),
    bundlePin: { schemaVersion: 1, path: "html-editing-revisions.json", sha256: "b".repeat(64) },
    metadataStatus: "HTML_PIN_REQUIRES_BYTE_INSPECTION" };
}
function fixture() {
  const calls: Array<Record<string, unknown>> = [];
  const page: HtmlSnapshotHistoryPage = { ...scope, scope: "AUTHORIZED_HISTORY_METADATA_NOT_CONTENT_OR_EXECUTION_AUTHORITY",
    ceilingRevision: 21, entries: Array.from({ length: 20 }, (_, index) => entry(index + 1)),
    nextCursor: { ...scope, ceilingRevision: 21, afterRevision: 20 } };
  const state = { result: page as unknown, error: null as unknown };
  const supabase = { rpc: (name: string, parameters: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    assert.equal(name, "read_html_editing_snapshot_history"); signal.throwIfAborted(); calls.push(parameters);
    return { data: state.result, error: state.error };
  } }) } as unknown as SupabaseClient;
  return { calls, page, state, input: { request: { ...scope, cursor: null }, supabase } };
}

test("authorized inventory has bounded keyset pages, fixed watermark and one RPC per page", async () => {
  const f = fixture(), first = await readAuthorizedHtmlSnapshotHistory(f.input);
  assert.deepEqual(first, f.page); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.p_ceiling_revision, null); assert.equal(f.calls[0]!.p_after_revision, 0);
  f.state.result = { ...f.page, entries: [entry(21)], nextCursor: null };
  const last = await readAuthorizedHtmlSnapshotHistory({ ...f.input, request: { ...scope, cursor: first.nextCursor } });
  assert.equal(last.entries[0]!.revisionNumber, 21); assert.equal(last.nextCursor, null);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1]!.p_ceiling_revision, 21); assert.equal(f.calls[1]!.p_after_revision, 20);
});

test("unmarked and missing legacy metadata remain visible, never called compatible", async () => {
  const f = fixture(); f.state.result = { ...f.page, entries: [
    { ...entry(1), snapshot: false, bundlePin: null, draftId: null, documentHash: null, metadataStatus: "NOT_MARKED_AS_SNAPSHOT" },
    { ...entry(2), bundlePin: null, metadataStatus: "MISSING_OR_INVALID_HTML_METADATA" },
    entry(3),
  ], nextCursor: null };
  const page = await readAuthorizedHtmlSnapshotHistory(f.input);
  assert.equal(page.entries.length, 3); assert.equal(page.entries[2]!.metadataStatus, "HTML_PIN_REQUIRES_BYTE_INSPECTION");
  assert.equal("compatible" in page || "execution" in page, false);
});

test("cursor cannot switch actor, tenant, draft, composition or exceed its watermark", async () => {
  for (const key of ["actorId", "organizationId", "draftId", "compositionId"] as const) {
    const f = fixture();
    await assert.rejects(readAuthorizedHtmlSnapshotHistory({ ...f.input, request: { ...scope, cursor: { ...scope,
      ceilingRevision: 21, afterRevision: 20, [key]: other } } }), /UNAVAILABLE/);
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); await assert.rejects(readAuthorizedHtmlSnapshotHistory({ ...f.input,
    request: { ...scope, cursor: { ...scope, ceilingRevision: 1, afterRevision: 20 } } }));
  assert.equal(f.calls.length, 0);
});

test("swapped scope, ceiling drift, duplicate IDs and overlapping/reversed pages reject", async () => {
  for (const failure of ["scope", "ceiling", "duplicate", "overlap", "order", "cursor"] as const) {
    const f = fixture(), request = { ...scope, cursor: { ...scope, ceilingRevision: 21, afterRevision: 20 } };
    f.state.result = { ...f.page, entries: [entry(21)], nextCursor: null,
      ...(failure === "scope" ? { organizationId: other } : failure === "ceiling" ? { ceilingRevision: 22 }
        : failure === "duplicate" ? { entries: [entry(20), { ...entry(21), revisionId: entry(20).revisionId }] }
          : failure === "overlap" ? { entries: [entry(20)] } : failure === "order" ? { entries: [entry(21), entry(20)] }
            : { nextCursor: { ...scope, ceilingRevision: 21, afterRevision: 21 } }) };
    await assert.rejects(readAuthorizedHtmlSnapshotHistory({ ...f.input, request }), /UNAVAILABLE/);
  }
});

test("read failure, oversized response and pre-abort expose no private database content", async () => {
  const f = fixture(); f.state.error = new Error("PRIVATE_SOURCE");
  await assert.rejects(readAuthorizedHtmlSnapshotHistory(f.input), /^Error: HTML_SNAPSHOT_HISTORY_UNAVAILABLE$/);
  f.state.error = null; f.state.result = { ...f.page, privateSource: "x".repeat(65537) };
  await assert.rejects(readAuthorizedHtmlSnapshotHistory(f.input), /^Error: HTML_SNAPSHOT_HISTORY_UNAVAILABLE$/);
  const aborted = fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(readAuthorizedHtmlSnapshotHistory({ ...aborted.input, signal: controller.signal }));
  assert.equal(aborted.calls.length, 0);
});

test("metadata schema rejects false pin claims, extra authority, unknown paths and more than 20 entries", () => {
  const f = fixture();
  for (const changed of [{ ...entry(1), bundlePin: null }, { ...entry(1), snapshot: false },
    { ...entry(1), bundlePin: { ...entry(1).bundlePin, path: "../private" } },
    { ...entry(1), storageUrl: "PRIVATE" }])
    assert.equal(htmlSnapshotHistoryPageSchema.safeParse({ ...f.page, entries: [changed], nextCursor: null }).success, false);
  assert.equal(htmlSnapshotHistoryPageSchema.safeParse({ ...f.page, entries: Array.from({ length: 21 }, (_, index) => entry(index + 1)) }).success, false);
});

test("prepared inventory SQL is service-only, bounded and does not mutate or execute historical content (static)", () => {
  const sql = readFileSync(resolve(process.cwd(), "../../supabase/migrations/20261009110000_read_html_editing_snapshot_history.sql"), "utf8");
  assert.match(sql, /^-- PREPARED ONLY/); assert.match(sql, /private\.assert_html_editing_actor\(p_org,p_actor\)/);
  assert.match(sql, /composition_id = p_composition AND state = 'ACTIVE' FOR SHARE/);
  assert.match(sql, /ORDER BY revision_number ASC LIMIT 21/);
  assert.match(sql, /revision_number > p_after_revision AND revision_number <= ceiling_revision/);
  assert.match(sql, /FROM PUBLIC,anon,authenticated/); assert.match(sql, /TO service_role/);
  assert.doesNotMatch(sql, /INSERT INTO|UPDATE public|DELETE FROM|read_html_editing_compilation|commit_html|CREATE OR REPLACE/);
});
