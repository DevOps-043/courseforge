import assert from "node:assert/strict";
import test from "node:test";
import { readVideoProbeSize, readVideoRangeBytes } from "../supabase/functions/_shared/hyperframes-video-range.ts";

const bytes = new Uint8Array([1, 2, 3, 4]);

test("acepta un probe 206 exacto y una respuesta completa pequeña", () => {
  assert.equal(readVideoProbeSize(new Response(bytes.slice(0, 1), {
    status: 206, headers: { "Content-Range": "bytes 0-0/4", "Content-Length": "1" },
  }), 10), 4);
  assert.equal(readVideoProbeSize(new Response(bytes, { status: 200, headers: { "Content-Length": "4" } }), 10), 4);
});

test("rechaza probe ambiguo, fuera de rango o sin tamaño acotado", () => {
  for (const response of [
    new Response(bytes.slice(0, 1), { status: 206, headers: { "Content-Range": "bytes 1-1/4" } }),
    new Response(bytes.slice(0, 1), { status: 206, headers: { "Content-Range": "bytes 0-0/4", "Content-Length": "2" } }),
    new Response(bytes, { status: 200 }),
    new Response(bytes, { status: 200, headers: { "Content-Length": "4", "Content-Range": "bytes 0-3/4" } }),
  ]) assert.throws(() => readVideoProbeSize(response, 10));
  assert.throws(() => readVideoProbeSize(new Response(bytes, { headers: { "Content-Length": "4" } }), 3));
});

test("acepta solo el rango solicitado y el total declarado", async () => {
  const response = new Response(bytes.slice(1, 3), {
    status: 206, headers: { "Content-Range": "bytes 1-2/4", "Content-Length": "2" },
  });
  assert.deepEqual(await readVideoRangeBytes(response, 1, 2, 4), bytes.slice(1, 3));
  assert.deepEqual(await readVideoRangeBytes(new Response(bytes, { status: 200, headers: { "Content-Length": "4" } }), 0, 3, 4), bytes);
});

test("rechaza replay de rango, total distinto y cuerpo mayor al solicitado", async () => {
  await assert.rejects(readVideoRangeBytes(new Response(bytes.slice(0, 2), { status: 206, headers: { "Content-Range": "bytes 0-1/4" } }), 1, 2, 4));
  await assert.rejects(readVideoRangeBytes(new Response(bytes.slice(1, 3), { status: 206, headers: { "Content-Range": "bytes 1-2/5" } }), 1, 2, 4));
  await assert.rejects(readVideoRangeBytes(new Response(bytes, { status: 206, headers: { "Content-Range": "bytes 1-2/4" } }), 1, 2, 4));
  await assert.rejects(readVideoRangeBytes(new Response(bytes.slice(1, 2), { status: 206, headers: { "Content-Range": "bytes 1-2/4" } }), 1, 2, 4));
  await assert.rejects(readVideoRangeBytes(new Response(bytes.slice(1, 3), { status: 200 }), 1, 2, 4));
});
