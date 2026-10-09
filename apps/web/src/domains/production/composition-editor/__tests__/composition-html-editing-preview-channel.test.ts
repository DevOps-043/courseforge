import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { HtmlEditingPreviewChannel } from "../composition-html-editing-preview-channel.client";
import { acceptHtmlEditingPreviewHandshake, createHtmlEditingPreviewSession, parseHtmlEditingPreviewPacket,
  HTML_EDITING_PREVIEW_CHANNEL_POLICY, type HtmlEditingPreviewSession } from "../composition-html-editing-preview-channel.contract";

const session: HtmlEditingPreviewSession = { version: 1, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 2 };
const command = { kind: "COMMAND" as const, payload: { protocolVersion: 1 as const, type: "courseforge-composition-seek" as const, seconds: 2 } };
const event = { kind: "EVENT" as const, payload: { protocolVersion: 1 as const, previewGeneration: 2,
  type: "courseforge-composition-time" as const, seconds: 2 } };
const port = (candidate: MessageChannel["port1"]) => candidate as unknown as MessagePort;
async function waitUntil(predicate: () => boolean) {
  const expires = performance.now() + 2_000;
  while (!predicate()) {
    if (performance.now() >= expires) assert.fail("MessagePort did not reach its expected state");
    await new Promise<void>(resolve => setTimeout(resolve, 5));
  }
}

test("secure preview sessions use independent random 256-bit nonces and exact version/hash/generation", () => {
  const first = createHtmlEditingPreviewSession(session.documentHash, 2), second = createHtmlEditingPreviewSession(session.documentHash, 2);
  assert.match(first.nonce, /^[a-f0-9]{64}$/); assert.notEqual(first.nonce, second.nonce);
  assert.throws(() => createHtmlEditingPreviewSession("bad", 2));
  assert.throws(() => createHtmlEditingPreviewSession(session.documentHash, -1));
});

test("handshake rejects origin-only authority, wrong source/nonce/generation/version and repeated or multiple ports", () => {
  const pair = new MessageChannel(), source = {} as Window;
  const handshake = { event: { data: { type: "courseforge-html-preview-connect", session }, source,
    origin: "null", ports: [port(pair.port1)] }, expectedSource: source, expectedOrigin: "null", session, alreadyConnected: false };
  try {
    assert.equal(acceptHtmlEditingPreviewHandshake(handshake), port(pair.port1));
    assert.equal(acceptHtmlEditingPreviewHandshake({ ...handshake, expectedSource: {} as Window }), null);
    assert.equal(acceptHtmlEditingPreviewHandshake({ ...handshake, expectedOrigin: "https://app.test" }), null);
    assert.equal(acceptHtmlEditingPreviewHandshake({ ...handshake, alreadyConnected: true }), null);
    assert.equal(acceptHtmlEditingPreviewHandshake({ ...handshake, event: { ...handshake.event, ports: [port(pair.port1), port(pair.port2)] } }), null);
    for (const change of [{ nonce: "c".repeat(64) }, { previewGeneration: 3 }, { version: 2 }, { documentHash: "c".repeat(64) }]) {
      assert.equal(acceptHtmlEditingPreviewHandshake({ ...handshake, event: { ...handshake.event,
        data: { ...handshake.event.data, session: { ...session, ...change } } } }), null);
    }
  } finally { pair.port1.close(); pair.port2.close(); }
});

test("packet validation bounds UTF-8 bytes and rejects extra authority, cycles, wrong session and stale inner bindings", () => {
  const valid = { ...command, session, sequence: 1 };
  assert.ok(parseHtmlEditingPreviewPacket(valid, session));
  for (const invalid of [{ ...valid, extra: true }, { ...valid, sequence: 0 },
    { ...valid, session: { ...session, nonce: "c".repeat(64) } },
    { ...valid, payload: { ...command.payload, seconds: Infinity } },
    { kind: "EVENT", sequence: 1, session, payload: { protocolVersion: 1, previewGeneration: 1,
      type: "courseforge-composition-ready", duration: 8, documentHash: session.documentHash } },
    { ...valid, junk: "ñ".repeat(HTML_EDITING_PREVIEW_CHANNEL_POLICY.messageBytes) }]) {
    assert.equal(parseHtmlEditingPreviewPacket(invalid, session), null);
  }
  const cyclic: { self?: unknown } = {}; cyclic.self = cyclic;
  assert.equal(parseHtmlEditingPreviewPacket(cyclic, session), null);
});

test("real MessagePorts deliver validated commands/events and matching ACKs without global window messages", async () => {
  const pair = new MessageChannel(), commands: unknown[] = [], events: unknown[] = [];
  const host = new HtmlEditingPreviewChannel({ port: port(pair.port1), session, receiveKind: "EVENT", onPacket: packet => { events.push(packet); } });
  const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, receiveKind: "COMMAND", onPacket: packet => { commands.push(packet); } });
  try {
    await host.send(command); await frame.send(event);
    assert.equal(commands.length, 1); assert.equal(events.length, 1);
    assert.deepEqual(host.getState(), { closed: false, pending: false, executing: false });
  } finally { host.close(); frame.close(); }
});

test("stop-and-wait blocks a second dispatch and handler failure produces explicit rejected ACK, never retry", async () => {
  const pair = new MessageChannel(); let release!: () => void; let received = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const host = new HtmlEditingPreviewChannel({ port: port(pair.port1), session, receiveKind: "EVENT", onPacket: () => undefined });
  const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, receiveKind: "COMMAND", onPacket: async () => {
    received++; await gate; throw new Error("private handler error");
  } });
  try {
    const result = host.send(command);
    await assert.rejects(host.send(command), /CHANNEL_BUSY/);
    release(); await assert.rejects(result, /^HtmlEditingPreviewChannelError: HTML_EDITING_PREVIEW_CHANNEL_REJECTED$/);
    assert.equal(received, 1); assert.equal(host.getState().closed, false);
  } finally { host.close(); frame.close(); }
});

test("replay, gaps, foreign payload direction and unexpected ACK close a port before invoking handlers", async () => {
  for (const candidate of [{ ...command, session, sequence: 2 }, { ...event, session, sequence: 1 },
    { session, kind: "ACK", sequence: 1, acknowledgedSequence: 1, status: "ACCEPTED" }]) {
    const pair = new MessageChannel(); let calls = 0;
    const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, receiveKind: "COMMAND", onPacket: () => { calls++; } });
    try {
      pair.port1.postMessage(candidate); await waitUntil(() => frame.getState().closed);
      assert.equal(frame.getState().closed, true); assert.equal(calls, 0);
    } finally { frame.close(); pair.port1.close(); }
  }
  const pair = new MessageChannel(); let calls = 0;
  const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, receiveKind: "COMMAND", onPacket: () => { calls++; } });
  try {
    pair.port1.postMessage({ ...command, session, sequence: 1 }); await waitUntil(() => calls === 1 && !frame.getState().executing);
    pair.port1.postMessage({ ...command, session, sequence: 1 }); await waitUntil(() => frame.getState().closed);
    assert.equal(frame.getState().closed, true); assert.equal(calls, 1);
  } finally { frame.close(); pair.port1.close(); }
});

test("outbound rate budget includes ACKs and closes safely; disposal rejects pending ACK without replay", async () => {
  const pair = new MessageChannel();
  const host = new HtmlEditingPreviewChannel({ port: port(pair.port1), session, receiveKind: "EVENT", now: () => 0, onPacket: () => undefined });
  const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, receiveKind: "COMMAND", now: () => 0, onPacket: () => undefined });
  try {
    for (let index = 0; index < 60; index++) await host.send(command);
    await assert.rejects(host.send(command), /CHANNEL_RATE_LIMIT/);
    assert.equal(host.getState().closed, true);
  } finally { host.close(); frame.close(); }
  const other = new MessageChannel();
  const pendingHost = new HtmlEditingPreviewChannel({ port: port(other.port1), session, receiveKind: "EVENT", onPacket: () => undefined });
  const pending = pendingHost.send(command); pendingHost.close();
  await assert.rejects(pending, /CHANNEL_CLOSED/); other.port2.close();
});

test("ACK timeout closes uncertainty without retransmission; late handler completion cannot reopen the session", async () => {
  const pair = new MessageChannel(); let release!: () => void; let calls = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const host = new HtmlEditingPreviewChannel({ port: port(pair.port1), session, receiveKind: "EVENT", onPacket: () => undefined });
  const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, receiveKind: "COMMAND", onPacket: async () => { calls++; await gate; } });
  try {
    await assert.rejects(host.send(command), /CHANNEL_ACK_TIMEOUT/);
    assert.equal(calls, 1); assert.equal(host.getState().closed, true);
    frame.close(); release();
    await waitUntil(() => !frame.getState().executing);
    await assert.rejects(host.send(command), /CHANNEL_CLOSED/);
  } finally { release(); host.close(); frame.close(); }
});

test("owner cancellation aborts callback scope and withholds its late ACK while ACK handling preserves in-flight exclusion", async () => {
  const pair = new MessageChannel(), controller = new AbortController();
  let signal: AbortSignal | undefined; let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const host = new HtmlEditingPreviewChannel({ port: port(pair.port1), session, receiveKind: "EVENT", onPacket: () => undefined });
  const frame = new HtmlEditingPreviewChannel({ port: port(pair.port2), session, signal: controller.signal, receiveKind: "COMMAND",
    onPacket: async (_packet, scope) => { signal = scope; await gate; } });
  const pending = host.send(command);
  try {
    await waitUntil(() => signal !== undefined);
    // Frame emits an event while its incoming command is still executing.
    await frame.send(event);
    assert.equal(frame.getState().executing, true);
    controller.abort(); assert.equal(signal!.aborted, true);
    assert.equal(frame.getState().closed, true);
    host.close(); await assert.rejects(pending, /CHANNEL_CLOSED/);
    release(); await waitUntil(() => !frame.getState().executing);
  } finally { release(); host.close(); frame.close(); }
});
