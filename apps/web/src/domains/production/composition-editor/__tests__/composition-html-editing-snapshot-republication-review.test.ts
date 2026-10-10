import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { freezeCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-bundle.server";
import { readAuthorizedHtmlSnapshotRepublicationReview } from "../composition-html-editing-snapshot-republication-review.server";
import { consultHtmlSnapshotRepublicationReview } from "../composition-html-editing-snapshot-republication-review.client";
import { createHtmlSnapshotRepublicationReviewHandler } from "../http/composition-html-editing-snapshot-republication-review-handler.server";
import { htmlSnapshotRepublicationReviewSchema } from "../composition-html-editing-snapshot-republication-review.contract";

const origin = "https://storage.example.test", path = "html-editing-revisions.json";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
async function fixture(kind: "v1" | "old" | "current" = "v1", tamperSource = false) {
  const input = createHtmlEditingRevisionFixture(), native = bindHtmlEditingRevisionToComposition({ ...input.authority,
    document: input.document, revision: input.next.revision, revisionSha256: input.next.sha256 });
  const saved = { document: native.document, documentHash: native.documentHash,
    revisions: [{ authoritativeBinding: input.authority.authoritativeBinding, revision: input.next.revision, grantedAssetIds: input.authority.grantedAssetIds }] };
  const frozen = freezeCompositionHtmlEditingSnapshot({ document: native.document, context: {
    organizationId: uuid, documentId: uuid, documentHash: native.documentHash,
    revisions: [{ ...input.authority, encodedRevision: JSON.stringify(input.next.revision) }],
  } });
  const stored = JSON.parse(frozen.encodedBundle);
  if (kind === "v1") { delete stored.compilation; stored.schemaVersion = 1; stored.format = "courseforge-html-editable-snapshot-bundle-v1"; }
  if (kind === "old") stored.compilation.profile.geometryVersion = "prior-geometry";
  if (tamperSource) stored.revisions[0].sourceHtml += "<p>Unregistered source</p>";
  const encodedBundle = JSON.stringify(stored), zip = new JSZip(); zip.file(path, encodedBundle);
  const archiveBytes = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  const request = { actorId: uuid, organizationId: uuid, compositionId: uuid, draftId: uuid, revisionId: uuid };
  const identity = { ...request, scope: "AUTHORIZED_HISTORICAL_HTML_ARCHIVE_READ_ONLY", documentId: uuid,
    documentHash: native.documentHash, projectHash: digest(archiveBytes), archiveBytes: archiveBytes.length,
    storageBucket: "production-assets", storagePath: `composition-snapshots/${uuid}/${uuid}/${digest(archiveBytes)}.zip`,
    bundlePin: { schemaVersion: 1, path, sha256: digest(encodedBundle) } };
  const state = { archiveReads: 0, exactReads: 0, signs: 0, first: saved as unknown, second: saved as unknown,
    finalIdentity: identity as unknown, cancelExactRead: null as AbortController | null };
  const supabase = {
    rpc: (name: string, parameters: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
      signal.throwIfAborted();
      if (name === "read_html_editing_snapshot_archive") {
        state.archiveReads++; return { data: state.archiveReads === 1 ? identity : state.finalIdentity, error: null };
      }
      assert.equal(name, "read_html_editing_compilation"); state.exactReads++;
      assert.equal(parameters.p_document_hash, native.documentHash); assert.equal(parameters.p_draft_id, uuid);
      assert.equal(parameters.p_actor_id, uuid); assert.equal(parameters.p_organization_id, uuid);
      state.cancelExactRead?.abort(new Error("REVIEW_CANCELLED"));
      return { data: state.exactReads === 1 ? state.first : state.second, error: null };
    } }),
    storage: { from: () => ({ createSignedUrl: async () => {
      state.signs++; return { data: { signedUrl: `${origin}/storage/v1/object/sign/production-assets/${identity.storagePath}?token=private` }, error: null };
    } }) },
  } as unknown as SupabaseClient;
  const fetchResource = (async () => new Response(new Uint8Array(archiveBytes), { headers: { "content-type": "application/zip" } })) as typeof fetch;
  return { saved, state, identity, request, frozen, input: { request, supabase, storageOrigin: origin, fetchResource } };
}

test("historical review prepares separate candidate from exact saved pointers, rechecks authority and never activates", async () => {
  for (const kind of ["v1", "old"] as const) {
    const f = await fixture(kind), original = JSON.stringify(f.saved), review = await readAuthorizedHtmlSnapshotRepublicationReview(f.input);
    assert.equal(review.scope, "PREPARED_HISTORICAL_HTML_REVIEW_NOT_APPROVED_OR_PUBLISHED");
    assert.equal(review.publicationMode, "HISTORICAL_REVISION_WITHOUT_ACTIVATION_OR_DRAFT_CHANGE");
    assert.equal(review.originalBundleSha256, f.identity.bundlePin.sha256); assert.equal(review.candidateBundleSha256, f.frozen.sha256);
    assert.equal(review.comparisons[0]!.status, kind === "v1" ? "NO_PRIOR_OUTPUT_PIN" : "OUTPUT_PIN_EQUAL");
    assert.equal(f.state.exactReads, 2); assert.equal(f.state.archiveReads, 2); assert.equal(f.state.signs, 1);
    assert.equal(JSON.stringify(f.saved), original);
    assert.equal("bundle" in review || "sourceHtml" in review || "grantedAssetIds" in review || "activeRevisionId" in review, false);
  }
});

test("current profiles are not silently offered historical republication; forged archived source is rejected", async () => {
  const current = await fixture("current");
  await assert.rejects(readAuthorizedHtmlSnapshotRepublicationReview(current.input), /REVIEW_UNAVAILABLE/);
  assert.equal(current.state.exactReads, 0);
  const tampered = await fixture("v1", true);
  await assert.rejects(readAuthorizedHtmlSnapshotRepublicationReview(tampered.input), /REVIEW_UNAVAILABLE/);
});

test("review rejects stale native, replaced revisions and grant revocation during current-profile preparation", async () => {
  for (const failure of ["native", "revision", "grant"] as const) {
    const f = await fixture();
    f.state.second = failure === "native" ? { ...f.saved, documentHash: "f".repeat(64) }
      : { ...f.saved, revisions: [{ ...f.saved.revisions[0], ...(failure === "revision"
        ? { revision: { ...f.saved.revisions[0]!.revision, version: 999 } } : { grantedAssetIds: [] }) }] };
    await assert.rejects(readAuthorizedHtmlSnapshotRepublicationReview(f.input), /^Error: HTML_SNAPSHOT_REPUBLICATION_REVIEW_UNAVAILABLE$/);
    assert.equal(f.state.exactReads, 2);
  }
});

test("final archive reauthorization and cancellation discard preparation without exposing source", async () => {
  const changed = await fixture(); changed.state.finalIdentity = { ...changed.identity, documentHash: "f".repeat(64) };
  await assert.rejects(readAuthorizedHtmlSnapshotRepublicationReview(changed.input), /REVIEW_UNAVAILABLE/);
  assert.equal(changed.state.archiveReads, 2);
  const cancelled = await fixture(), controller = new AbortController(); cancelled.state.cancelExactRead = controller;
  await assert.rejects(readAuthorizedHtmlSnapshotRepublicationReview({ ...cancelled.input, signal: controller.signal }), /REVIEW_CANCELLED/);
});

test("review schema never treats equal output pins as visual approval or permits activation", async () => {
  const f = await fixture("old"), review = await readAuthorizedHtmlSnapshotRepublicationReview(f.input);
  assert.equal(htmlSnapshotRepublicationReviewSchema.safeParse({ ...review, publicationMode: "ACTIVATE" }).success, false);
  assert.equal(htmlSnapshotRepublicationReviewSchema.safeParse({ ...review, approved: true }).success, false);
  assert.equal(htmlSnapshotRepublicationReviewSchema.safeParse({ ...review, requiredReviews: [] }).success, false);
  assert.equal(htmlSnapshotRepublicationReviewSchema.safeParse({ ...review, comparisons: [{ ...review.comparisons[0], status: "OUTPUT_PIN_CHANGED" }] }).success, false);
});

test("review client is bounded/correlated/owner-scoped, sends one GET and never accepts private candidate bytes", async () => {
  const f = await fixture(), review = await readAuthorizedHtmlSnapshotRepublicationReview(f.input);
  for (const failure of ["none", "owner", "correlation", "source", "size"] as const) {
    let calls = 0;
    const fetcher = (async (url: string, options: RequestInit) => {
      calls++; assert.match(url, /\/html-snapshot-history\/[^/]+\/review\?compositionId=/);
      assert.equal(options.method, "GET"); assert.equal(options.credentials, "same-origin"); assert.equal(options.redirect, "error");
      return Response.json({ success: true, requestId: uuid, correlationId: failure === "correlation" ? other : uuid,
        data: { ...review, ...(failure === "owner" ? { actorId: other } : failure === "source" ? { encodedBundle: "private" }
          : failure === "size" ? { encodedBundle: "a".repeat(140 * 1024) } : {}) } });
    }) as typeof fetch;
    const input = { request: f.request, signal: new AbortController().signal, fetcher };
    if (failure === "none") assert.deepEqual(await consultHtmlSnapshotRepublicationReview(input), review);
    else await assert.rejects(consultHtmlSnapshotRepublicationReview(input), /REVIEW_UNAVAILABLE/);
    assert.equal(calls, 1);
  }
});

test("review HTTP derives scope from session, reuses quota security and rejects browser approval intent", async () => {
  const f = await fixture(), review = await readAuthorizedHtmlSnapshotRepublicationReview(f.input);
  let reads = 0;
  const client = { rpc: (name: string) => ({ abortSignal: async () => {
    assert.equal(name, "consume_api_rate_limit"); return { data: [{ allowed: true, reset_at: "2026-10-09T00:00:00Z" }], error: null };
  } }) } as unknown as SupabaseClient;
  const handle = createHtmlSnapshotRepublicationReviewHandler({ enabled: () => true,
    authenticate: async () => ({ actorId: uuid, tenant: { userId: uuid, organizationId: uuid, platformRole: "ADMIN" } }),
    serviceClient: () => client, read: async (_client, request) => { reads++; assert.deepEqual(request, f.request); return review; },
  });
  const url = `https://app.test/review?compositionId=${uuid}`, params = { draftId: uuid, revisionId: uuid };
  const response = await handle(new Request(url), params);
  assert.equal(response.status, 200); assert.match(response.headers.get("cache-control")!, /no-store/);
  assert.deepEqual((await response.json()).data, review);
  assert.equal((await handle(new Request(`${url}&approved=true`), params)).status, 400);
  assert.equal((await handle(new Request(url, { method: "POST" }), params)).status, 405);
  assert.equal((await handle(new Request(url, { headers: { origin: "https://attacker.test" } }), params)).status, 403);
  assert.equal(reads, 1);
});
