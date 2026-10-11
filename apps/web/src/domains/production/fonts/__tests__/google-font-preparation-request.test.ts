import assert from "node:assert/strict";
import test from "node:test";
import { readGoogleFontPreparationRequest } from "../google-font-preparation-request.server";

function streamingRequest(stream: ReadableStream<Uint8Array>, headers: HeadersInit = {}) {
  return new Request("https://engine.test/", { method: "POST", body: stream, headers, duplex: "half" } as RequestInit);
}

for (const declaredLength of [undefined, "1"]) test(`caps actual streamed bytes with Content-Length ${declaredLength ?? "absent"}`, async () => {
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(new Uint8Array(1025)); },
    cancel() { canceled = true; },
  });
  const request = streamingRequest(stream, declaredLength ? { "content-length": declaredLength } : {});
  assert.deepEqual(await readGoogleFontPreparationRequest(request, new AbortController().signal), { success: false, reason: "too_large" });
  assert.equal(canceled, true); assert.equal(request.body!.locked, false);
});

test("abort cancels a stalled body and releases its lock, even if underlying cancellation stalls", async () => {
  let canceled = false;
  const request = streamingRequest(new ReadableStream<Uint8Array>({
    cancel() { canceled = true; return new Promise<void>(() => undefined); },
  }));
  const controller = new AbortController();
  const pending = readGoogleFontPreparationRequest(request, controller.signal);
  controller.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(canceled, true); assert.equal(request.body!.locked, false);
});

for (const [declaredLength, reason] of [["1025", "too_large"], ["-1", "invalid"], ["junk", "invalid"]] as const)
  test(`rejects declared Content-Length ${declaredLength} before reading the body`, async () => {
    let canceled = false;
    const request = streamingRequest(new ReadableStream<Uint8Array>({ cancel() { canceled = true; } }), { "content-length": declaredLength });
    assert.deepEqual(await readGoogleFontPreparationRequest(request, new AbortController().signal), { success: false, reason });
    assert.equal(canceled, true); assert.equal(request.body!.locked, false);
  });

test("rejects invalid UTF-8 and combines split valid JSON chunks", async () => {
  const malformed = streamingRequest(new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([0xff])); controller.close(); } }));
  assert.deepEqual(await readGoogleFontPreparationRequest(malformed, new AbortController().signal), { success: false, reason: "invalid" });
  const valid = streamingRequest(new ReadableStream<Uint8Array>({ start(controller) {
    controller.enqueue(new TextEncoder().encode("{")); controller.enqueue(new TextEncoder().encode("}")); controller.close();
  } }));
  assert.deepEqual(await readGoogleFontPreparationRequest(valid, new AbortController().signal), { success: true, data: {} });
});
