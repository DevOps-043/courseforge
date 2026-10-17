import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { setImmediate } from "node:timers/promises";
import { createHtmlEditingPreviewHost } from "../composition-html-editing-preview-host.client";
import { installHtmlEditingPreviewRuntime } from "../composition-html-editing-preview-runtime.client";
import type { HtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.contract";
import type { consultHtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.client";

const documentId = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const session = { version: 1 as const, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 2 };
function record(issuedAt: number): HtmlPreviewResourceRenewal {
  return { format: "courseforge-html-preview-resource-renewal-v1", documentId, session, bundleSha256: "c".repeat(64),
    inventoryFingerprint: "d".repeat(64), issuedAt, expiresAt: issuedAt + 180,
    resources: [{ localPath: `conformance-media/${documentId}`,
      url: `${audience}/api/production/hyperframes/drafts/${documentId}/html-preview/resources?cap=body${issuedAt}.signature` }] };
}

for (const published of [false, true])
for (const mode of ["playing", "paused", "buffering", "revoked"] as const)
test(`host/runtime ${published ? "published" : "saved"} renewal preserves ${mode} lifecycle past initial expiry without reloading the page`, async context => {
  context.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 100_000 });
  const initial = record(100); let src = initial.resources[0]!.url, loads = 0, requests = 0, failures = 0, signals = 0;
  const video = Object.assign(new EventTarget(), { localName: "video", style: { length: 0 },
    setAttribute: (name: string, value: string) => { assert.equal(name, "src"); src = value; }, load: () => { loads++; } });
  Object.defineProperty(video, "attributes", { get: () => [{ name: "src", value: src, namespaceURI: null }] });
  const document = { querySelectorAll: () => [video], styleSheets: [] } as unknown as Document;
  const frameEvents = new EventTarget(), parent = {} as Window;
  const frameWindow = Object.assign(frameEvents, { parent, document }) as unknown as Window;
  const runtime = installHtmlEditingPreviewRuntime({ session, parentOrigin: audience }, frameWindow);
  const commands: { type: string; seconds?: number }[] = [], events: string[] = [];
  runtime.setResources(initial);
  runtime.attach(command => {
    commands.push(command);
    if (command.type === "courseforge-composition-pause") runtime.post({ type: "courseforge-composition-playback", playing: false, protocolVersion: 1, previewGeneration: 2 });
    if (command.type === "courseforge-composition-seek") runtime.post({ type: "courseforge-composition-time", seconds: command.seconds, protocolVersion: 1, previewGeneration: 2 });
    if (command.type === "courseforge-composition-play") {
      if (mode === "buffering") runtime.post({ type: "courseforge-composition-media-state", state: "BUFFERING", pendingMediaIds: [], protocolVersion: 1, previewGeneration: 2 });
      runtime.post({ type: "courseforge-composition-playback", playing: mode !== "buffering", protocolVersion: 1, previewGeneration: 2 });
    }
  });
  runtime.post({ type: "courseforge-composition-ready", duration: 100, documentHash: session.documentHash, protocolVersion: 1, previewGeneration: 2 });
  runtime.post({ type: "courseforge-composition-time", seconds: 5, protocolVersion: 1, previewGeneration: 2 });
  runtime.post({ type: "courseforge-composition-playback", playing: mode !== "paused", protocolVersion: 1, previewGeneration: 2 });
  if (mode === "buffering") {
    runtime.post({ type: "courseforge-composition-media-state", state: "BUFFERING", pendingMediaIds: [], protocolVersion: 1, previewGeneration: 2 });
    runtime.post({ type: "courseforge-composition-playback", playing: false, protocolVersion: 1, previewGeneration: 2 });
  }
  const revisionId = published ? "22222222-2222-4222-8222-222222222222" : undefined;
  const resources = { documentId, audience, revisionId,
    consult: async (input: Parameters<typeof consultHtmlPreviewResourceRenewal>[0]) => {
      requests++; assert.deepEqual(input.session, session); assert.equal(input.bundleSha256, initial.bundleSha256);
      assert.equal(input.revisionId, revisionId);
      assert.equal(input.inventoryFingerprint, initial.inventoryFingerprint);
      if (mode === "revoked") throw new Error("private permission revoked");
      return record(Math.floor(Date.now() / 1000));
    } };
  const host = createHtmlEditingPreviewHost({ session, createPorts: () => new MessageChannel() as unknown as globalThis.MessageChannel,
    resources, onRuntimeSignal: () => { signals++; }, onEvent: message => { events.push(message.type); }, onFailure: () => failures++ });
  // The caller cannot silently switch an already-created historical host to a
  // saved preview (or another publication) during its asynchronous bootstrap.
  resources.revisionId = undefined;
  const target = { postMessage(data: unknown, _origin: string, ports: MessagePort[]) {
    const event = new Event("message"); Object.assign(event, { data, source: parent, origin: audience, ports }); frameEvents.dispatchEvent(event);
  } } as unknown as Window;
  const pump = async (steps: number) => {
    for (let index = 0; index < steps; index++) {
      context.mock.timers.tick(50); await setImmediate(); await setImmediate();
    }
  };
  try {
    assert.ok(host.connect(target)); await pump(30);
    assert.ok(events.includes("courseforge-composition-ready")); assert.equal(requests, 0); assert.equal(failures, 0); assert.equal(signals, 1);
    context.mock.timers.tick(120_000); await pump(30);
    if (mode === "revoked") {
      assert.equal(requests, 1); assert.equal(loads, 0); assert.equal(failures, 1); assert.ok(host.getState().disposed);
      context.mock.timers.tick(60_000); await pump(10);
      assert.ok(runtime.getState().disposed); assert.equal(requests, 1); return;
    }
    assert.equal(requests, 1); assert.equal(loads, 1); assert.notEqual(src, initial.resources[0]!.url);
    const expectedCommands = [
      { type: "courseforge-composition-pause", protocolVersion: 1 },
      { type: "courseforge-composition-seek", seconds: 5, protocolVersion: 1 },
      ...(mode === "paused" ? [] : [{ type: "courseforge-composition-play", protocolVersion: 1 }]),
    ];
    assert.deepEqual(commands, expectedCommands);
    context.mock.timers.tick(60_000); await pump(10);
    assert.ok(Date.now() / 1000 > initial.expiresAt); assert.equal(runtime.getState().disposed, false);
    assert.equal(host.getState().disposed, false); assert.equal(failures, 0);
    context.mock.timers.tick(60_000); await pump(30);
    assert.equal(requests, 2); assert.equal(loads, 2);
    assert.deepEqual(commands.slice(expectedCommands.length), expectedCommands);
    assert.ok(host.send({ type: "courseforge-composition-seek", seconds: 9 })); await pump(10);
    video.dispatchEvent(new Event("loadedmetadata"));
    assert.deepEqual(commands[commands.length - 1], { type: "courseforge-composition-seek", seconds: 9, protocolVersion: 1 });
  } finally { host.dispose(); runtime.dispose(); context.mock.timers.reset(); }
});
