import {createHash} from "node:crypto";
import {join} from "node:path";
import {SDK_PROCESS_BUDGETS} from "./controlled-sdk-policy.mjs";

/** Authored local video corpus only; no URL resolution, downloads or external projects. */
export async function prepareControlledSdkMedia({engine, html, projectDirectory, workDirectory,
  fps, durationSeconds, expectedVideoCount, expectedAudioCount, signal, remainingMilliseconds = () => SDK_PROCESS_BUDGETS.mediaMs}) {
  const assertActive = () => {if (signal?.aborted) throw new Error("CONTROLLED_RENDER_ABORTED");};
  const processBudget = () => {
    assertActive(); const remaining = remainingMilliseconds();
    if (!Number.isSafeInteger(remaining) || remaining <= 0) throw new Error("CONTROLLED_RENDER_MEDIA_BUDGET_INVALID");
    return Math.min(SDK_PROCESS_BUDGETS.mediaMs, remaining);
  };
  assertActive();
  const videos = engine.parseVideoElements(html), audios = engine.parseAudioElements(html);
  if (videos.length !== expectedVideoCount || audios.length !== expectedAudioCount
    || new Set(videos.map((video) => video.id)).size !== videos.length
    || new Set(audios.map((audio) => audio.id)).size !== audios.length
    || videos.length > 2 || audios.length > 2 || ![24, 25, 30, 60].includes(fps) || durationSeconds !== 8)
    throw new Error("CONTROLLED_RENDER_MEDIA_MANIFEST_MISMATCH");
  for (const element of [...videos, ...audios]) {
    if (element.src !== "assets/source.mp4" || !Number.isFinite(element.start) || !Number.isFinite(element.end)
      || element.start < 0 || element.end <= element.start || element.end > durationSeconds
      || !Number.isFinite(element.mediaStart) || element.mediaStart < 0)
      throw new Error("CONTROLLED_RENDER_MEDIA_SOURCE_INVALID");
  }
  if (!videos.length && !audios.length) return {beforeCapture: null, metadataHints: [], videoIds: [],
    beginRepeatability() {assertActive();},
    async mix() {assertActive(); return {scope: "NO_AUTHORED_MEDIA", tracksProcessed: 0};}};
  const extracted = await engine.extractAllVideoFrames(videos, projectDirectory,
    {fps: {num: fps, den: 1}, outputDir: join(workDirectory, "extracted"), format: "png", timelineEnd: durationSeconds,
      maxTransientRetries: 0, collectProbeFailures: true}, signal, {ffmpegProcessTimeout: processBudget(), extractCacheDir: ""});
  assertActive();
  if (!extracted.success || extracted.errors.length || extracted.extracted.length !== videos.length
    || new Set(extracted.extracted.map((entry) => entry.videoId)).size !== videos.length
    || extracted.extracted.some((entry) => !entry.totalFrames || !videos.some((video) => video.id === entry.videoId))) {
    const kind = extracted.errors[0]?.kind;
    const safeKinds = ["source_missing", "invalid_media", "ffmpeg_unavailable", "ffmpeg_timeout", "ffmpeg_failed", "zero_output", "internal"];
    throw new Error(`CONTROLLED_RENDER_VIDEO_EXTRACTION_${safeKinds.includes(kind) ? kind.toUpperCase() : "FAILED"}`);
  }
  const lookup = engine.createFrameLookupTable(videos, extracted.extracted);
  const inject = engine.createVideoFrameInjector(lookup, {frameDataUriCacheLimit: 8, frameDataUriCacheBytesLimitMb: 32});
  if (!inject) throw new Error("CONTROLLED_RENDER_VIDEO_INJECTION_MISSING");
  const envelopes = audios.map((audio) => ({id: audio.id, keyframes: []}));
  let capturedFrames = 0;
  let repeatability = false;
  return {
    metadataHints: extracted.extracted.map((entry) => ({id: entry.videoId, width: entry.metadata.width, height: entry.metadata.height})),
    videoIds: videos.map((video) => video.id),
    beginRepeatability() {
      assertActive();
      if (repeatability || capturedFrames !== durationSeconds * fps)
        throw new Error("CONTROLLED_RENDER_MEDIA_SEQUENCE_INCOMPLETE");
      repeatability = true;
    },
    async beforeCapture(page, time) {
      assertActive();
      if (!Number.isFinite(time) || time < 0 || time > durationSeconds
        || Math.abs(time * fps - Math.round(time * fps)) > 1e-6
        || !repeatability && (Math.abs(time - capturedFrames / fps) > 1e-6 || capturedFrames >= durationSeconds * fps))
        throw new Error("CONTROLLED_RENDER_MEDIA_SEQUENCE_INVALID");
      await inject(page, time);
      assertActive();
      const samples = await page.evaluate((targets) => targets.map((target) => {
        const id = target.type === "video" ? target.id.slice(0, -6) : target.id;
        const element = document.getElementById(id);
        return {id: target.id, volume: element instanceof HTMLMediaElement ? element.volume : null};
      }), audios.map(({id, type}) => ({id, type})));
      assertActive();
      if (samples.length !== audios.length || samples.some((sample, index) => sample.id !== audios[index].id
        || !Number.isFinite(sample.volume) || sample.volume < 0 || sample.volume > 1))
        throw new Error("CONTROLLED_RENDER_AUDIO_VOLUME_INVALID");
      if (!repeatability) {
        samples.forEach((sample, index) => envelopes[index].keyframes.push({time, volume: sample.volume}));
        capturedFrames++;
      }
    },
    async mix() {
      assertActive();
      if (capturedFrames !== durationSeconds * fps) throw new Error("CONTROLLED_RENDER_MEDIA_SEQUENCE_INCOMPLETE");
      const audioPath = join(workDirectory, "mixed.m4a");
      // Effective volumes are sampled from the actual capture timeline, not copied from configured gains.
      const tracks = audios.map((audio, index) => ({...audio, volumeKeyframes: envelopes[index].keyframes}));
      const result = await engine.processCompositionAudio(tracks, projectDirectory, join(workDirectory, "audio"), audioPath,
        durationSeconds, signal, {ffmpegProcessTimeout: processBudget(), audioGain: 1});
      assertActive();
      if (!result.success || result.failures?.length || result.tracksProcessed !== audios.length)
        throw new Error("CONTROLLED_RENDER_AUDIO_MIX_FAILED");
      return {scope: "SDK_CAPTURE_VOLUME_SAMPLES_NOT_AUDIO_PARITY", audioPath, tracksProcessed: result.tracksProcessed,
        sampledFrames: capturedFrames, extractedFrames: extracted.totalFramesExtracted,
        envelopeSha256: createHash("sha256").update(JSON.stringify(envelopes)).digest("hex")};
    },
  };
}
