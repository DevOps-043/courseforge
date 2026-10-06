import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {PassThrough} from "node:stream";
import test from "node:test";
import {consumeDecodedPcm} from "../qa/composition-pcm-decoder-stream";
import {measureExportedAudioLoudness} from "../qa/composition-exported-audio-loudness";
import {measureExportedAudioTiming} from "../qa/composition-exported-audio-timing";
import {compareExportedVideoWithPreview} from "../qa/composition-exported-video-conformance";

function decoder() {
  const events = new EventEmitter(); const stdout = new PassThrough(), stderr = new PassThrough(); let killed = 0;
  return {child: {stdout, stderr, once: events.once.bind(events), kill() {killed++; return true;}},
    events, get killed() {return killed;}};
}
test("pre-aborted measurements do not launch or read files and cannot become a failed metric", async () => {
  const cancellation = new AbortController(); cancellation.abort("private reason");
  await assert.rejects(consumeDecodedPcm({binary: "unused", arguments: [], maximumBytes: 8, timeoutMilliseconds: 100,
    signal: cancellation.signal, consume: () => {}}, () => assert.fail("must not launch")), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  await assert.rejects(measureExportedAudioLoudness({ffmpegPath: "unused", videoPath: "unused", signal: cancellation.signal,
    execute: async () => assert.fail("must not launch")}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  await assert.rejects(measureExportedAudioTiming({ffmpegPath: "unused", videoPath: "unused", referencePath: "unused",
    referenceMetadataPath: "unused", documentHash: "a".repeat(64), durationSeconds: 1, signal: cancellation.signal}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
  await assert.rejects(compareExportedVideoWithPreview({contractPath: "unused", previewDirectory: "unused", previewMetadataPath: "unused",
    renderReceiptPath: "unused", videoPath: "unused", signal: cancellation.signal}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
});
test("abort interrupts a stalled PCM child, sanitizes reason and does not wait for a missing close event", async () => {
  const cancellation = new AbortController(), state = decoder();
  const reading = consumeDecodedPcm({binary: "unused", arguments: [], maximumBytes: 8, timeoutMilliseconds: 1000,
    signal: cancellation.signal, consume: () => assert.fail("no bytes")}, () => state.child);
  cancellation.abort("private token");
  await assert.rejects(reading, error => error instanceof Error && error.message === "CONFORMANCE_JOB_EXECUTION_CANCELLED");
  assert.ok(state.killed >= 1); state.child.stderr.destroy();
});
test("abort after the PCM sink consumes bytes cannot produce success", async () => {
  const cancellation = new AbortController(), state = decoder();
  const reading = consumeDecodedPcm({binary: "unused", arguments: [], maximumBytes: 8, timeoutMilliseconds: 1000,
    signal: cancellation.signal, consume: () => {cancellation.abort("private");}}, () => state.child);
  state.child.stdout.end(Buffer.alloc(8)); state.events.emit("close", 0);
  await assert.rejects(reading, /CONFORMANCE_JOB_EXECUTION_CANCELLED/); state.child.stderr.destroy();
});
test("successful PCM cleanup removes cancellation listener and preserves bytes", async () => {
  const cancellation = new AbortController(), state = decoder(); let bytes = 0;
  const reading = consumeDecodedPcm({binary: "unused", arguments: [], maximumBytes: 8, timeoutMilliseconds: 1000,
    signal: cancellation.signal, consume: chunk => {bytes += chunk.byteLength;}}, () => state.child);
  state.child.stdout.end(Buffer.alloc(8)); state.events.emit("close", 0); await reading;
  cancellation.abort(); assert.equal(bytes, 8); assert.equal(state.killed, 0); state.child.stderr.destroy();
});
test("loudness forwards signal and restricted environment; aborted executor cannot become MEASUREMENT_FAILED", async () => {
  const cancellation = new AbortController();
  await assert.rejects(measureExportedAudioLoudness({ffmpegPath: "unused", videoPath: "final.mp4", signal: cancellation.signal,
    execute: async (_binary, _args, options) => {
      assert.equal(options.signal, cancellation.signal); assert.equal(options.env.NODE_ENV, "production");
      assert.equal(options.env.HYPERFRAMES_NO_TELEMETRY, "1"); assert.equal(options.env.NODE_OPTIONS, undefined);
      assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, undefined);
      cancellation.abort("private reason"); throw new Error("private provider failure");
    }}), /CONFORMANCE_JOB_EXECUTION_CANCELLED/);
});
