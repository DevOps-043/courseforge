import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import { AUDIO_STREAM_LIMITS, AUDIO_TIMING_POLICY } from "../qa/composition-audio-conformance-policy";
import { StereoPcmEnergyAccumulator } from "../qa/composition-pcm-energy-stream";
import { consumeDecodedPcm, type PcmDecoderProcess } from "../qa/composition-pcm-decoder-stream";
import { buildStereoPcmEnergyWindows } from "../qa/composition-audio-rms-windows";
import { iterateAudioReferencePcm, mixAudioReferencePcm } from "../qa/composition-audio-reference-mix";
import { measureExportedAudioTiming } from "../qa/composition-exported-audio-timing";

function samples(frames: number) {
  const bytes = Buffer.alloc(frames * 8);
  for (let index = 0; index < frames; index++) { bytes.writeFloatLE(index % 31 / 100, index * 8); bytes.writeFloatLE(-(index % 17) / 100, index * 8 + 4); }
  return bytes;
}
test("stream conserva exactamente ventanas, samples y cola con fragmentos de 1–65537 bytes", () => {
  const input = samples(80123);
  for (const window of [5, 20]) for (const fragmentBytes of [1, 7, 8, 11, 65537]) {
    const accumulator = new StereoPcmEnergyAccumulator(window);
    for (let offset = 0; offset < input.length; offset += fragmentBytes) accumulator.push(input.subarray(offset, offset + fragmentBytes));
    assert.deepEqual(accumulator.finish(), buildStereoPcmEnergyWindows(input, window));
    assert.deepEqual(accumulator.finish(), accumulator.finish());
    assert.throws(() => accumulator.push(Buffer.alloc(0)), /STREAM_FINISHED/);
  }
});
test("EOF truncado, NaN partido entre chunks, vacío y presupuesto excesivo fallan", () => {
  const empty = new StereoPcmEnergyAccumulator(5); assert.throws(() => empty.finish(), /PCM_INVALID/);
  const truncated = new StereoPcmEnergyAccumulator(5); truncated.push(Buffer.alloc(7)); assert.throws(() => truncated.finish(), /PCM_INVALID/);
  const invalid = samples(1); invalid.writeFloatLE(NaN, 0);
  const nan = new StereoPcmEnergyAccumulator(5); nan.push(invalid.subarray(0, 3)); assert.throws(() => nan.push(invalid.subarray(3)), /PCM_INVALID/);
  const over = new StereoPcmEnergyAccumulator(5);
  assert.throws(() => over.push(Buffer.alloc((AUDIO_TIMING_POLICY.maximumDurationSeconds + 1) * 8000 * 8 + 8)), /PCM_INVALID/);
});
test("mezcla larga conserva tiempo absoluto y limita buffers al chunk, con cola parcial", () => {
  const source = Buffer.alloc(80); for (let offset = 0; offset < source.length; offset += 8) {
    source.writeFloatLE(0.25, offset); source.writeFloatLE(-0.25, offset + 4);
  }
  const plan = { durationSeconds: 131.005, clips: [{ clipId: "voice", assetId: "source", startSeconds: 0,
    durationSeconds: 131.005, sourceOffsetSeconds: 0, loop: true, volume: 1,
    points: [{ timeSeconds: 0, volume: 0 }, { timeSeconds: 131.005, volume: 1 }] }] };
  const chunks = [...iterateAudioReferencePcm(plan, new Map([["source", source]]))];
  assert.equal(chunks.length, 14); assert.ok(chunks.every((chunk) => chunk.pcm.length <= AUDIO_STREAM_LIMITS.mixChunkFrames * 8));
  const combined = Buffer.concat(chunks.map((chunk) => chunk.pcm));
  assert.deepEqual(combined, mixAudioReferencePcm(plan, new Map([["source", source]])).pcm);
  for (const frame of [79999, 80000, 80001, 160000, Math.ceil(plan.durationSeconds * 8000) - 1]) {
    assert.ok(Math.abs(combined.readFloatLE(frame * 8) - 0.25 * (frame / 8000) / plan.durationSeconds) < 1e-7);
    assert.equal(combined.readFloatLE(frame * 8), -combined.readFloatLE(frame * 8 + 4));
  }
});
test("clipping en un chunk tardío no se normaliza ni se oculta", () => {
  const plan = { durationSeconds: 21, clips: [{ clipId: "voice", assetId: "source", startSeconds: 0,
    durationSeconds: 21, sourceOffsetSeconds: 0, loop: true, volume: 1, points: [] },
    { clipId: "overlap", assetId: "source", startSeconds: 20, durationSeconds: 1, sourceOffsetSeconds: 0, loop: true, volume: 1, points: [] }] };
  const source = Buffer.alloc(8); source.writeFloatLE(0.75, 0); source.writeFloatLE(0.75, 4);
  const iterator = iterateAudioReferencePcm(plan, new Map([["source", source]]));
  assert.equal(iterator.next().done, false); assert.equal(iterator.next().done, false);
  assert.throws(() => iterator.next(), /MIX_CLIPPING/);
});
function processFixture(options: { chunks?: Buffer[]; exit?: number; stalled?: boolean; eofOnly?: boolean; error?: boolean } = {}) {
  const events = new EventEmitter(); let killed = 0;
  const stdout = options.stalled ? new PassThrough() : Readable.from(options.chunks ?? [Buffer.alloc(8)]);
  const stderr = Readable.from(["provider details must not escape"]);
  const process: PcmDecoderProcess = { stdout, stderr, once: events.once.bind(events),
    kill: () => { killed++; stdout.destroy(); events.emit("close", null); return true; } };
  const launch = () => {
    if (!options.stalled && !options.eofOnly) setImmediate(() => {
      if (options.error) events.emit("error", new Error("private launch error")); else events.emit("close", options.exit ?? 0);
    });
    return process;
  };
  return { launch, killed: () => killed };
}
const decode = { binary: "not-launched", arguments: ["file-only"], maximumBytes: 16, timeoutMilliseconds: 1000 };
test("decoder hace streaming con backpressure sin acumular stdout ni persistir stderr", async () => {
  const fixture = processFixture({ chunks: [Buffer.alloc(8, 1), Buffer.alloc(8, 2)] }), observed: Buffer[] = [];
  await consumeDecodedPcm({ ...decode, consume: async (bytes) => { observed.push(Buffer.from(bytes)); } }, fixture.launch);
  assert.equal(Buffer.concat(observed).length, 16); assert.equal(fixture.killed(), 0);
});
test("error de proceso, salida vacía, cuota y consumidor fallido matan el decoder y no filtran stderr", async () => {
  for (const options of [{ exit: 1 }, { chunks: [] }, { chunks: [Buffer.alloc(24)] }, { error: true }]) {
    const fixture = processFixture(options);
    await assert.rejects(consumeDecodedPcm({ ...decode, consume: () => {} }, fixture.launch), /AUDIO_TIMING_/);
    assert.ok(fixture.killed() > 0);
  }
  const fixture = processFixture();
  await assert.rejects(consumeDecodedPcm({ ...decode, consume: () => { throw new Error("controlled consumer failure"); } }, fixture.launch), /consumer failure/);
  assert.ok(fixture.killed() > 0);
});
test("timeout cubre stdout detenido y EOF sin cierre de proceso", async () => {
  for (const options of [{ stalled: true }, { eofOnly: true }]) {
    const fixture = processFixture(options);
    await assert.rejects(consumeDecodedPcm({ ...decode, timeoutMilliseconds: 10, consume: () => {} }, fixture.launch), /DECODE_TIMEOUT/);
    assert.ok(fixture.killed() > 0);
  }
});
test("medición completa de 5 minutos usa chunks y conserva diferencias tardías", async () => {
  const directory = await mkdtemp(join(tmpdir(), "audio-stream-measure-"));
  const referencePath = join(directory, "reference.wav"), referenceMetadataPath = join(directory, "metadata.json");
  const bytes = Buffer.from("controlled reference"), documentHash = "a".repeat(64);
  await writeFile(referencePath, bytes); await writeFile(referenceMetadataPath,
    JSON.stringify({ documentHash, audioSha256: createHash("sha256").update(bytes).digest("hex") }));
  let corrupt = false, maximumChunkBytes = 0;
  const controlledDecoder: typeof consumeDecodedPcm = async (params) => {
    const rendered = params.arguments.some((argument) => argument.endsWith("final.mp4")); let state = 17;
    for (let firstFrame = 0; firstFrame < 300 * 8000; firstFrame += 8000) {
      const pcm = Buffer.alloc(8000 * 8);
      for (let frame = 0; frame < 8000; frame++) {
        if (frame % 40 === 0) state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const gain = corrupt && rendered && firstFrame >= 299 * 8000 ? 0.5 : 1;
        const amplitude = (0.01 + state / 4294967296 * 0.4) * gain;
        pcm.writeFloatLE(amplitude, frame * 8); pcm.writeFloatLE(-amplitude, frame * 8 + 4);
      }
      maximumChunkBytes = Math.max(maximumChunkBytes, pcm.length); await params.consume(pcm);
    }
  };
  try {
    const params = { ffmpegPath: "not-launched", videoPath: "final.mp4", referencePath, referenceMetadataPath, documentHash, durationSeconds: 300 };
    const passed = await measureExportedAudioTiming(params, undefined, controlledDecoder);
    assert.equal(passed.status, "PASS"); assert.equal(passed.rms.comparedChannelWindows, 30000);
    assert.ok(maximumChunkBytes <= AUDIO_STREAM_LIMITS.processingChunkBytes);
    corrupt = true;
    const failed = await measureExportedAudioTiming(params, undefined, controlledDecoder);
    assert.equal(failed.status, "FAIL"); assert.ok(failed.rms.failedChannelWindows > 0);
  } finally { await rm(referencePath, { force: true }); await rm(referenceMetadataPath, { force: true }); await rmdir(directory); }
});
