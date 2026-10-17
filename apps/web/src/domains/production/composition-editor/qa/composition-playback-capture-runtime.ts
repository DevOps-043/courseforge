import { COMPOSITION_PREVIEW_PROTOCOL_VERSION } from "../composition-preview-protocol";
import { AUDIO_TIMING_POLICY } from "./composition-audio-conformance-policy";
import { createMediaBoundaryTracker, mediaBoundaryPlanSchema, MEDIA_BOUNDARY_POLICY, mediaBoundaryPlanHash, type MediaBoundaryWindow } from "./composition-playback-boundaries";

export const PLAYBACK_CAPTURE_POLICY = Object.freeze({
  id: "browser-media-output-pcm-48k-v1", sampleRate: 48_000,
  maximumDurationSeconds: AUDIO_TIMING_POLICY.maximumDurationSeconds,
  maximumMediaElements: 64, maximumQueuedFrames: 96_000, maximumBlockFrames: 2_048,
  pollMilliseconds: 100, startupMilliseconds: 10_000, completionGraceMilliseconds: 30_000,
  workletPath: "conformance-audio-worklet.js", processorName: "courseforge-playback-capture-v1",
} as const);

/** Trusted worker instrumentation, not user-supplied source. No microphone or gain normalization.
 * MediaElementAudioSource retains HTML media pause/seek/volume semantics:
 * https://www.w3.org/TR/2021/REC-webaudio-20210617/#MediaElementAudioSourceNode
 */
export const PLAYBACK_CAPTURE_WORKLET = `
registerProcessor(${JSON.stringify(PLAYBACK_CAPTURE_POLICY.processorName)}, class extends AudioWorkletProcessor {
  constructor() {
    super(); this.credit = ${PLAYBACK_CAPTURE_POLICY.maximumQueuedFrames}; this.failed = false;
    this.port.onmessage = ({data}) => {
      if (data?.type === "ack" && Number.isInteger(data.frames) && data.frames > 0
        && this.credit + data.frames <= ${PLAYBACK_CAPTURE_POLICY.maximumQueuedFrames}) this.credit += data.frames;
    };
  }
  process(inputs, outputs) {
    if (this.failed) return false;
    const output = outputs[0]; const input = inputs[0]; const frames = output?.[0]?.length || 0;
    if (!frames || frames > ${PLAYBACK_CAPTURE_POLICY.maximumBlockFrames} || this.credit < frames) {
      this.failed = true; this.port.postMessage({error: "AUDIO_PLAYBACK_BACKPRESSURE"}); return false;
    }
    const bytes = new ArrayBuffer(frames * 8); const view = new DataView(bytes);
    for (let channel = 0; channel < 2; channel++) {
      const samples = input[channel] || (input.length === 1 ? input[0] : undefined);
      for (let frame = 0; frame < frames; frame++) {
        const sample = samples?.[frame] ?? 0;
        if (!Number.isFinite(sample) || Math.abs(sample) > 1) {
          this.failed = true; this.port.postMessage({error: "AUDIO_PLAYBACK_PCM_INVALID"}); return false;
        }
        output[channel][frame] = sample;
        view.setFloat32((frame * 2 + channel) * 4, sample, true);
      }
    }
    this.credit -= frames;
    this.port.postMessage({startFrame: currentFrame, frames, bytes}, [bytes]); return true;
  }
});`;

/** Installs after readiness in an isolated capture origin. Caller resumes under a CDP user gesture. */
export function playbackCaptureInstallExpression(workletUrl: string, durationSeconds: number, expectedWindows?: MediaBoundaryWindow[]) {
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || durationSeconds > PLAYBACK_CAPTURE_POLICY.maximumDurationSeconds) {
    throw new Error("AUDIO_PLAYBACK_DURATION_INVALID");
  }
  const url = new URL(workletUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.username || url.password || url.search || url.hash
    || url.pathname !== `/${PLAYBACK_CAPTURE_POLICY.workletPath}`) throw new Error("AUDIO_PLAYBACK_WORKLET_URL_INVALID");
  const windows = expectedWindows === undefined ? undefined : mediaBoundaryPlanSchema.parse(expectedWindows);
  return `(async () => {
    if (window.__courseforgePlaybackCapture) throw new Error("AUDIO_PLAYBACK_ALREADY_INSTALLED");
    const config = ${JSON.stringify(PLAYBACK_CAPTURE_POLICY)};
    const media = [...document.querySelectorAll("audio.composition-audio")];
    if (media.length > config.maximumMediaElements) throw new Error("AUDIO_PLAYBACK_MEDIA_LIMIT");
    const expectedWindows = ${JSON.stringify(windows ?? null)};
    const boundaryTracker = expectedWindows ? (${createMediaBoundaryTracker.toString()})(expectedWindows) : null;
    if (expectedWindows) for (const window of expectedWindows) {
      const element = media.find((candidate) => candidate.id === window.elementId);
      if (!element) throw new Error("AUDIO_PLAYBACK_BOUNDARY_ELEMENT_MISSING");
      const start = Number(element.dataset.start || 0); const offset = Number(element.dataset.sourceOffset || 0);
      const duration = Number(element.dataset.duration || 0);
      if (![start, offset, duration].every(Number.isFinite) || offset < 0 || duration <= 0
        || Math.abs(Math.max(0, start) - window.startSeconds) > 1e-6
        || Math.abs(Math.min(${durationSeconds}, start + duration) - window.endSeconds) > 1e-6
        || Math.abs(offset + Math.max(0, -start) - window.sourceOffsetSeconds) > 1e-6 || element.loop !== window.loop) {
        throw new Error("AUDIO_PLAYBACK_BOUNDARY_PLAN_MISMATCH");
      }
    }
    const context = new AudioContext({sampleRate: config.sampleRate, latencyHint: "interactive"});
    if (context.sampleRate !== config.sampleRate) { await context.close(); throw new Error("AUDIO_PLAYBACK_RATE_UNSUPPORTED"); }
    let worklet = null; const sources = []; const listeners = []; const chunks = [];
    let queuedFrames = 0; let originFrame = null; let lastSeconds = 0; let error = null;
    let done = false; let disposed = false; let packetCount = 0; let eventCount = 0;
    let maxClockDriftMilliseconds = 0; let maxMediaDriftMilliseconds = 0; let largestBlockFrames = 0;
    const listen = (target, name, handler) => { target.addEventListener(name, handler); listeners.push(() => target.removeEventListener(name, handler)); };
    const fail = (code) => { if (!error) error = code; };
    const stop = async () => {
      if (disposed) return; disposed = true;
      listeners.forEach((remove) => remove()); sources.forEach((source) => source.disconnect()); worklet?.disconnect();
      window.postMessage({protocolVersion: ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}, type: "courseforge-composition-pause"}, "*");
      await context.close();
    };
    try {
      await context.suspend();
      await context.audioWorklet.addModule(${JSON.stringify(url.href)});
      worklet = new AudioWorkletNode(context, config.processorName, {numberOfInputs: 1, numberOfOutputs: 1,
        outputChannelCount: [2], channelCount: 2, channelCountMode: "explicit", channelInterpretation: "speakers"});
      worklet.onprocessorerror = () => fail("AUDIO_PLAYBACK_PROCESSOR_FAILED");
      worklet.port.onmessage = ({data}) => {
        if (disposed) return;
        if (data.error) { fail(data.error); return; }
        if (!(data.bytes instanceof ArrayBuffer) || data.bytes.byteLength !== data.frames * 8
          || !Number.isInteger(data.frames) || data.frames <= 0 || data.frames > config.maximumBlockFrames
          || queuedFrames + data.frames > config.maximumQueuedFrames) { fail("AUDIO_PLAYBACK_PACKET_INVALID"); return; }
        const bytes = new Uint8Array(data.bytes); let binary = "";
        for (let index = 0; index < bytes.length; index++) binary += String.fromCharCode(bytes[index]);
        chunks.push({startFrame: data.startFrame, frames: data.frames, pcm: btoa(binary)});
        queuedFrames += data.frames; packetCount++; largestBlockFrames = Math.max(largestBlockFrames, data.frames);
      };
      for (const element of media) { const source = context.createMediaElementSource(element); source.connect(worklet); sources.push(source); }
      worklet.connect(context.destination);
      for (const element of media) {
        for (const name of ["playing", "pause", "ended", "seeked", "timeupdate", "ratechange", "waiting", "stalled", "error"]) {
          listen(element, name, () => {
            eventCount++;
            if (name !== "playing" || !element.paused) boundaryTracker?.observe(element.id, name,
              Math.round(context.currentTime * config.sampleRate), element.duration);
            if (name === "playing" && expectedWindows && !expectedWindows.some((window) => window.elementId === element.id)
              && !element.muted && element.volume > 0) fail("AUDIO_PLAYBACK_UNEXPECTED_MEDIA");
            if (name === "error") fail("AUDIO_PLAYBACK_MEDIA_FAILED");
            const start = Number(element.dataset.start || 0); const duration = Number(element.dataset.duration || 0);
            const active = lastSeconds >= start && lastSeconds < start + duration;
            if (originFrame === null || !active) return;
            if (name === "waiting" || name === "stalled") fail("AUDIO_PLAYBACK_BUFFERING");
            if (["playing", "timeupdate", "seeked"].includes(name) && Number.isFinite(element.duration) && element.duration > 0) {
              const sourceTime = Math.max(0, Number(element.dataset.sourceOffset || 0) + lastSeconds - start);
              const expected = element.loop ? sourceTime % element.duration : Math.min(element.duration, sourceTime);
              const direct = Math.abs(element.currentTime - expected);
              const drift = element.loop ? Math.min(direct, Math.abs(element.duration - direct)) : direct;
              maxMediaDriftMilliseconds = Math.max(maxMediaDriftMilliseconds, drift * 1000);
            }
          });
        }
      }
      listen(window, "message", (event) => {
        if (event.source !== window || event.data?.protocolVersion !== ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}) return;
        if (event.data.type === "courseforge-composition-media-error") fail("AUDIO_PLAYBACK_MEDIA_FAILED");
        if (event.data.type === "courseforge-composition-media-state" && event.data.state === "BUFFERING" && originFrame !== null) fail("AUDIO_PLAYBACK_BUFFERING");
        if (event.data.type === "courseforge-composition-playback") {
          if (event.data.playing && originFrame === null) originFrame = Math.round(context.currentTime * config.sampleRate);
          else if (!event.data.playing && originFrame !== null) {
            if (lastSeconds < ${durationSeconds} - 0.02) fail("AUDIO_PLAYBACK_STOPPED_EARLY"); else done = true;
          }
        }
        if (event.data.type === "courseforge-composition-time") {
          const seconds = Number(event.data.seconds);
          if (!Number.isFinite(seconds) || seconds < lastSeconds - 0.02) { fail("AUDIO_PLAYBACK_CLOCK_INVALID"); return; }
          lastSeconds = seconds;
          if (originFrame !== null) maxClockDriftMilliseconds = Math.max(maxClockDriftMilliseconds,
            Math.abs(seconds - (context.currentTime - originFrame / config.sampleRate)) * 1000);
        }
      });
      window.__courseforgePlaybackCapture = {
        start: async () => { boundaryTracker?.arm(); await context.resume(); if (context.state !== "running") throw new Error("AUDIO_PLAYBACK_AUTOPLAY_BLOCKED");
          window.postMessage({protocolVersion: ${COMPOSITION_PREVIEW_PROTOCOL_VERSION}, type: "courseforge-composition-play"}, "*"); },
        pull: () => { const result = {originFrame, chunks: chunks.splice(0), error, done, packetCount, eventCount,
          maxClockDriftMilliseconds, maxMediaDriftMilliseconds, largestBlockFrames};
          if (done && boundaryTracker) result.boundaries = {policy: ${JSON.stringify(MEDIA_BOUNDARY_POLICY)},
            planHash: ${JSON.stringify(windows ? mediaBoundaryPlanHash(windows) : null)}, media: boundaryTracker.snapshot()};
          if (queuedFrames) worklet.port.postMessage({type: "ack", frames: queuedFrames}); queuedFrames = 0; return result; },
        stop,
      };
      return {sampleRate: context.sampleRate, mediaCount: media.length};
    } catch (failure) { await stop(); throw failure; }
  })()`;
}
