import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CompositionHtmlEditingBootstrapHost } from "../composition-html-editing-bootstrap-host.server";
import { HtmlEditingTemplateCatalog } from "../html-editing/html-editing-template-catalog.server";
import { HtmlEditingRevisionError } from "../html-editing/html-editing-revision.contract";
import { createHtmlTemplateChoicesHandler } from "../http/composition-html-editing-template-choices-handler.server";
import { consultHtmlTemplateChoices } from "../composition-html-editing-template-choices.client";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { HTML_TEMPLATE_CHOICES_POLICY as policy } from "../composition-html-editing-template-choices.contract";
import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid, htmlEditingFixtureOtherId as other } from "./composition-html-editing-test-fixtures";

function scenario() {
  const fixture = createHtmlEditingRevisionFixture(), binding = fixture.current.revision.manifest.binding;
  const template = { format: "courseforge-html-editable-template-v1", templateId: binding.templateId,
    templateVersion: binding.templateVersion, sourceSha256: binding.sourceSha256, elements: fixture.current.revision.manifest.elements };
  const catalog = new HtmlEditingTemplateCatalog(JSON.stringify({ format: "courseforge-html-editable-catalog-v1", organizationId: uuid,
    templates: [template, { ...template, templateVersion: 2 }, { ...template, templateId: "unrelated", sourceSha256: "f".repeat(64) }] }));
  const state = { enabled: true, actorId: uuid as string | null, tenant: { organizationId: uuid, userId: uuid, platformRole: "ADMIN" },
    allowed: true, badRate: false, failure: null as Error | null, resultOverride: undefined as unknown,
    context: { organizationId: uuid, documentId: uuid, clipId: binding.clipId, revisionId: other,
      documentHash: fixture.row.compositionDocumentHash, document: fixture.document, grantedAssetIds: [uuid, other] } };
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const client = { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async (signal: AbortSignal) => {
    signal.throwIfAborted(); calls.push({ name, args });
    return { error: null, data: name === "consume_api_rate_limit" ? state.badRate ? [] : [{ allowed: state.allowed, reset_at: "2026-10-10T23:00:00Z" }]
      : name === "read_html_editing_bootstrap_context" ? structuredClone(state.context) : null };
  } }) } as unknown as SupabaseClient;
  const service = new CompositionHtmlEditingBootstrapHost(client, catalog);
  const command = { actorId: uuid, organizationId: uuid, documentId: uuid, clipId: binding.clipId,
    expectedDocumentHash: fixture.row.compositionDocumentHash };
  const handler = createHtmlTemplateChoicesHandler({ enabled: () => state.enabled,
    authenticate: async () => { calls.push({ name: "auth", args: {} }); return { actorId: state.actorId, tenant: state.tenant }; },
    serviceClient: () => client,
    read: async (_client, input, signal) => {
      assert.deepEqual(input, command); if (state.failure) throw state.failure;
      return state.resultOverride ?? service.listTemplateChoices(input, signal);
    }, logFailure: () => { throw new Error("PRIVATE_LOGGER"); },
  });
  const url = `https://app.example/api/templates?expectedDocumentHash=${command.expectedDocumentHash}`;
  const request = (suffix = "", headers: Record<string, string> = {}, method = "GET", signal?: AbortSignal) =>
    new Request(url + suffix, { method, headers, signal });
  const view = { documentId: uuid, clipId: binding.clipId, documentHash: command.expectedDocumentHash,
    templates: [1, 2].map(templateVersion => ({ templateId: binding.templateId, templateVersion, fieldCount: template.elements.length })) };
  return { state, calls, service, command, handler, request, catalog, view, params: { draftId: uuid, clipId: binding.clipId } };
}

test("catalogue uses installed tenant/source matches only and exposes bounded detached descriptors", () => {
  const f = scenario();
  const sourceSha256 = createHtmlEditingRevisionFixture().current.revision.manifest.binding.sourceSha256;
  const first = f.catalog.listSourceMatches({ organizationId: uuid, sourceSha256 });
  assert.deepEqual(first, f.view.templates); first[0]!.templateId = "mutated";
  assert.deepEqual(f.catalog.listSourceMatches({ organizationId: uuid, sourceSha256 }), f.view.templates);
  assert.deepEqual(f.catalog.listSourceMatches({ organizationId: uuid, sourceSha256: "e".repeat(64) }), []);
  assert.throws(() => f.catalog.listSourceMatches({ organizationId: other, sourceSha256 }), /TEMPLATE_UNAVAILABLE/);
  assert.throws(() => f.catalog.listSourceMatches({ organizationId: uuid, sourceSha256: "invalid" }), /TEMPLATE_UNAVAILABLE/);
});

test("choices reuse exact authorized saved bootstrap read, never register or broaden grants", async () => {
  const f = scenario(); f.state.context.grantedAssetIds = [];
  assert.deepEqual(await f.service.listTemplateChoices(f.command), f.view);
  assert.deepEqual(f.calls.map(call => call.name), ["read_html_editing_bootstrap_context"]);
  assert.deepEqual(f.calls[0]!.args, { p_organization_id: uuid, p_draft_id: uuid, p_clip_id: f.command.clipId,
    p_actor_id: uuid, p_expected_document_hash: f.command.expectedDocumentHash });
  const encoded = JSON.stringify(f.view);
  for (const secret of ["sourceHtml", "sourceSha256", "elements", "grantedAssetIds", "revisionId", "allowedAssetIds"])
    assert.ok(!encoded.includes(secret));
});

test("choices reject browser authority extras before any read and abort without work", async () => {
  for (const extra of [{ actorId: "invalid" }, { sourceHtml: "forged" }, { templateId: "intro" }, { grantedAssetIds: [uuid] }]) {
    const f = scenario(); await assert.rejects(f.service.listTemplateChoices({ ...f.command, ...extra }), /INVALID_REVISION/);
    assert.equal(f.calls.length, 0);
  }
  const f = scenario(), controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.listTemplateChoices(f.command, controller.signal)); assert.equal(f.calls.length, 0);
});

test("choices reject cross-scope, stale hash, corrupt saved source and an already editable clip", async () => {
  for (const mode of ["organization", "document", "clip", "hash", "source", "editable"] as const) {
    const f = scenario();
    if (mode === "organization") f.state.context.organizationId = other;
    if (mode === "document") f.state.context.documentId = other;
    if (mode === "clip") f.state.context.clipId = "foreign";
    if (mode === "hash") f.state.context.documentHash = "e".repeat(64);
    if (mode === "source") {
      const source = f.state.context.document.clips[0]!.source;
      assert.equal(source.type, "DECK_SLIDE"); if (source.type === "DECK_SLIDE") source.html += " ";
    }
    if (mode === "editable") {
      const fixture = createHtmlEditingRevisionFixture();
      const native = bindHtmlEditingRevisionToComposition({ ...fixture.authority, document: fixture.document,
        revision: fixture.current.revision, revisionSha256: fixture.current.sha256 });
      f.state.context.document = native.document; f.state.context.documentHash = native.documentHash;
      f.command.expectedDocumentHash = native.documentHash;
    }
    await assert.rejects(f.service.listTemplateChoices(f.command)); assert.equal(f.calls.length, 1);
  }
});

test("choices GET returns private correlated metadata through shared auth/quota and bootstrap", async () => {
  const f = scenario(), response = await f.handler(f.request(), f.params);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store");
  const envelope = await response.json(); assert.deepEqual(envelope.data, f.view);
  assert.equal(envelope.requestId, envelope.correlationId); assert.equal(envelope.requestId, response.headers.get("x-request-id"));
  assert.deepEqual(f.calls.map(call => call.name), ["auth", "consume_api_rate_limit", "consume_api_rate_limit", "read_html_editing_bootstrap_context"]);
  assert.deepEqual(f.calls.filter(call => call.name === "consume_api_rate_limit").map(call => call.args.p_rate_key),
    [`html-editing-template-choices:org:${uuid}`, `html-editing-template-choices:actor:${uuid}:${uuid}`]);
});

test("choices reject method/origin/extra/duplicate query and bad path before authentication", async () => {
  const cases: Array<{ method?: string; headers?: Record<string, string>; suffix?: string; params?: unknown; status: number }> = [
    { method: "POST", status: 405 }, { headers: { origin: "https://evil.example" }, status: 403 },
    { headers: { "sec-fetch-site": "same-site" }, status: 403 }, { suffix: "&organizationId=" + other, status: 400 },
    { suffix: "&expectedDocumentHash=" + "a".repeat(64), status: 400 }, { params: { draftId: uuid, clipId: "../other" }, status: 400 },
  ];
  for (const options of cases) {
    const f = scenario();
    assert.equal((await f.handler(f.request(options.suffix, options.headers, options.method), options.params ?? f.params)).status, options.status);
    assert.equal(f.calls.length, 0);
  }
  const f = scenario(); f.state.enabled = false; assert.equal((await f.handler(f.request(), f.params)).status, 503);
  assert.equal(f.calls.length, 0);
});

test("choices require authenticated matching tenant reviewer and current shared quotas", async () => {
  for (const mode of ["anonymous", "foreign", "role", "rate", "malformed"] as const) {
    const f = scenario();
    if (mode === "anonymous") f.state.actorId = null;
    if (mode === "foreign") f.state.tenant.userId = other;
    if (mode === "role") f.state.tenant.platformRole = "BUILDER";
    if (mode === "rate") f.state.allowed = false;
    if (mode === "malformed") f.state.badRate = true;
    assert.equal((await f.handler(f.request(), f.params)).status, mode === "anonymous" ? 401
      : mode === "rate" ? 429 : mode === "malformed" ? 503 : 403);
    assert.ok(!f.calls.some(call => call.name === "read_html_editing_bootstrap_context"));
  }
});

test("choices fail closed on incorrect scope, authority extras, oversized output and read conflict", async () => {
  for (const view of [{ ...scenario().view, documentId: other }, { ...scenario().view, clipId: "foreign" },
    { ...scenario().view, documentHash: "e".repeat(64) }, { ...scenario().view, sourceHtml: "PRIVATE_SOURCE" },
    { ...scenario().view, padding: "x".repeat(policy.responseBytes + 1) }]) {
    const f = scenario(); f.state.resultOverride = view;
    const response = await f.handler(f.request(), f.params); assert.equal(response.status, 503);
    assert.ok(!(await response.text()).includes("PRIVATE_SOURCE"));
  }
  for (const error of [new HtmlEditingRevisionError("REVISION_CONFLICT"), new Error("PRIVATE_PROVIDER")]) {
    const f = scenario(); f.state.failure = error;
    const response = await f.handler(f.request(), f.params);
    assert.equal(response.status, error instanceof HtmlEditingRevisionError ? 409 : 503);
    assert.ok(!(await response.text()).includes("PRIVATE_PROVIDER"));
  }
});

test("browser catalogue client makes one exact GET and validates shared server response", async () => {
  const f = scenario(), calls: string[] = [], controller = new AbortController();
  const view = await consultHtmlTemplateChoices({ request: { documentId: uuid, clipId: f.command.clipId,
    expectedDocumentHash: f.command.expectedDocumentHash }, signal: controller.signal,
    fetcher: (async (url, options) => {
      calls.push(String(url)); assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "same-origin");
      assert.equal(options?.cache, "no-store"); assert.equal(options?.redirect, "error"); assert.equal(options?.body, undefined);
      return f.handler(new Request(new URL(String(url), "https://app.example"), options), f.params);
    }) as typeof fetch });
  assert.deepEqual(view, f.view); assert.equal(calls.length, 1);
  assert.ok(calls[0]!.endsWith(`/html-editing/${f.command.clipId}/templates?expectedDocumentHash=${f.command.expectedDocumentHash}`));
  assert.ok(!calls[0]!.includes("actorId")); assert.ok(!calls[0]!.includes("organizationId"));
});

test("catalogue client rejects bad scope/correlation/output/status without retry or fallback", async () => {
  for (const mode of ["scope", "hash", "correlation", "oversize", "conflict", "error", "extra"] as const) {
    const f = scenario(); let count = 0;
    const data = { ...f.view, ...(mode === "scope" ? { clipId: "foreign" } : mode === "hash" ? { documentHash: "e".repeat(64) }
      : mode === "extra" ? { elements: [] } : mode === "oversize" ? { padding: "x".repeat(policy.responseBytes + 2000) } : {}) };
    await assert.rejects(consultHtmlTemplateChoices({ request: { documentId: uuid, clipId: f.command.clipId,
      expectedDocumentHash: f.command.expectedDocumentHash }, signal: new AbortController().signal,
      fetcher: (async () => { count++; return Response.json({ success: true, data, requestId: uuid,
        correlationId: mode === "correlation" ? other : uuid }, { status: mode === "conflict" ? 409 : mode === "error" ? 503 : 200 }); }) as typeof fetch }),
    mode === "conflict" ? /borrador cambió/ : /No se pudo consultar/);
    assert.equal(count, 1);
  }
});

test("cancelled catalogue reads are never published or resent", async () => {
  const f = scenario(), controller = new AbortController(); let count = 0; controller.abort();
  await assert.rejects(consultHtmlTemplateChoices({ request: { documentId: uuid, clipId: f.command.clipId,
    expectedDocumentHash: f.command.expectedDocumentHash }, signal: controller.signal,
    fetcher: (async () => { count++; throw new Error(); }) as typeof fetch })); assert.equal(count, 0);
  const inFlight = new AbortController();
  await assert.rejects(consultHtmlTemplateChoices({ request: { documentId: uuid, clipId: f.command.clipId,
    expectedDocumentHash: f.command.expectedDocumentHash }, signal: inFlight.signal,
    fetcher: (async () => { count++; inFlight.abort(); return Response.json({ success: true, data: f.view, requestId: uuid, correlationId: uuid }); }) as typeof fetch }));
  assert.equal(count, 1);
});

test("product catalogue wiring preserves explicit durable initialization and masks stale owner results", () => {
  const directory = resolve(process.cwd(), "src/domains/materials/components/composition-editor");
  const panel = readFileSync(resolve(directory, "CompositionHtmlInitializationPanel.tsx"), "utf8");
  const hook = readFileSync(resolve(directory, "useCompositionHtmlTemplateChoices.ts"), "utf8");
  assert.ok(panel.includes("useCompositionHtmlTemplateChoices(scope, target)"));
  assert.ok(panel.includes('mode: "SEND", clipId: target.clipId, body: body.data'));
  assert.ok(panel.includes("templateId: choice.templateId")); assert.ok(panel.includes("templateVersion: choice.templateVersion"));
  assert.ok(panel.includes("!choice || !host.initialize")); assert.ok(panel.includes("catalog.view.templates.length === 0"));
  assert.ok(!panel.includes('type="number"')); assert.ok(!panel.includes("setTemplateId"));
  assert.ok(hook.includes("result?.owner === owner")); assert.ok(hook.includes("activeOwner.current === owner"));
  assert.ok(hook.includes("pending.current?.abort()")); assert.ok(!hook.includes(".initialize("));
  const route = readFileSync(resolve(process.cwd(), "src/app/api/production/hyperframes/drafts/[draftId]/html-editing/[clipId]/templates/route.ts"), "utf8");
  assert.ok(route.includes("COMPOSITION_HTML_EDITING_CATALOG_JSON")); assert.ok(route.includes(".listTemplateChoices(command, signal)"));
  assert.ok(!route.includes("export async function POST"));
});
