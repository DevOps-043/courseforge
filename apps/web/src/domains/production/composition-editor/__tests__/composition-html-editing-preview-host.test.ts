import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { HtmlEditingPreviewChannel } from "../composition-html-editing-preview-channel.client";
import { buildHtmlEditingPreviewPageUrl, createHtmlEditingPreviewHost, HTML_PREVIEW_HOST_POLICY,
  isHtmlEditingPreviewPageUrl } from "../composition-html-editing-preview-host.client";
import type { HtmlEditingPreviewSession } from "../composition-html-editing-preview-channel.contract";
import type { CompositionPreviewParentCommandInput } from "../composition-preview-protocol";

const session: HtmlEditingPreviewSession = { version: 1, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 2 };
const ports = () => new MessageChannel() as unknown as globalThis.MessageChannel;
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(predicate: () => boolean) {
  const deadline = performance.now() + 2_000;
  while (!predicate()) { assert.ok(performance.now() < deadline, "host state did not settle"); await sleep(5); }
}
function peer(onCommand: (command: CompositionPreviewParentCommandInput) => void = () => undefined) {
  let frame: HtmlEditingPreviewChannel | undefined, handshakes = 0;
  const target = { postMessage(message: unknown, origin: string, transfer: MessagePort[]) {
    handshakes++;
    assert.deepEqual(message, { type: "courseforge-html-preview-connect", session });
    assert.equal(origin, "*"); assert.equal(transfer.length, 1);
    frame = new HtmlEditingPreviewChannel({ port: transfer[0], session, receiveKind: "COMMAND",
      onPacket: packet => { if (packet.kind === "COMMAND") onCommand(packet.payload); } });
  } } as unknown as Window;
  return { target, get frame() { return frame!; }, get handshakes() { return handshakes; }, close: () => frame?.close() };
}
const time = { type: "courseforge-composition-time" as const, protocolVersion: 1 as const, previewGeneration: 2, seconds: 3 };

test("host URL binds exact session and distinguishes secure page from resource and legacy routes", () => {
  const draftId = "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA";
  const url = buildHtmlEditingPreviewPageUrl(draftId, session);
  assert.equal(new URL(url, "https://app.test").searchParams.get("nonce"), session.nonce);
  assert.ok(url.includes(draftId.toLowerCase())); assert.ok(isHtmlEditingPreviewPageUrl(url));
  assert.equal(isHtmlEditingPreviewPageUrl(url.split("?")[0] + "/resources?cap=secret"), false);
  assert.equal(isHtmlEditingPreviewPageUrl(url.replace("html-preview", "preview")), false);
  assert.throws(() => buildHtmlEditingPreviewPageUrl("../draft", session));
  for (const revisionId of ["", "forged", "../revision"]) {
    let allocatedPorts = 0;
    assert.throws(() => createHtmlEditingPreviewHost({ session,
      resources: { documentId: draftId, audience: "https://app.test", revisionId },
      createPorts: () => { allocatedPorts++; return ports(); }, onEvent: () => undefined, onFailure: () => undefined }), /REVISION_INVALID/);
    assert.equal(allocatedPorts, 0);
  }
});

test("host transfers once, coalesces adjacent seeks only and preserves play/pause order over real ports", async () => {
  const commands: CompositionPreviewParentCommandInput[] = [], events: unknown[] = [];
  const remote = peer(command => commands.push(command)); let failures = 0;
  const host = createHtmlEditingPreviewHost({ session, createPorts: ports, onEvent: event => events.push(event), onFailure: () => failures++ });
  try {
    assert.ok(host.send({ type: "courseforge-composition-seek", seconds: 1 }));
    assert.ok(host.send({ type: "courseforge-composition-seek", seconds: 2 }));
    assert.ok(host.send({ type: "courseforge-composition-play" }));
    assert.ok(host.send({ type: "courseforge-composition-seek", seconds: 3 }));
    assert.ok(host.send({ type: "courseforge-composition-pause" }));
    assert.equal(host.getState().queued, 4);
    assert.ok(host.connect(remote.target)); assert.equal(host.connect(remote.target), false);
    await remote.frame.send({ kind: "EVENT", payload: time });
    await waitUntil(() => commands.length === 4);
    assert.deepEqual(commands.map(command => command.type), ["courseforge-composition-seek", "courseforge-composition-play",
      "courseforge-composition-seek", "courseforge-composition-pause"]);
    assert.equal((commands[0] as { seconds: number }).seconds, 2);
    assert.equal(events.length, 1); assert.equal(failures, 0); assert.equal(remote.handshakes, 1);
  } finally { host.dispose(); remote.close(); }
});

test("host queue overflow closes once without dispatch, retry or accepting later commands", () => {
  let failures = 0;
  const host = createHtmlEditingPreviewHost({ session, onEvent: () => undefined, onFailure: () => failures++ });
  for (let index = 0; index < HTML_PREVIEW_HOST_POLICY.maximumQueuedCommands; index++)
    assert.ok(host.send({ type: "courseforge-composition-play" }));
  assert.equal(host.send({ type: "courseforge-composition-pause" }), false);
  assert.deepEqual(host.getState(), { connected: false, disposed: true, queued: 0 });
  assert.equal(host.send({ type: "courseforge-composition-play" }), false);
  host.dispose(); assert.equal(failures, 1);
});

test("host catches port factory and bootstrap failures and closes allocated ports", () => {
  for (const factoryThrows of [true, false]) {
    let failures = 0;
    const host = createHtmlEditingPreviewHost({ session, createPorts: () => {
      if (factoryThrows) throw new Error("private factory details"); return ports();
    }, onEvent: () => undefined, onFailure: () => failures++ });
    assert.equal(host.connect({ postMessage: () => { throw new Error("private target details"); } } as unknown as Window), false);
    assert.ok(host.getState().disposed); assert.equal(failures, 1);
  }
});

test("owner subscription closes an idle host immediately and is removed once; callback configuration is captured", async () => {
  let currentOwner = true, notify!: () => void, removals = 0, failures = 0, events = 0;
  const remote = peer();
  const input = { session, createPorts: ports, isCurrentOwner: () => currentOwner,
    subscribeOwner: (onChange: () => void) => { notify = onChange; return () => removals++; },
    onEvent: () => events++, onFailure: () => failures++ };
  const host = createHtmlEditingPreviewHost(input);
  input.isCurrentOwner = () => true;
  try {
    assert.ok(host.connect(remote.target));
    await remote.frame.send({ kind: "EVENT", payload: time }); assert.equal(events, 1);
    currentOwner = false; notify();
    assert.ok(host.getState().disposed); assert.equal(failures, 1); assert.equal(removals, 1);
    notify(); host.dispose(); assert.equal(removals, 1); assert.equal(failures, 1);
    assert.equal(host.send({ type: "courseforge-composition-play" }), false);
  } finally { host.dispose(); remote.close(); }
});

test("event handler failure tears down host and never acknowledges handler success", async () => {
  const remote = peer(); let failures = 0;
  const host = createHtmlEditingPreviewHost({ session, createPorts: ports,
    onEvent: () => { throw new Error("private application error"); }, onFailure: () => failures++ });
  try {
    assert.ok(host.connect(remote.target));
    // The owner closes its endpoint immediately; no false successful ACK is emitted.
    const delivery = remote.frame.send({ kind: "EVENT", payload: time });
    await waitUntil(() => host.getState().disposed);
    remote.close(); await assert.rejects(delivery);
    assert.equal(failures, 1);
  } finally { host.dispose(); remote.close(); }
});

test("missing runtime times out without repeating the handshake", context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const remote = peer(); let failures = 0;
  const host = createHtmlEditingPreviewHost({ session, createPorts: ports, onEvent: () => undefined, onFailure: () => failures++ });
  try {
    assert.ok(host.connect(remote.target));
    context.mock.timers.tick(HTML_PREVIEW_HOST_POLICY.connectionTimeoutMs);
    assert.ok(host.getState().disposed); assert.equal(failures, 1); assert.equal(remote.handshakes, 1);
  } finally { host.dispose(); remote.close(); context.mock.timers.reset(); }
});
