import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import sharp from "sharp";
import { load } from "cheerio";
import type { SupabaseClient } from "@supabase/supabase-js";
import { prepareCompositionHtmlEditingPreviewResources, readCompositionHtmlEditingPreviewPortfolio } from "../composition-html-editing-preview-resources.server";
import { prepareCompositionHtmlEditingSecurePreview } from "../composition-html-editing-preview-secure.server";
import { issueHtmlPreviewResourceCapability, type HtmlPreviewResourceClaims } from "../composition-html-editing-preview-capability.server";
import { deliverCompositionHtmlEditingPreviewResource } from "../composition-html-editing-preview-delivery.server";
import { htmlPreviewDeliveryBudget } from "../composition-html-editing-preview-delivery-budget.server";
import { prepareCompositionHtmlEditingPreviewPage } from "../composition-html-editing-preview-page.server";
import { verifyHtmlPreviewResourceCapability } from "../composition-html-editing-preview-capability.server";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { hashCompositionDocument } from "../composition-document.service";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { computeHtmlEditableManifestSha256 } from "../html-editing/html-editing-manifest-digest.server";
import { verifyHtmlEditingRevision, prepareHtmlEditingRevisionCommand } from "../html-editing/html-editing-revision.server";
import { HTML_EDITING_PREVIEW_RESOURCE_POLICY } from "../composition-html-editing-preview-inventory.server";
import type { PublishedHtmlPreviewBinding } from "../composition-html-editing-published-preview.server";

const origin = "https://storage.example.test";
test("published bundle pin is checked before signing/downloading, and matches throughout preparation", async () => {
  const f = await fixture();
  const portfolio = await readCompositionHtmlEditingPreviewPortfolio(f.input);
  const publishedBinding: PublishedHtmlPreviewBinding = {
    expectedFrozenBundleSha256: portfolio.snapshot.bundle.sha256,
    mediaBindings: portfolio.inventory.entries.filter(entry => entry.kind === "MEDIA").map(entry => ({
      assetId: entry.localPath.slice("conformance-media/".length), localPath: entry.localPath, ...entry.identity,
    })),
    fontManifest: [{ fontAssetId: f.font.id, family: f.font.family, checksumSha256: f.font.checksum_sha256,
      fileSizeBytes: f.font.file_size_bytes, mimeType: "font/woff2" }],
  };
  for (const change of ["media", "storage", "font", "missing"] as const) {
    const binding = structuredClone(publishedBinding);
    if (change === "media") binding.mediaBindings[0]!.checksum = "f".repeat(64);
    else if (change === "storage") binding.mediaBindings[0]!.storagePath = "relinked.png";
    else if (change === "font") binding.fontManifest[0]!.checksumSha256 = "f".repeat(64);
    else binding.mediaBindings.pop();
    await assert.rejects(prepareCompositionHtmlEditingPreviewResources({ ...f.input, publishedBinding: binding }), /RESOURCES_UNAVAILABLE/);
    assert.equal(f.state.fetches, 0); assert.equal(f.state.signs, 0);
  }
  for (const expectedFrozenBundleSha256 of ["f".repeat(64), "invalid"]) {
    await assert.rejects(prepareCompositionHtmlEditingPreviewResources({ ...f.input,
      publishedBinding: { ...publishedBinding, expectedFrozenBundleSha256 } }), /RESOURCES_UNAVAILABLE/);
    assert.equal(f.state.fetches, 0); assert.equal(f.state.signs, 0);
  }
  const prepared = await prepareCompositionHtmlEditingPreviewResources({ ...f.input,
    publishedBinding });
  try { assert.equal(prepared.bundle.sha256, portfolio.snapshot.bundle.sha256); }
  finally { await prepared.dispose(); }
});
const fontId = "70000000-0000-4000-8000-000000000001";
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
async function fixture(sharedMedia = false) {
  const template = createHtmlEditingRevisionFixture();
  const originalMedia = template.document.clips[1]!;
  if (originalMedia.source.type !== "PRODUCTION_ASSET") throw new Error();
  if (sharedMedia) { originalMedia.source.productionAssetId = uuid; originalMedia.kind = "IMAGE"; }
  const nativeId = originalMedia.source.productionAssetId;
  const overlay = createCompositionNativeOverlay({ document: template.document, id: "font-text", kind: "TEXT", playheadSeconds: 0 });
  if (overlay.clip.source.type !== "NATIVE_TEXT") throw new Error();
  overlay.clip.source.style.fontAssetId = fontId; overlay.clip.source.style.fontFamily = "Pinned Font";
  if (overlay.track) template.document.tracks.push(overlay.track);
  template.document.clips.push(overlay.clip); template.document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  const binding = { ...template.authority.authoritativeBinding, documentSha256: hashCompositionDocument(template.document) };
  const revision = structuredClone(template.current.revision);
  revision.manifest.binding = binding; revision.state.binding = binding;
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(revision.manifest), binding);
  const authority = { ...template.authority, authoritativeBinding: binding };
  const initialRevision = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(revision) });
  const verified = prepareHtmlEditingRevisionCommand({ ...authority, encodedRevision: JSON.stringify(initialRevision.revision),
    expected: { version: initialRevision.revision.version, sha256: initialRevision.sha256 },
    encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding,
      overrides: [{ operation: "SET_TEXT", elementId: "title", value: "Unified preview text" }] }),
  }).next;
  const native = bindHtmlEditingRevisionToComposition({ ...authority, document: template.document,
    revision: verified.revision, revisionSha256: verified.sha256 });
  const png = new Uint8Array(await sharp({ create: { width: 2, height: 2, channels: 3, background: "#123456" } }).png().toBuffer());
  const video = new Uint8Array([1, 2, 3, 4]), fontBytes = new Uint8Array([5, 6, 7, 8]);
  const image = { id: uuid, organization_id: uuid, checksum: hash(png), file_size_bytes: png.length, mime_type: "image/png",
    storage_bucket: "production-assets", storage_path: "html/image.png", qa_status: "APPROVED", public_url: null };
  const media = sharedMedia ? image : { ...image, id: nativeId, checksum: hash(video), file_size_bytes: video.length,
    mime_type: "video/mp4", storage_path: "native/video.mp4" };
  const font = { id: fontId, family: "Pinned Font", source: "uploaded", status: "READY", checksum_sha256: hash(fontBytes),
    mime_type: "font/woff2", file_size_bytes: fontBytes.length, storage_bucket: "organization-fonts", storage_path: "fonts/pinned.woff2" };
  const state = { rpcReads: 0, fetches: 0, signs: 0, change: "", changeAt: 3, fetchedPaths: [] as string[] };
  const rpc = () => ({ abortSignal: async () => {
    state.rpcReads++;
    return { error: null, data: { document: native.document, documentHash: native.documentHash,
      revisions: [{ authoritativeBinding: binding, revision: verified.revision,
        grantedAssetIds: state.change === "revoked" && state.rpcReads >= state.changeAt ? [] : [uuid, other] }] } };
  } });
  const from = (table: string) => {
    let selected = "", ids: string[] = [], dependency = false;
    const result = () => {
      if (table === "video_composition_draft_assets") return { error: null, data: dependency ? []
        : ids.map(id => ({ organization_id: uuid, draft_id: uuid, production_asset_id: id })) };
      if (table === "organization_slide_fonts") {
        const row = { ...font };
        if (state.rpcReads >= state.changeAt && state.change === "font") row.checksum_sha256 = "f".repeat(64);
        return { error: null, data: [row] };
      }
      assert.equal(table, "production_assets");
      const rows = [image, ...(sharedMedia ? [] : [media])].filter(row => ids.includes(row.id)).map(row => {
        const current = { ...row };
        if (row.id === nativeId && state.rpcReads >= state.changeAt && state.change === "native") current.storage_path = "native/replaced.mp4";
        if (selected.includes("public_url") && state.change === "conflict" && row.id === uuid) current.checksum = "f".repeat(64);
        return Object.fromEntries(selected.split(",").map(column => [column, current[column as keyof typeof current]]));
      });
      return { error: null, data: rows };
    };
    const query = { select: (columns: string) => { selected = columns; return query; },
      eq: (field: string, value: string) => {
        if (field === "organization_id" || field === "draft_id") assert.equal(value, uuid);
        if (field === "source_reference") { assert.equal(value, "DECK_DEPENDENCY"); dependency = true; }
        return query;
      }, in: (_field: string, values: string[]) => { ids = values; return query; }, limit: () => query,
      abortSignal: async () => result(), then: (resolve: (value: ReturnType<typeof result>) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  };
  const supabase = { rpc, from, storage: { from: (bucket: string) => ({ createSignedUrl: async (path: string) => {
    state.signs++;
    return { error: null, data: { signedUrl: `${origin}/storage/v1/object/sign/${bucket}/${path}?token=private` } };
  } }) } } as unknown as SupabaseClient;
  const fetchResource = (async (url: URL) => {
    state.fetches++; state.fetchedPaths.push(url.pathname);
    const resource = url.pathname.endsWith("image.png") ? { bytes: png, mime: "image/png" }
      : url.pathname.endsWith("video.mp4") ? { bytes: video, mime: "video/mp4" } : { bytes: fontBytes, mime: "font/woff2" };
    return new Response(resource.bytes, { headers: { "content-type": resource.mime, "content-length": String(resource.bytes.length) } });
  }) as typeof fetch;
  return { image, media, font, state, input: { actorId: uuid, organizationId: uuid, documentId: uuid,
    documentHash: native.documentHash, supabase, storageOrigin: origin, fetchResource, previewGeneration: 1 } };
}

test("joint preparation authorizes exact HTML, acquires image/native/font once and compiles edited source with local bindings", async () => {
  const f = await fixture(), prepared = await prepareCompositionHtmlEditingPreviewResources(f.input);
  const files = [...prepared.resources.values()];
  try {
    assert.equal(prepared.resources.size, 3); assert.equal(f.state.fetches, 3); assert.equal(f.state.rpcReads, 3);
    assert.ok(prepared.previewHtml.includes(`conformance-media/${uuid}`));
    assert.equal(load(prepared.previewHtml)("#title").text(), "Unified preview text");
    assert.ok(prepared.previewHtml.includes(`assets/fonts/${f.font.checksum_sha256}.woff2`));
    assert.ok(!prepared.previewHtml.includes("token=private"));
    assert.equal(prepared.context.documentHash, f.input.documentHash);
    assert.equal(prepared.scope, "AUTHORIZED_COMPILED_LOCAL_PREVIEW_RESOURCES_NOT_BROWSER_DELIVERY_OR_RENDER_EVIDENCE");
  } finally { prepared.resources.clear(); await Promise.all([prepared.dispose(), prepared.dispose()]); }
  for (const file of files) await assert.rejects(access(file.filePath), { code: "ENOENT" });
});

test("HTML/native references to the same production image share one verified file instead of duplicate acquisition", async () => {
  const f = await fixture(true), prepared = await prepareCompositionHtmlEditingPreviewResources(f.input);
  try {
    assert.equal(f.state.fetches, 2); assert.equal(prepared.resources.size, 2);
    assert.equal(f.state.fetchedPaths.filter(path => path.endsWith("image.png")).length, 1);
  } finally { await prepared.dispose(); }
});

test("fresh revocation and native/font drift after compile prevent returning a prepared preview", async () => {
  for (const change of ["revoked", "native", "font"]) {
    const f = await fixture(); f.state.change = change;
    await assert.rejects(prepareCompositionHtmlEditingPreviewResources(f.input), /^HtmlEditingPreviewResourcesError: HTML_EDITING_PREVIEW_RESOURCES_UNAVAILABLE$/);
    assert.equal(f.state.rpcReads, 3); assert.equal(f.state.fetches, 3);
  }
});

test("combined disk budget and conflicting shared identities reject before any Storage signature or fetch", async () => {
  const excessive = await fixture(); excessive.media.file_size_bytes = HTML_EDITING_PREVIEW_RESOURCE_POLICY.totalBytes;
  await assert.rejects(prepareCompositionHtmlEditingPreviewResources(excessive.input));
  assert.equal(excessive.state.signs, 0);
  const conflict = await fixture(true); conflict.state.change = "conflict";
  await assert.rejects(prepareCompositionHtmlEditingPreviewResources(conflict.input));
  assert.equal(conflict.state.signs, 0);
  const aborted = await fixture(), controller = new AbortController(); controller.abort();
  await assert.rejects(prepareCompositionHtmlEditingPreviewResources({ ...aborted.input, signal: controller.signal }));
  assert.equal(aborted.state.rpcReads, 0);
});

test("secure preparation pins runtime before acquisition and mounts after the exact portfolio is reauthorized", async () => {
  const invalid = await fixture();
  await assert.rejects(prepareCompositionHtmlEditingSecurePreview({ ...invalid.input, previewGeneration: 1,
    parentOrigin: "https://app.example.test/path", runtimeWebRoot: process.cwd() }), /PARENT_ORIGIN_INVALID/);
  assert.equal(invalid.state.rpcReads, 0); assert.equal(invalid.state.signs, 0);
  const missing = await fixture();
  await assert.rejects(prepareCompositionHtmlEditingSecurePreview({ ...missing.input,
    previewGeneration: 1, parentOrigin: "https://app.example.test", runtimeWebRoot: "missing-html-preview-package" }), /RUNTIME_UNAVAILABLE/);
  assert.equal(missing.state.rpcReads, 0); assert.equal(missing.state.signs, 0);
  const f = await fixture();
  const prepared = await prepareCompositionHtmlEditingSecurePreview({ ...f.input, previewGeneration: 1,
    parentOrigin: "https://app.example.test", runtimeWebRoot: process.cwd() });
  const files = [...prepared.resources.values()];
  try {
    assert.equal(f.state.rpcReads, 3); assert.equal(f.state.fetches, 3);
    assert.equal(prepared.session.documentHash, f.input.documentHash);
    assert.equal(prepared.session.previewGeneration, 1);
    assert.equal(load(prepared.previewHtml)("#title").text(), "Unified preview text");
    assert.match(prepared.previewHtml, /__courseforgeHtmlPreviewBridge\.attach/);
    assert.match(prepared.contentSecurityPolicy, /sandbox allow-scripts/);
    assert.ok(!prepared.previewHtml.includes("token=private"));
    assert.equal(prepared.scope, "AUTHORIZED_SECURE_LOCAL_PREVIEW_NOT_BROWSER_DELIVERY_OR_RENDER_EVIDENCE");
  } finally { await prepared.dispose(); }
  for (const file of files) await assert.rejects(access(file.filePath), { code: "ENOENT" });
});

test("binary delivery selects only the signed exact resource and reauthorizes revocation/drift before serving", async () => {
  for (const change of ["", "revoked", "native", "font", "expired"]) {
    const f = await fixture(), prepared = await prepareCompositionHtmlEditingPreviewResources(f.input);
    const resource = prepared.inventory.entries.find(entry => entry.identity.mimeType === "video/mp4")!;
    const key = new Uint8Array(32).fill(19), audience = "https://app.example.test";
    const claims: HtmlPreviewResourceClaims = { format: "courseforge-html-preview-resource-v1", actorId: uuid,
      organizationId: uuid, documentId: uuid, session: { version: 1, nonce: "a".repeat(64), documentHash: f.input.documentHash, previewGeneration: 1 },
      audience, bundleSha256: prepared.bundle.sha256, inventoryFingerprint: prepared.inventory.fingerprint,
      localPath: resource.localPath, checksum: resource.identity.checksum, fileSizeBytes: resource.identity.fileSizeBytes,
      mimeType: resource.identity.mimeType, issuedAt: 100, expiresAt: 280 };
    await prepared.dispose();
    f.state.rpcReads = 0; f.state.fetches = 0; f.state.change = change; f.state.changeAt = 2;
    const deliveryInput = { token: issueHtmlPreviewResourceCapability(claims, key), key, audience, documentId: uuid,
      range: "bytes=1-2", supabase: f.input.supabase, storageOrigin: origin, fetchResource: f.input.fetchResource,
      consumeQuota: async () => true, nowSeconds: () => change === "expired" && f.state.rpcReads >= 2 ? 280 : 100 };
    if (change) await assert.rejects(deliverCompositionHtmlEditingPreviewResource(deliveryInput));
    else {
      const response = await deliverCompositionHtmlEditingPreviewResource(deliveryInput);
      assert.equal(response.status, 206); assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([2, 3]));
    }
    assert.equal(f.state.rpcReads, 2); assert.equal(f.state.fetches, 1);
    assert.deepEqual(htmlPreviewDeliveryBudget.state(), { reads: 0, bytes: 0 });
    // A denied quota has no portfolio read, signature or acquisition.
    f.state.rpcReads = 0; f.state.fetches = 0;
    await assert.rejects(deliverCompositionHtmlEditingPreviewResource({ ...deliveryInput, consumeQuota: async () => false }));
    assert.equal(f.state.rpcReads, 0); assert.equal(f.state.fetches, 0);
  }
});

test("page issuer binds real edited HTML and fonts to exact capabilities without changing the native document or scripts", async () => {
  const f = await fixture(), deliveryKey = new Uint8Array(32).fill(17), audience = "https://app.example.test";
  const page = await prepareCompositionHtmlEditingPreviewPage({ ...f.input, previewGeneration: 1,
    runtimeWebRoot: process.cwd(), parentOrigin: audience, deliveryKey, nowSeconds: () => 100 });
  const html = load(page.html);
  assert.equal(html("#title").text(), "Unified preview text");
  assert.equal(page.session.documentHash, f.input.documentHash);
  const source = html("video").first().attr("src")!;
  const url = new URL(source), cap = url.searchParams.get("cap")!;
  const claims = verifyHtmlPreviewResourceCapability({ token: cap, key: deliveryKey, audience, documentId: uuid, nowSeconds: 100 });
  assert.equal(claims.mimeType, "video/mp4"); assert.equal(claims.session.documentHash, f.input.documentHash);
  assert.equal(claims.checksum, f.media.checksum); assert.equal(claims.localPath, `conformance-media/${f.media.id}`);
  assert.equal(url.pathname, `/api/production/hyperframes/drafts/${uuid}/html-preview/resources`);
  assert.match(html("style").text(), /src: url\("https:\/\/app\.example\.test\/api\/production\/hyperframes\/drafts/);
  assert.doesNotMatch(page.contentSecurityPolicy, /'unsafe-inline'|allow-same-origin|cap=/);
  const bootstrap = html("script").filter((_index, element) => (html(element).html() ?? "").startsWith("window.__courseforgeHtmlPreviewBridge.setResources("));
  assert.equal(bootstrap.length, 1);
  const bootstrapSource = bootstrap.html()!;
  assert.deepEqual(JSON.parse(bootstrapSource.slice("window.__courseforgeHtmlPreviewBridge.setResources(".length, -2)), page.resourceRenewal);
  assert.ok(page.contentSecurityPolicy.includes(`'sha256-${createHash("sha256").update(bootstrapSource).digest("base64")}'`));
  assert.ok(!page.html.includes("token=private"));
  assert.equal(f.state.rpcReads, 3);
  f.state.rpcReads = 0;
  const response = await deliverCompositionHtmlEditingPreviewResource({ token: cap, key: deliveryKey, audience,
    documentId: uuid, range: "bytes=1-2", supabase: f.input.supabase, storageOrigin: origin,
    fetchResource: f.input.fetchResource, consumeQuota: async () => true, nowSeconds: () => 100 });
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array([2, 3]));
});

test("joint page preparation shares delivery admission and fails before signatures under backpressure", async () => {
  const f = await fixture(), releases = Array.from({ length: 4 }, () => htmlPreviewDeliveryBudget.reserve(0));
  try {
    await assert.rejects(prepareCompositionHtmlEditingPreviewResources(f.input), /RESOURCES_UNAVAILABLE/);
    assert.equal(f.state.signs, 0); assert.equal(f.state.fetches, 0); assert.equal(f.state.rpcReads, 1);
    assert.deepEqual(htmlPreviewDeliveryBudget.state(), { reads: 4, bytes: 0 });
  } finally { releases.forEach(release => release()); }
  assert.deepEqual(htmlPreviewDeliveryBudget.state(), { reads: 0, bytes: 0 });
});

test("resource renewal issues fresh capabilities for the same exact session and rejects current revocation before signing", async () => {
  const f = await fixture(), deliveryKey = new Uint8Array(32).fill(17), audience = "https://app.example.test";
  const input = { ...f.input, previewGeneration: 1, runtimeWebRoot: process.cwd(), parentOrigin: audience, deliveryKey };
  const initial = await prepareCompositionHtmlEditingPreviewPage({ ...input, nowSeconds: () => 100 });
  const renewed = await prepareCompositionHtmlEditingPreviewPage({ ...input, session: initial.session, nowSeconds: () => 250 });
  assert.deepEqual(renewed.session, initial.session);
  assert.equal(renewed.resourceRenewal.bundleSha256, initial.resourceRenewal.bundleSha256);
  assert.equal(renewed.resourceRenewal.inventoryFingerprint, initial.resourceRenewal.inventoryFingerprint);
  assert.equal(renewed.resourceRenewal.expiresAt, 430);
  const firstUrl = initial.resourceRenewal.resources[0]!.url, renewedUrl = renewed.resourceRenewal.resources[0]!.url;
  assert.notEqual(firstUrl, renewedUrl);
  const token = (url: string) => new URL(url).searchParams.get("cap")!;
  assert.throws(() => verifyHtmlPreviewResourceCapability({ token: token(firstUrl), key: deliveryKey, audience,
    documentId: uuid, nowSeconds: 281 }));
  const claims = verifyHtmlPreviewResourceCapability({ token: token(renewedUrl), key: deliveryKey, audience, documentId: uuid, nowSeconds: 281 });
  assert.deepEqual(claims.session, initial.session); assert.equal(claims.issuedAt, 250);
  assert.deepEqual(htmlPreviewDeliveryBudget.state(), { reads: 0, bytes: 0 });
  f.state.change = "revoked"; f.state.changeAt = 1; f.state.rpcReads = 0; f.state.signs = 0; f.state.fetches = 0;
  await assert.rejects(prepareCompositionHtmlEditingPreviewPage({ ...input, session: initial.session, nowSeconds: () => 400 }));
  assert.equal(f.state.signs, 0); assert.equal(f.state.fetches, 0);
});

test("issuer never returns capabilities expired during final cleanup or after a clock rollback", async () => {
  for (const completedAt of [280, 99]) {
    const f = await fixture(); let clockReads = 0;
    await assert.rejects(prepareCompositionHtmlEditingPreviewPage({ ...f.input, previewGeneration: 1,
      runtimeWebRoot: process.cwd(), parentOrigin: "https://app.example.test", deliveryKey: new Uint8Array(32).fill(17),
      nowSeconds: () => ++clockReads === 1 ? 100 : completedAt }), /EXPIRED_DURING_PREPARATION/);
    assert.deepEqual(htmlPreviewDeliveryBudget.state(), { reads: 0, bytes: 0 });
  }
});
