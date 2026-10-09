import assert from "node:assert/strict";
import test from "node:test";
import { MessageChannel } from "node:worker_threads";
import { HtmlEditingPreviewChannel } from "../composition-html-editing-preview-channel.client";
import { parseHtmlEditingPreviewPacket } from "../composition-html-editing-preview-channel.contract";
import { buildHtmlPreviewRenewalWireMessages, HTML_PREVIEW_RENEWAL_WIRE_POLICY } from "../composition-html-editing-preview-renewal-wire.contract";
import { createHtmlPreviewRenewalWireReceiver, sendHtmlPreviewRenewalWire } from "../composition-html-editing-preview-renewal-wire.client";
import type { HtmlPreviewResourceRenewal } from "../composition-html-editing-preview-renewal.contract";

const documentId = "11111111-1111-4111-8111-111111111111", audience = "https://app.example.test";
const session = { version: 1 as const, nonce: "a".repeat(64), documentHash: "b".repeat(64), previewGeneration: 2 };
function record(issuedAt = 100, count = 9): HtmlPreviewResourceRenewal {
  return { format: "courseforge-html-preview-resource-renewal-v1", documentId, session,
    bundleSha256: "c".repeat(64), inventoryFingerprint: "d".repeat(64), issuedAt, expiresAt: issuedAt + 180,
    resources: Array.from({ length: count }, (_, index) => ({ localPath: `conformance-media/11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
      url: `${audience}/api/production/hyperframes/drafts/${documentId}/html-preview/resources?cap=resource${index}time${issuedAt}.signature` })) };
}
const signal = () => new AbortController().signal;
const sleep = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
async function waitUntil(predicate: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!predicate()) { assert.ok(performance.now() < deadline, "wire did not settle"); await sleep(5); }
}

test("maximum inventory splits into bounded packets and pins its inner session to the outer private channel", () => {
  const renewal = record(100, 512);
  renewal.resources.forEach(resource => { resource.url = resource.url.replace(".signature", "x".repeat(7000) + ".signature"); });
  // Total response budget applies independently of individual packet limits.
  assert.throws(() => buildHtmlPreviewRenewalWireMessages(renewal));
  const large = record(100, 512);
  large.resources.forEach(resource => { resource.url = resource.url.replace(".signature", "x".repeat(3000) + ".signature"); });
  const messages = buildHtmlPreviewRenewalWireMessages(large);
  assert.equal(messages.length, 130);
  for (const [index, payload] of messages.entries()) {
    const packet = { kind: "RESOURCE_UPDATE", session, sequence: index + 1, payload };
    assert.ok(parseHtmlEditingPreviewPacket(packet, session));
    assert.ok(new TextEncoder().encode(JSON.stringify(packet)).length < 64 * 1024);
  }
  const begin = messages[0]!; assert.equal(begin.type, "BEGIN");
  if (begin.type !== "BEGIN") throw new Error();
  assert.equal(parseHtmlEditingPreviewPacket({ kind: "RESOURCE_UPDATE", session, sequence: 1,
    payload: { ...begin, metadata: { ...begin.metadata, session: { ...session, nonce: "e".repeat(64) } } } }, session), null);
});

test("receiver stages all batches without mutation and COMMIT waits for application; callbacks cannot alter its pinned copy", async () => {
  let applies = 0, release!: () => void, now = 220;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const receiver = createHtmlPreviewRenewalWireReceiver({ documentId, audience, session, nowSeconds: () => now,
    initial: record(100), onFailure: () => assert.fail("unexpected failure"),
    onCommit: async renewal => { applies++; renewal.resources.length = 0; await gate; } });
  try {
    const messages = buildHtmlPreviewRenewalWireMessages(record(220));
    for (const message of messages.slice(0, -1)) await receiver.accept(message, signal());
    assert.equal(applies, 0); assert.equal(receiver.getState().resources, 9);
    const commit = receiver.accept(messages[messages.length - 1]!, signal());
    assert.ok(receiver.getState().applying); release(); await commit; assert.equal(applies, 1);
    now = 221;
    const next = buildHtmlPreviewRenewalWireMessages(record(221));
    for (const message of next) await receiver.accept(message, signal());
    assert.equal(applies, 2); assert.ok(receiver.getState().completed);
  } finally { release(); receiver.dispose(); }
});

test("wire rejects gaps, duplicates, missing chunks, replay, substituted aliases and foreign inventory without application", async () => {
  for (const scenario of ["gap", "duplicate", "missing", "replay", "alias", "inventory", "second-begin"]) {
    let applies = 0, failures = 0;
    const receiver = createHtmlPreviewRenewalWireReceiver({ documentId, audience, session, initial: record(100), nowSeconds: () => 220,
      onCommit: async () => { applies++; }, onFailure: () => failures++ });
    const messages = buildHtmlPreviewRenewalWireMessages(record(scenario === "replay" ? 100 : 220));
    const begin = messages[0]!, batch = messages[1]!;
    if (begin.type !== "BEGIN" || batch.type !== "BATCH") throw new Error();
    if (scenario === "inventory") begin.metadata.inventoryFingerprint = "e".repeat(64);
    try {
      await assert.rejects((async () => {
        await receiver.accept(begin, signal());
        if (scenario === "second-begin") return receiver.accept(begin, signal());
        if (scenario === "missing") return receiver.accept(messages[messages.length - 1]!, signal());
        if (scenario === "gap") batch.index = 4;
        if (scenario === "alias") batch.resources[0]!.localPath = `conformance-media/${documentId}`;
        await receiver.accept(batch, signal());
        if (scenario === "duplicate") await receiver.accept(batch, signal());
      })(), /^Error: HTML_PREVIEW_RENEWAL_WIRE_REJECTED$/);
      assert.equal(applies, 0); assert.equal(failures, 1); assert.ok(receiver.getState().disposed);
    } finally { receiver.dispose(); }
  }
});

test("assembly timeout and cancellation clear staged resources and suppress late application completion", async context => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    for (const scenario of ["timeout", "abort"]) {
      let failures = 0, applies = 0;
      const abort = new AbortController();
      const receiver = createHtmlPreviewRenewalWireReceiver({ documentId, audience, session, nowSeconds: () => 100,
        onCommit: async () => { applies++; }, onFailure: () => failures++ });
      await receiver.accept(buildHtmlPreviewRenewalWireMessages(record())[0]!, abort.signal);
      if (scenario === "timeout") context.mock.timers.tick(HTML_PREVIEW_RENEWAL_WIRE_POLICY.assemblyTimeoutMs);
      else abort.abort();
      assert.ok(receiver.getState().disposed); assert.equal(receiver.getState().resources, 0);
      assert.equal(failures, 1); assert.equal(applies, 0); receiver.dispose();
    }
  } finally { context.mock.timers.reset(); }
});

test("real ports carry resource state/update only in their declared direction; COMMIT ACK follows actual apply", async () => {
  const pair = new MessageChannel(); let applied = false, commitEntered = false, release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const receiver = createHtmlPreviewRenewalWireReceiver({ documentId, audience, session, initial: record(100), nowSeconds: () => 220,
    onFailure: () => undefined, onCommit: async () => { commitEntered = true; await gate; applied = true; } });
  const host = new HtmlEditingPreviewChannel({ port: pair.port1 as unknown as MessagePort, session, receiveKind: "EVENT", allowResourcePackets: true,
    onPacket: () => undefined });
  const frame = new HtmlEditingPreviewChannel({ port: pair.port2 as unknown as MessagePort, session, receiveKind: "COMMAND", allowResourcePackets: true,
    onPacket: async (packet, scope) => { if (packet.kind === "RESOURCE_UPDATE") await receiver.accept(packet.payload, scope); } });
  try {
    let acknowledged = false;
    const sending = sendHtmlPreviewRenewalWire({ channel: host, kind: "RESOURCE_UPDATE", renewal: record(220), signal: signal() }).then(() => { acknowledged = true; });
    await waitUntil(() => commitEntered); assert.equal(applied, false); assert.equal(acknowledged, false);
    release(); await sending; assert.ok(applied); assert.ok(acknowledged);
    await assert.rejects(host.send({ kind: "RESOURCE_STATE", payload: buildHtmlPreviewRenewalWireMessages(record())[0]! }), /INVALID_PACKET/);
    await assert.rejects(frame.send({ kind: "RESOURCE_UPDATE", payload: buildHtmlPreviewRenewalWireMessages(record())[0]! }), /INVALID_PACKET/);
  } finally { release(); receiver.dispose(); host.close(); frame.close(); }
});

test("legacy channel opt-out rejects resource traffic and cancellation closes a pending transfer without replay", async () => {
  const pair = new MessageChannel();
  const host = new HtmlEditingPreviewChannel({ port: pair.port1 as unknown as MessagePort, session, receiveKind: "EVENT", onPacket: () => undefined });
  try {
    await assert.rejects(host.send({ kind: "RESOURCE_UPDATE", payload: buildHtmlPreviewRenewalWireMessages(record())[0]! }), /INVALID_PACKET/);
  } finally { host.close(); pair.port2.close(); }
  const other = new MessageChannel(), abort = new AbortController();
  const active = new HtmlEditingPreviewChannel({ port: other.port1 as unknown as MessagePort, session, receiveKind: "EVENT", allowResourcePackets: true,
    onPacket: () => undefined });
  const pending = sendHtmlPreviewRenewalWire({ channel: active, kind: "RESOURCE_UPDATE", renewal: record(), signal: abort.signal });
  abort.abort(); await assert.rejects(pending); assert.ok(active.getState().closed); other.port2.close();
});
