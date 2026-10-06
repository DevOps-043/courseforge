import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { load } from "cheerio";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import type { HtmlEditableManifest, HtmlEditingSetOverride } from "./html-editing.contract";
import { HTML_EDITING_REVISION_POLICY, HtmlEditingRevisionError, type HtmlEditingRevision } from "./html-editing-revision.contract";
import { prepareHtmlEditingRevisionCommand, prepareHtmlEditingRevisionRestore, verifyHtmlEditingRevision } from "./html-editing-revision.server";
import { HtmlEditingRevisionGateway, type HtmlEditingRevisionRepository } from "./html-editing-revision-gateway.server";

const uuid = "11111111-1111-4111-8111-111111111111";
const other = "22222222-2222-4222-8222-222222222222";
function fixture(overrides: HtmlEditingSetOverride[] = [], version = 1) {
  const sourceHtml = `<section><h1 id="title">Original</h1><img id="image" src="conformance-media/${uuid}"></section>`;
  const binding = {
    organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64),
    clipId: "intro", templateId: "intro", templateVersion: 1,
    sourceSha256: createHash("sha256").update(sourceHtml).digest("hex"), manifestSha256: "0".repeat(64),
  };
  const manifest: HtmlEditableManifest = { format: "courseforge-html-editable-manifest-v1", binding, elements: [
    { kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 100, multiline: false },
    { kind: "IMAGE", elementId: "image", label: "Image", allowedAssetIds: [uuid, other], allowedFits: ["COVER"] },
  ] };
  binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), binding);
  const revision: HtmlEditingRevision = {
    format: "courseforge-html-editable-revision-v1", version, sourceHtml, manifest,
    state: { format: "courseforge-html-editable-override-state-v1", binding, overrides },
  };
  const authority = { authoritativeBinding: binding, grantedAssetIds: [uuid, other],
    imageSources: new Map([[uuid, `conformance-media/${uuid}`], [other, `conformance-media/${other}`]]), encodedRevision: JSON.stringify(revision) };
  const verified = verifyHtmlEditingRevision(authority);
  return { authority, revision, expected: { version, sha256: verified.sha256 },
    command: (values: unknown[]) => JSON.stringify({ format: "courseforge-html-editable-command-v1", binding, overrides: values }),
    request: { actorId: uuid, expectedCompositionDocumentHash: "b".repeat(64),
      scope: { organizationId: uuid, documentId: uuid, clipId: "intro" } } };
}
const text = { operation: "SET_TEXT", elementId: "title", value: "Changed" } as const;

test("versioned revision covers all source, manifest, state and version; object formatting is immaterial", () => {
  const input = fixture();
  const reference = verifyHtmlEditingRevision(input.authority);
  const formatted = verifyHtmlEditingRevision({ ...input.authority, encodedRevision: JSON.stringify(input.revision, null, 2) });
  assert.equal(reference.sha256, formatted.sha256);
  const version = verifyHtmlEditingRevision({ ...input.authority, encodedRevision: JSON.stringify({ ...input.revision, version: 2 }) });
  assert.notEqual(version.sha256, reference.sha256);
  const changed = fixture([text]);
  assert.notEqual(verifyHtmlEditingRevision(changed.authority).sha256, reference.sha256);
  assert.equal(reference.revision.manifest.binding.documentSha256, "a".repeat(64));
});

test("command prepares immutable before/after at a new revision with complete content hash", () => {
  const input = fixture();
  const before = input.authority.encodedRevision;
  const result = prepareHtmlEditingRevisionCommand({ ...input.authority, expected: input.expected, encodedCommand: input.command([text]) });
  assert.equal(result.changed, true);
  assert.equal(result.before.version, 1);
  assert.equal(result.next.revision.version, 2);
  assert.equal(result.before.sourceHtml, result.next.revision.sourceHtml);
  assert.deepEqual(result.before.manifest, result.next.revision.manifest);
  assert.notEqual(result.next.sha256, input.expected.sha256);
  assert.equal(load(result.next.compiled.html)("#title").text(), "Changed");
  assert.equal(input.authority.encodedRevision, before);
  result.before.state.overrides.push(text);
  assert.equal(result.next.revision.state.overrides.length, 1);
});

test("rejects stale version or content hash even though the template binding is unchanged", () => {
  const input = fixture();
  for (const expected of [{ ...input.expected, version: 2 }, { ...input.expected, sha256: "f".repeat(64) }]) {
    assert.throws(() => prepareHtmlEditingRevisionCommand({ ...input.authority, expected, encodedCommand: input.command([text]) }), /REVISION_CONFLICT/);
  }
});

test("no-op does not increment version and changed commands cannot overflow the counter", () => {
  const input = fixture([text], HTML_EDITING_REVISION_POLICY.maximumVersion);
  const unchanged = prepareHtmlEditingRevisionCommand({ ...input.authority, expected: input.expected, encodedCommand: input.command([text]) });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.next.sha256, input.expected.sha256);
  assert.throws(() => prepareHtmlEditingRevisionCommand({ ...input.authority, expected: input.expected,
    encodedCommand: input.command([{ ...text, value: "Different" }]) }), /VERSION_EXHAUSTED/);
});

test("semantic no-op preserves the exact revision digest for non-manifest snapshot order", () => {
  const input = fixture([{ operation: "SET_IMAGE", elementId: "image", assetId: other, fit: "COVER" }, text]);
  const result = prepareHtmlEditingRevisionCommand({ ...input.authority, expected: input.expected, encodedCommand: input.command([text]) });
  assert.equal(result.changed, false);
  assert.equal(result.next.sha256, input.expected.sha256);
  assert.deepEqual(result.next.revision.state.overrides, input.revision.state.overrides);
});

test("undo restores exact old content at a forward version; redo uses the same validation", () => {
  const initial = fixture();
  const applied = prepareHtmlEditingRevisionCommand({ ...initial.authority, expected: initial.expected, encodedCommand: initial.command([text]) });
  const undo = prepareHtmlEditingRevisionRestore({ ...initial.authority, encodedRevision: JSON.stringify(applied.next.revision),
    expected: { version: 2, sha256: applied.next.sha256 }, encodedRestoreRevision: initial.authority.encodedRevision });
  assert.equal(undo.next.revision.version, 3);
  assert.equal(load(undo.next.compiled.html)("#title").text(), "Original");
  const redo = prepareHtmlEditingRevisionRestore({ ...initial.authority, encodedRevision: JSON.stringify(undo.next.revision),
    expected: { version: 3, sha256: undo.next.sha256 }, encodedRestoreRevision: JSON.stringify(applied.next.revision) });
  assert.equal(redo.next.revision.version, 4);
  assert.equal(redo.next.compiled.html, applied.next.compiled.html);
});

test("history cannot substitute source or declarations and rechecks current asset grants", () => {
  const input = fixture();
  const altered = structuredClone(input.revision); altered.sourceHtml += " ";
  assert.throws(() => prepareHtmlEditingRevisionRestore({ ...input.authority, expected: input.expected,
    encodedRestoreRevision: JSON.stringify(altered) }), /RESTORE_SOURCE_MISMATCH/);
  const old = fixture([{ operation: "SET_IMAGE", elementId: "image", assetId: other, fit: "COVER" }]);
  assert.throws(() => prepareHtmlEditingRevisionRestore({ ...input.authority, grantedAssetIds: [uuid], expected: input.expected,
    encodedRestoreRevision: old.authority.encodedRevision }), /ASSET_NOT_AUTHORIZED/);
});

test("revoked old overrides can be removed without requiring the old output to render", () => {
  const input = fixture([{ operation: "SET_IMAGE", elementId: "image", assetId: other, fit: "COVER" }]);
  const result = prepareHtmlEditingRevisionCommand({ ...input.authority, grantedAssetIds: [uuid], expected: input.expected,
    encodedCommand: input.command([{ operation: "RESET", elementId: "image", property: "IMAGE" }]) });
  assert.equal(result.next.revision.state.overrides.length, 0);
});

test("revision format, fields and UTF-8 budget fail before a result is published", () => {
  const input = fixture();
  for (const revision of [{ ...input.revision, format: "unknown" }, { ...input.revision, rawHtml: "bad" }, { ...input.revision, version: 0 }]) {
    assert.throws(() => verifyHtmlEditingRevision({ ...input.authority, encodedRevision: JSON.stringify(revision) }), /INVALID_REVISION/);
  }
  assert.throws(() => verifyHtmlEditingRevision({ ...input.authority,
    encodedRevision: "é".repeat(HTML_EDITING_REVISION_POLICY.maximumBytes / 2 + 1) }), /PAYLOAD_LIMIT/);
});

function gatewayFixture() {
  const input = fixture();
  const state = { reads: 0, writes: 0, conflict: false, loseAck: false, wrongAck: false, readFailure: false,
    current: input.authority.encodedRevision, sha256: input.expected.sha256 };
  const repository: HtmlEditingRevisionRepository = {
    readAuthorized: async request => {
      state.reads++;
      assert.deepEqual(request.scope, input.request.scope);
      assert.equal(request.actorId, uuid);
      if (state.readFailure) throw new Error("PRIVATE_BACKEND_DETAIL");
      return { ...input.authority, encodedRevision: state.current, compositionDocumentHash: input.request.expectedCompositionDocumentHash };
    },
    appendCompareAndSwap: async request => {
      state.writes++;
      assert.equal(request.expectedCompositionDocumentHash, input.request.expectedCompositionDocumentHash);
      if (state.conflict || request.expected.sha256 !== state.sha256) return { status: "CONFLICT" };
      state.current = JSON.stringify(request.revision); state.sha256 = request.sha256;
      if (state.loseAck) throw new Error("PRIVATE_ACK_FAILURE");
      return { status: "COMMITTED", version: request.revision.version, sha256: state.wrongAck ? "f".repeat(64) : request.sha256 };
    },
  };
  return { input, state, repository, gateway: new HtmlEditingRevisionGateway(repository) };
}

test("gateway appends only after full validation and returns confirmed history snapshots", async () => {
  const host = gatewayFixture();
  const applied = await host.gateway.apply({ ...host.input.request, expected: host.input.expected, encodedCommand: host.input.command([text]) });
  assert.equal(host.state.writes, 1);
  assert.equal(applied.next.sha256, host.state.sha256);
  const undo = await host.gateway.restore({ ...host.input.request, expected: { version: 2, sha256: applied.next.sha256 },
    encodedRestoreRevision: JSON.stringify(applied.before) });
  assert.equal(host.state.writes, 2);
  assert.equal(undo.next.revision.version, 3);
});

test("gateway no-op and late invalid override never issue a write", async () => {
  const host = gatewayFixture();
  const reset = [{ operation: "RESET", elementId: "title", property: "TEXT" }];
  assert.equal((await host.gateway.apply({ ...host.input.request, expected: host.input.expected, encodedCommand: host.input.command(reset) })).changed, false);
  await assert.rejects(host.gateway.apply({ ...host.input.request, expected: host.input.expected,
    encodedCommand: host.input.command([text, { ...text, elementId: "unknown" }]) }), /UNKNOWN_ELEMENT/);
  assert.equal(host.state.writes, 0);
});

test("CAS rejection or lost/mismatched ACK cannot become success or trigger an automatic retry", async () => {
  for (const mode of ["conflict", "loseAck", "wrongAck"] as const) {
    const host = gatewayFixture(); host.state[mode] = true;
    await assert.rejects(host.gateway.apply({ ...host.input.request, expected: host.input.expected, encodedCommand: host.input.command([text]) }),
      mode === "conflict" ? /REVISION_CONFLICT/ : /COMMIT_UNCONFIRMED/);
    assert.equal(host.state.writes, 1);
  }
});

test("invalid or foreign scope, pre-cancelled request and failed read cannot reach persistence", async () => {
  const host = gatewayFixture();
  const request = { ...host.input.request, expected: host.input.expected, encodedCommand: host.input.command([text]) };
  await assert.rejects(host.gateway.apply({ ...request, actorId: "invalid" }), /INVALID_REVISION/);
  assert.equal(host.state.reads, 0);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(host.gateway.apply({ ...request, signal: controller.signal }));
  assert.equal(host.state.reads, 0);
  host.state.readFailure = true;
  await assert.rejects(host.gateway.apply(request), error => error instanceof HtmlEditingRevisionError && error.code === "READ_UNAVAILABLE");
  assert.equal(host.state.writes, 0);
  const foreign = new HtmlEditingRevisionGateway({ ...host.repository, readAuthorized: async () => ({
    ...host.input.authority, compositionDocumentHash: host.input.request.expectedCompositionDocumentHash,
    authoritativeBinding: { ...host.input.authority.authoritativeBinding, organizationId: other },
  }) });
  await assert.rejects(foreign.apply(request), /INVALID_REVISION/);
});

test("native document changes independently invalidate HTML edits before CAS", async () => {
  const host = gatewayFixture();
  const gateway = new HtmlEditingRevisionGateway({ ...host.repository, readAuthorized: async () => ({
    ...host.input.authority, compositionDocumentHash: "c".repeat(64),
  }) });
  await assert.rejects(gateway.apply({ ...host.input.request, expected: host.input.expected, encodedCommand: host.input.command([text]) }), /REVISION_CONFLICT/);
  assert.equal(host.state.writes, 0);
});

test("malformed repository acknowledgements fail safely without exposing content or retrying", async () => {
  for (const acknowledgement of [null, {}, { status: "COMMITTED", version: 2, sha256: "private token" }, { status: "CONFLICT", detail: "private" }]) {
    const host = gatewayFixture();
    const gateway = new HtmlEditingRevisionGateway({ ...host.repository,
      appendCompareAndSwap: async () => { host.state.writes++; return acknowledgement as never; },
    });
    await assert.rejects(gateway.apply({ ...host.input.request, expected: host.input.expected, encodedCommand: host.input.command([text]) }),
      error => error instanceof HtmlEditingRevisionError && error.code === "COMMIT_UNCONFIRMED");
    assert.equal(host.state.writes, 1);
  }
});
