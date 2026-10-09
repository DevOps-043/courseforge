import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { Script } from "node:vm";
import { load } from "cheerio";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, writeFile, unlink, rmdir } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { installHtmlEditingPreviewRuntime, HTML_EDITING_PREVIEW_RUNTIME_POLICY } from "../composition-html-editing-preview-runtime.client";
import { HtmlEditingPreviewChannel } from "../composition-html-editing-preview-channel.client";
import { mountHtmlEditingPreviewRuntime, readHtmlEditingPreviewRuntimeBundle } from "../composition-html-editing-preview-runtime.server";
import { createInitialCompositionDocument } from "../composition-document.factory";
import { compileCompositionPreview } from "../composition-preview-compiler.service";
import type { HtmlEditingPreviewSession } from "../composition-html-editing-preview-channel.contract";

const session: HtmlEditingPreviewSession = { version: 1, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 2 };
const parentOrigin = "https://app.example.test";
const time = (seconds: number) => ({ type: "courseforge-composition-time" as const, seconds, protocolVersion: 1 as const, previewGeneration: 2 });
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(predicate: () => boolean) {
  const deadline = performance.now() + 2_000;
  while (!predicate()) { assert.ok(performance.now() < deadline, "runtime did not reach expected state"); await sleep(5); }
}
function frame() {
  const target = new EventTarget();
  const parent = {} as Window;
  const browserWindow = Object.assign(target, { parent }) as unknown as Window;
  const connect = (port: MessagePort, source = parent, origin = parentOrigin) => {
    const event = new Event("message");
    Object.assign(event, { data: { type: "courseforge-html-preview-connect", session }, source, origin, ports: [port] });
    target.dispatchEvent(event);
  };
  return { browserWindow, target, connect };
}

test("runtime coalesces pending transient state, delegates port commands and accepts events after its queue drains", async () => {
  const pair = new MessageChannel(), f = frame(), events: number[] = [], commands: string[] = [];
  const runtime = installHtmlEditingPreviewRuntime({ session, parentOrigin }, f.browserWindow);
  const host = new HtmlEditingPreviewChannel({ port: pair.port1 as unknown as MessagePort, session, receiveKind: "EVENT",
    onPacket: packet => { if (packet.kind === "EVENT" && packet.payload.type === "courseforge-composition-time") events.push(packet.payload.seconds); } });
  try {
    runtime.attach(command => { commands.push(command.type); });
    runtime.post(time(1)); runtime.post(time(2));
    assert.equal(runtime.getState().queued, 1);
    f.connect(pair.port2 as unknown as MessagePort, {} as Window);
    assert.equal(runtime.getState().connected, false);
    f.connect(pair.port2 as unknown as MessagePort);
    await waitUntil(() => events.length === 1);
    await host.send({ kind: "COMMAND", payload: { type: "courseforge-composition-seek", protocolVersion: 1, seconds: 3 } });
    assert.deepEqual(commands, ["courseforge-composition-seek"]);
    runtime.post(time(3)); await waitUntil(() => events.length === 2);
    await sleep(HTML_EDITING_PREVIEW_RUNTIME_POLICY.eventIntervalMs + 30);
    runtime.post(time(4)); await waitUntil(() => events.length === 3);
    assert.deepEqual(events, [2, 3, 4]);
    f.target.dispatchEvent(new Event("pagehide"));
    assert.equal(runtime.getState().disposed, true);
    assert.equal(commands[commands.length - 1], "courseforge-composition-pause");
    assert.throws(() => runtime.attach(() => undefined));
  } finally { runtime.dispose(); host.close(); pair.port2.close(); }
});

test("runtime rejects stale events before buffering, bounds non-transient queue and checks canonical parent origin", () => {
  for (const parentOrigin of ["https://app.test/path", "http://external.test", "https://user:pass@app.test", "null"]) {
    assert.throws(() => installHtmlEditingPreviewRuntime({ session, parentOrigin }, frame().browserWindow));
  }
  const stale = installHtmlEditingPreviewRuntime({ session, parentOrigin }, frame().browserWindow);
  stale.post({ ...time(0), previewGeneration: 1 }); assert.equal(stale.getState().disposed, true);
  const bounded = installHtmlEditingPreviewRuntime({ session, parentOrigin }, frame().browserWindow);
  const ready = { type: "courseforge-composition-ready" as const, protocolVersion: 1 as const,
    previewGeneration: 2, documentHash: session.documentHash, duration: 5 };
  for (let index = 0; index <= HTML_EDITING_PREVIEW_RUNTIME_POLICY.maximumQueuedEvents; index++) bounded.post(ready);
  assert.equal(bounded.getState().disposed, true); assert.equal(bounded.getState().queued, 0);
});

test("mount adapts an actual compiler controller only, preserves scene and hashes every injected script in CSP", async () => {
  const document = createInitialCompositionDocument({ animatedDeck: { css: "", fonts: [], width: 1920, height: 1080,
    slides: [{ animationCount: 0, classes: "slide", html: '<h1 id="title">Unchanged scene</h1>', index: 0, label: "HTML" }] },
    assets: [], plan: { accentColor: "#123456", durationSeconds: 5, subtitle: "", title: "Runtime" } });
  const compiled = await compileCompositionPreview({ document, documentHash: session.documentHash,
    previewGeneration: session.previewGeneration, assetUrls: new Map() });
  const packagedRuntime = "var CourseforgeHtmlPreviewRuntime={installHtmlEditingPreviewRuntime:function(){return {post:function(){},attach:function(){}}}};";
  const mounted = mountHtmlEditingPreviewRuntime({ trustedCompiledPage: compiled, packagedRuntime, session, parentOrigin });
  const original = load(compiled), page = load(mounted.html);
  assert.equal(page("#title").text(), original("#title").text());
  assert.equal(page("style").text(), original("style").text());
  assert.equal(page("script").length, original("script").length + 1);
  const controller = page("script").filter((_i, element) => (page(element).html() ?? "").includes("const compiledDocumentHash =")).html()!;
  assert.doesNotMatch(controller, /window\.parent\.postMessage|window\.addEventListener\("message"/);
  assert.match(controller, /__courseforgeHtmlPreviewBridge\.attach/);
  for (const script of page("script").toArray()) {
    const text = page(script).html()!; new Script(text);
    assert.ok(mounted.contentSecurityPolicy.includes(`'sha256-${createHash("sha256").update(text).digest("base64")}'`));
  }
  assert.match(mounted.contentSecurityPolicy, /sandbox allow-scripts/);
  assert.doesNotMatch(mounted.contentSecurityPolicy, /allow-same-origin|'unsafe-inline'/);
  for (const altered of [compiled.replace("const previewGeneration = 2;", "const previewGeneration = 3;"),
    compiled.replace("const postParentMessage =", "const changedPost =")]) {
    assert.throws(() => mountHtmlEditingPreviewRuntime({ trustedCompiledPage: altered, packagedRuntime, session, parentOrigin }), /RUNTIME_UNAVAILABLE/);
  }
});

test("packaged runtime reader checks current bundle and source pins; bundle is syntactically standalone", async () => {
  const bundle = await readHtmlEditingPreviewRuntimeBundle(process.cwd());
  new Script(bundle);
  assert.match(bundle, /CourseforgeHtmlPreviewRuntime/);
  await assert.rejects(readHtmlEditingPreviewRuntimeBundle("missing-html-preview-package"), /RUNTIME_UNAVAILABLE/);
});

test("actual built browser bundle delegates commands through its installed private port without external imports", async () => {
  const bundle = await readHtmlEditingPreviewRuntimeBundle(process.cwd());
  const context = { URL, TextEncoder, AbortController, setTimeout, clearTimeout, performance,
    CourseforgeHtmlPreviewRuntime: undefined as unknown as { installHtmlEditingPreviewRuntime: typeof installHtmlEditingPreviewRuntime } };
  new Script(bundle).runInNewContext(context);
  const f = frame(), pair = new MessageChannel(), commands: string[] = [];
  const config = { session, parentOrigin };
  const runtime = context.CourseforgeHtmlPreviewRuntime.installHtmlEditingPreviewRuntime(config, f.browserWindow);
  const host = new HtmlEditingPreviewChannel({ port: pair.port1 as unknown as MessagePort, session, receiveKind: "EVENT", onPacket: () => undefined });
  try {
    runtime.attach(command => { commands.push(command.type); });
    // The runtime must capture authority rather than retaining mutable input.
    config.parentOrigin = "https://substituted.example.test";
    f.connect(pair.port2 as unknown as MessagePort);
    assert.equal(runtime.getState().connected, true);
    await host.send({ kind: "COMMAND", payload: { type: "courseforge-composition-pause", protocolVersion: 1 } });
    assert.deepEqual(commands, ["courseforge-composition-pause"]);
  } finally { runtime.dispose(); host.close(); pair.port2.close(); }
});

test("operator package rejects stale source/bundle pins, duplicate paths, traversal and oversized manifests", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "courseforge-html-runtime-test-"));
  const webRoot = path.join(root, "apps/web"), directory = path.join(webRoot, ".tmp/html-preview-runtime");
  const sourcePath = path.join(root, "source.js"), bundlePath = path.join(directory, "runtime.js"), manifestPath = path.join(directory, "manifest.json");
  const digest = (text: string) => createHash("sha256").update(text).digest("hex");
  const source = "source fixture", bundle = "var CourseforgeHtmlPreviewRuntime={};";
  const manifest = { format: "courseforge-html-preview-runtime-v1", esbuildVersion: "test",
    bundleSha256: digest(bundle), bundleBytes: Buffer.byteLength(bundle), inputs: [{ path: "source.js", sha256: digest(source) }] };
  try {
    await mkdir(directory, { recursive: true });
    await writeFile(sourcePath, source); await writeFile(bundlePath, bundle);
    await writeFile(manifestPath, JSON.stringify(manifest));
    assert.equal(await readHtmlEditingPreviewRuntimeBundle(webRoot), bundle);
    for (const invalid of [{ ...manifest, bundleSha256: "c".repeat(64) },
      { ...manifest, inputs: [{ ...manifest.inputs[0], sha256: "c".repeat(64) }] },
      { ...manifest, inputs: [...manifest.inputs, ...manifest.inputs] },
      { ...manifest, inputs: [{ ...manifest.inputs[0], path: "../outside.js" }] }]) {
      await writeFile(manifestPath, JSON.stringify(invalid));
      await assert.rejects(readHtmlEditingPreviewRuntimeBundle(webRoot), /RUNTIME_UNAVAILABLE/);
    }
    await writeFile(manifestPath, Buffer.alloc(128 * 1024 + 1));
    await assert.rejects(readHtmlEditingPreviewRuntimeBundle(webRoot), /RUNTIME_UNAVAILABLE/);
  } finally {
    await Promise.all([sourcePath, bundlePath, manifestPath].map(file => unlink(file).catch(() => undefined)));
    // Known fixture paths only; never recursively remove an operator workspace.
    for (const folder of [directory, path.dirname(directory), webRoot, path.dirname(webRoot), root]) await rmdir(folder);
  }
});
