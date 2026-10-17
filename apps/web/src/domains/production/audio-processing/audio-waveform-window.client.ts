import type { AudioWaveformPreview } from "./audio-processing.types";

const MAX_READS = 3;
const MAX_CACHE_ENTRIES = 128;
let active = 0;
const waiting: (() => void)[] = [];
const cache = new Map<string, AudioWaveformPreview>();

/** Bounded, checksum-keyed cache. Authorization context is included in every key. */
export async function readWaveformWindow(input: {
  componentId: string;
  assetId: string;
  checksum: string;
  start: number;
  end: number;
  width: number;
  signal: AbortSignal;
}): Promise<AudioWaveformPreview> {
  const query = new URLSearchParams({
    componentId: input.componentId,
    start: String(input.start),
    end: String(input.end),
    width: String(input.width),
  });
  const path = `/api/production/audio-analysis/assets/${encodeURIComponent(input.assetId)}/waveform?${query}`;
  const key = `${input.checksum}:${path}`;
  const cached = cache.get(key);
  if (cached) return cached;
  await new Promise<void>((resolve, reject) => {
    if (input.signal.aborted) {
      reject(input.signal.reason);
      return;
    }
    const acquire = () => {
      input.signal.removeEventListener("abort", cancel);
      active += 1;
      resolve();
    };
    const cancel = () => {
      const position = waiting.indexOf(acquire);
      if (position >= 0) waiting.splice(position, 1);
      reject(input.signal.reason);
    };
    if (active < MAX_READS) acquire();
    else {
      waiting.push(acquire);
      input.signal.addEventListener("abort", cancel, { once: true });
    }
  });
  try {
    input.signal.throwIfAborted();
    const response = await fetch(path, {
      signal: AbortSignal.any([input.signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok) throw new Error("WAVEFORM_WINDOW_UNAVAILABLE");
    const { data } = (await response.json()) as { data: AudioWaveformPreview };
    if (data.checksum !== input.checksum)
      throw new Error("WAVEFORM_SOURCE_CHANGED");
    cache.set(key, data);
    if (cache.size > MAX_CACHE_ENTRIES)
      cache.delete(cache.keys().next().value!);
    return data;
  } finally {
    active -= 1;
    waiting.shift()?.();
  }
}
