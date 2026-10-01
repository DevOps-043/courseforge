import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rmdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import { captureBrowserPlaybackAudio } from "../qa/composition-browser-playback-audio";
import { PLAYBACK_CAPTURE_POLICY, PLAYBACK_CAPTURE_WORKLET, playbackCaptureInstallExpression } from "../qa/composition-playback-capture-runtime";
import { PlaybackPcmConsumer } from "../qa/composition-playback-pcm-consumer";
import { startConformanceCaptureServer } from "../qa/composition-conformance-capture-server";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";

function pcm(frames: number) {
  const bytes = Buffer.alloc(frames * 8);
  for (let offset = 0; offset < bytes.length; offset += 8) {bytes.writeFloatLE(0.25, offset); bytes.writeFloatLE(-0.25, offset + 4);}
  return bytes;
}
function chunk(startFrame: number, frames = 128) {return {startFrame, frames, pcm: pcm(frames).toString("base64")};}
function batch(chunks: ReturnType<typeof chunk>[], originFrame: number | null = 16, done = false) {
  return {originFrame, chunks, error: null, done, packetCount: 2, eventCount: 5,
    maxClockDriftMilliseconds: 8, maxMediaDriftMilliseconds: 5, largestBlockFrames: 128};
}

test("worklet conserva estéreo, volumen y muestras; crédito finito aborta sobrecarga sin colas ilimitadas", () => {
  const messages: any[] = []; let Processor: any;
  const context = createContext({currentFrame: 0, AudioWorkletProcessor: class {
    port = {onmessage: null as any, postMessage: (message: unknown) => messages.push(message)};
  }, registerProcessor: (name: string, constructor: any) => {assert.equal(name, PLAYBACK_CAPTURE_POLICY.processorName); Processor = constructor;}});
  runInContext(PLAYBACK_CAPTURE_WORKLET, context);
  const processor = new Processor();
  const left = new Float32Array(128).fill(0.25); const right = new Float32Array(128).fill(-0.25);
  const output = [new Float32Array(128), new Float32Array(128)];
  assert.equal(processor.process([[left, right]], [output]), true);
  assert.deepEqual(output, [left, right]);
  assert.ok(pcm(128).equals(Buffer.from(messages[0].bytes)));
  processor.port.onmessage({data: {type: "ack", frames: 128}});
  for (let block = 0; block < PLAYBACK_CAPTURE_POLICY.maximumQueuedFrames / 128; block++) assert.equal(processor.process([[left, right]], [output]), true);
  assert.equal(processor.process([[left, right]], [output]), false);
  assert.equal(messages.at(-1).error, "AUDIO_PLAYBACK_BACKPRESSURE");
});

test("worklet rechaza NaN y clipping sin convertir muestras inválidas en silencio", () => {
  for (const sample of [NaN, Infinity, 1.1]) {
    const messages: any[] = []; let Processor: any;
    const context = createContext({currentFrame: 0, AudioWorkletProcessor: class {
      port = {onmessage: null, postMessage: (message: unknown) => messages.push(message)};
    }, registerProcessor: (_name: string, constructor: any) => {Processor = constructor;}});
    runInContext(PLAYBACK_CAPTURE_WORKLET, context);
    const left = new Float32Array(128).fill(sample);
    assert.equal(new Processor().process([[left]], [[new Float32Array(128), new Float32Array(128)]]), false);
    assert.equal(messages.at(-1).error, "AUDIO_PLAYBACK_PCM_INVALID");
  }
});

test("consumidor conserva origen exacto y cola parcial sin padding ni compensar lag", async () => {
  const consumer = new PlaybackPcmConsumer(240 / PLAYBACK_CAPTURE_POLICY.sampleRate); const written: Buffer[] = [];
  await consumer.consume(batch([chunk(0)]), async (bytes) => {written.push(bytes);});
  await consumer.consume(batch([chunk(128)], 16, true), async (bytes) => {written.push(bytes);});
  assert.equal(consumer.complete, true); assert.deepEqual(consumer.finish(), {originFrame: 16, sampleCount: 240, peak: 0.25});
  assert.ok(Buffer.concat(written).equals(pcm(240)));
});

test("gaps, origen mutable, PCM corrupto, pérdida de inicio y captura incompleta no producen evidencia", async () => {
  const writer = async (_bytes: Buffer) => undefined;
  const consumer = new PlaybackPcmConsumer(1); await consumer.consume(batch([chunk(0)]), writer);
  await assert.rejects(consumer.consume(batch([chunk(256)]), writer), /SAMPLE_GAP/);
  await assert.rejects(consumer.consume(batch([], 17), writer), /ORIGIN_CHANGED/);
  assert.throws(() => consumer.finish(), /INCOMPLETE/);
  const unknown = new PlaybackPcmConsumer(1); await unknown.consume(batch([chunk(0)], null), writer);
  await assert.rejects(unknown.consume(batch([], 16), writer), /START_MISSING/);
  const invalid = pcm(128); invalid.writeFloatLE(NaN, 0);
  await assert.rejects(new PlaybackPcmConsumer(1).consume(batch([{...chunk(0), pcm: invalid.toString("base64")}]), writer), /PCM_INVALID/);
  await assert.rejects(new PlaybackPcmConsumer(1).consume({...batch([]), error: "AUDIO_PLAYBACK_BUFFERING"}, writer), /BUFFERING/);
});

test("URLs de worklet remotas, credenciales o paths ajenos se rechazan sin ejecutar navegador", () => {
  for (const url of ["https://remote.invalid/conformance-audio-worklet.js", "http://127.0.0.1:1234/secret", "http://user:secret@127.0.0.1/conformance-audio-worklet.js", "http://127.0.0.1/conformance-audio-worklet.js?token=secret"]) {
    assert.throws(() => playbackCaptureInstallExpression(url, 1), /WORKLET_URL_INVALID/);
  }
  assert.throws(() => playbackCaptureInstallExpression("http://127.0.0.1/conformance-audio-worklet.js", 601), /DURATION_INVALID/);
});

test("modo audio sirve solo el worklet fijo y permisos aislados sin cambiar CSP visual por defecto", async () => {
  const root = await mkdtemp(join(tmpdir(), "playback-server-test-")); const path = join(root, "conformance-preview.html");
  await writeFile(path, "<html></html>");
  const server = await startConformanceCaptureServer(root, new Map([["conformance-preview.html", "text/html"]]), {playbackAudio: true});
  try {
    const response = await fetch(`${server.origin}/conformance-preview.html`); const csp = response.headers.get("content-security-policy")!;
    assert.ok(csp.includes("sandbox allow-scripts allow-same-origin"));
    assert.ok(csp.includes(`connect-src ${server.origin}/${PLAYBACK_CAPTURE_POLICY.workletPath}`));
    assert.equal(await (await fetch(`${server.origin}/${PLAYBACK_CAPTURE_POLICY.workletPath}`)).text(), PLAYBACK_CAPTURE_WORKLET);
    assert.equal((await fetch(`${server.origin}/other.js`)).status, 403);
    assert.equal((await fetch(`${server.origin}/${PLAYBACK_CAPTURE_POLICY.workletPath}?unexpected=1`)).status, 403);
  } finally {await server.close(); await rm(path); await rmdir(root);}
});

test("productor guarda salida real suministrada por CDP con SHA y testigo, y cierra en éxito/fallo", async () => {
  for (const fail of [false, true]) {
    const root = await mkdtemp(join(tmpdir(), "browser-playback-test-")); let stopped = false; let polls = 0;
    const client: CompositionQaCdpClient = {close: () => undefined, send: async (_method, params) => {
      const expression = String(params?.expression);
      if (expression.startsWith("(async")) return {result: {value: {sampleRate: PLAYBACK_CAPTURE_POLICY.sampleRate, mediaCount: 1}}};
      if (expression.includes(".stop()")) {stopped = true; return {result: {value: true}};}
      if (expression.includes(".start()")) {assert.equal(params?.userGesture, true); return {result: {value: true}};}
      if (fail) return {result: {value: {...batch([]), error: "AUDIO_PLAYBACK_MEDIA_FAILED"}}};
      return {result: {value: ++polls === 1 ? batch([chunk(0)]) : batch([chunk(128)], 16, true)}};
    }};
    const params = {client, outputParentDirectory: root, workletUrl: "http://127.0.0.1:1234/conformance-audio-worklet.js", durationSeconds: 240 / PLAYBACK_CAPTURE_POLICY.sampleRate,
      receipt: {schemaVersion: 1, organizationId: "70000000-0000-4000-8000-000000000001", revisionId: "70000000-0000-4000-8000-000000000001",
        projectHash: "a".repeat(64), documentHash: "b".repeat(64), assetCount: 1, mediaBytes: 100}};
    try {
      if (fail) {await assert.rejects(captureBrowserPlaybackAudio(params), /MEDIA_FAILED/); assert.deepEqual(await readdir(root), []);}
      else {
        const capture = await captureBrowserPlaybackAudio(params);
        try {
          const wav = await readFile(capture.audioReferencePath);
          assert.ok(wav.subarray(44).equals(pcm(240)));
          assert.equal(wav.readUInt32LE(24), PLAYBACK_CAPTURE_POLICY.sampleRate);
          assert.equal(capture.receipt.audioSha256, createHash("sha256").update(wav).digest("hex"));
          assert.equal(capture.receipt.status, "BROWSER_PLAYBACK_CAPTURED");
          assert.equal(capture.receipt.playback.sampleCount, 240);
        } finally {await capture.cleanup();}
      }
      assert.equal(stopped, true);
    } finally {await rmdir(root);}
  }
});
