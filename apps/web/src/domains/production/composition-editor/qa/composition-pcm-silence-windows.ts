const BYTES_PER_SAMPLE = 4;
const MAXIMUM_PCM_BYTES = 32 * 1024 * 1024;

/** Bounded interleaved PCM f32le measurement. Windows overlap by at most 50%; tails are measured. */
export function measurePcmSilenceWindows(input: {pcm: Buffer; channelCount: number; startFrame: number;
  endFrame: number; windowFrames: number; hopFrames: number}) {
  const {pcm, channelCount, startFrame, endFrame, windowFrames, hopFrames} = input;
  if (!Buffer.isBuffer(pcm) || pcm.length < BYTES_PER_SAMPLE || pcm.length > MAXIMUM_PCM_BYTES
    || !Number.isSafeInteger(channelCount) || channelCount < 1 || channelCount > 8
    || pcm.length % (channelCount * BYTES_PER_SAMPLE)
    || [startFrame, endFrame, windowFrames, hopFrames].some(value => !Number.isSafeInteger(value))
    || startFrame < 0 || endFrame <= startFrame || endFrame > pcm.length / (channelCount * BYTES_PER_SAMPLE)
    || windowFrames < 1 || windowFrames > endFrame - startFrame || hopFrames < Math.ceil(windowFrames / 2)
    || hopFrames > windowFrames) throw new Error("CONFORMANCE_PCM_SILENCE_ARGUMENT_INVALID");
  let maximumRms = 0, windowCount = 0;
  for (let channel = 0; channel < channelCount; channel++) {
    for (let start = startFrame; start < endFrame; start += hopFrames) {
      const end = Math.min(start + windowFrames, endFrame);
      let power = 0;
      for (let frame = start; frame < end; frame++) {
        const sample = pcm.readFloatLE((frame * channelCount + channel) * BYTES_PER_SAMPLE);
        if (!Number.isFinite(sample)) throw new Error("CONFORMANCE_PCM_SILENCE_SAMPLE_INVALID");
        power += sample ** 2;
      }
      maximumRms = Math.max(maximumRms, Math.sqrt(power / (end - start)));
      windowCount++;
    }
  }
  return {maximumRms, windowCount};
}
