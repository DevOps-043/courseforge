export const COMPOSITION_AUDIO_METER_CONFIG = {
  fftSize: 2048,
  intervalMs: 100,
  maximumSources: 32,
  minimumDecibels: -120,
  maximumDecibels: 24,
  clippingAmplitude: 1,
  clippingHoldMs: 2000,
} as const;

export function areCompositionAudioMetersEnabled(): boolean {
  return process.env.NEXT_PUBLIC_COMPOSITION_AUDIO_METERS === "true";
}

export function measureAudioMeterSamples(samples: ArrayLike<number>, config = COMPOSITION_AUDIO_METER_CONFIG) {
  let peak = 0;
  let energy = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!Number.isFinite(sample)) throw new Error("AUDIO_METER_SAMPLE_INVALID");
    peak = Math.max(peak, Math.abs(sample));
    energy += sample * sample;
  }
  const decibels = (amplitude: number) => amplitude === 0 ? null
    : Math.max(config.minimumDecibels, Math.min(config.maximumDecibels, 20 * Math.log10(amplitude)));
  return {
    clipping: peak >= config.clippingAmplitude,
    peakDbfs: decibels(peak),
    rmsDbfs: decibels(samples.length ? Math.sqrt(energy / samples.length) : 0),
  };
}

/** Injected only into interactive previews; all dependencies are serialized explicitly. */
export function renderCompositionAudioMeterRuntime(enabled: boolean): string {
  if (!enabled) return "const audioMeters = { pause() {}, reset() {}, resume() { return Promise.resolve(false); } };";
  return `
      const audioMeters = (() => {
        const enabled = ${JSON.stringify(enabled)};
        const config = ${JSON.stringify(COMPOSITION_AUDIO_METER_CONFIG)};
        const measureSamples = (${measureAudioMeterSamples.toString()});
        let context = null;
        let master = null;
        let splitter = null;
        let analysers = [];
        let buffers = [];
        let sources = [];
        let timer = null;
        let resumePending = null;
        let disposed = false;
        let initializationFailed = false;
        let epoch = 0;
        let clippingUntil = [0, 0];
        const emit = (state, reason = null, channels = []) => {
          if (disposed) return;
          if (state === "BLOCKED" && audioUnlock) audioUnlock.dataset.visible = "true";
          postParentMessage({ type: "courseforge-composition-audio-meter", state, reason, channels });
        };
        const stopTimer = () => { if (timer !== null) window.clearInterval(timer); timer = null; };
        const pause = () => { epoch += 1; stopTimer(); if (enabled) emit("PAUSED"); };
        const sample = () => {
          if (!context || context.state !== "running") { stopTimer(); emit("BLOCKED", "GESTURE_REQUIRED"); return; }
          try {
            const now = performance.now();
            const channels = analysers.map((analyser, index) => {
              analyser.getFloatTimeDomainData(buffers[index]);
              const measured = measureSamples(buffers[index], config);
              if (measured.clipping) clippingUntil[index] = now + config.clippingHoldMs;
              return { ...measured, clipping: clippingUntil[index] > now };
            });
            emit("ACTIVE", null, channels);
          } catch { stopTimer(); emit("UNAVAILABLE", "ANALYSIS_FAILED"); }
        };
        const resume = () => {
          if (!enabled || disposed) return Promise.resolve(false);
          if (initializationFailed) { emit("UNAVAILABLE", "ANALYSIS_FAILED"); return Promise.resolve(false); }
          if (resumePending) {
            if (context && context.state !== "running") void context.resume().catch(() => {});
            return resumePending;
          }
          const requestEpoch = epoch;
          resumePending = (async () => {
            const media = [...document.querySelectorAll("audio.composition-audio")];
            if (media.length === 0) { emit("UNAVAILABLE", "NO_AUDIO"); return false; }
            if (media.length > config.maximumSources) { emit("UNAVAILABLE", "SOURCE_LIMIT"); return false; }
            if (media.some((element) => element.crossOrigin !== "anonymous")) { emit("UNAVAILABLE", "CORS_REQUIRED"); return false; }
            const AudioContextClass = window.AudioContext || window.webkitAudioContext;
            if (!AudioContextClass) { emit("UNAVAILABLE", "UNSUPPORTED"); return false; }
            try {
              if (!context) context = new AudioContextClass();
              if (context.state !== "running") emit("BLOCKED", "GESTURE_REQUIRED");
              await context.resume();
              if (disposed || requestEpoch !== epoch) return false;
              if (context.state !== "running") { emit("BLOCKED", "GESTURE_REQUIRED"); return false; }
              if (!master) {
                master = context.createGain();
                master.channelCount = 2;
                master.channelCountMode = "explicit";
                splitter = context.createChannelSplitter(2);
                master.connect(context.destination);
                master.connect(splitter);
                for (let index = 0; index < 2; index += 1) {
                  const analyser = context.createAnalyser();
                  analyser.fftSize = config.fftSize;
                  splitter.connect(analyser, index);
                  analysers.push(analyser);
                  buffers.push(new Float32Array(config.fftSize));
                }
              }
              if (sources.length === 0) {
                for (const element of media) {
                  const source = context.createMediaElementSource(element);
                  sources.push(source);
                  try { source.connect(master); } catch (error) { source.connect(context.destination); throw error; }
                }
              }
              stopTimer();
              timer = window.setInterval(sample, config.intervalMs);
              sample();
              return true;
            } catch (error) {
              stopTimer();
              if (error?.name === "NotAllowedError") { emit("BLOCKED", "GESTURE_REQUIRED"); return false; }
              initializationFailed = true; emit("UNAVAILABLE", "ANALYSIS_FAILED"); return false;
            }
          })().finally(() => { resumePending = null; });
          return resumePending;
        };
        const reset = () => { clippingUntil = [0, 0]; };
        window.addEventListener("pagehide", () => {
          disposed = true; epoch += 1; stopTimer();
          sources.forEach((source) => source.disconnect());
          analysers.forEach((analyser) => analyser.disconnect());
          splitter?.disconnect(); master?.disconnect();
          if (context) void context.close().catch(() => {});
        }, { once: true });
        if (enabled) emit("WAITING");
        return { pause, reset, resume };
      })();
  `;
}
