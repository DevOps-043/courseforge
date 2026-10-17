import type { AudioWaveformDerivative } from "./audio-processing.types";

const CACHE_BUDGET_BYTES = 64 * 1024 * 1024;
const CACHE_TTL_MS = 60_000;

/** Only verified immutable derivatives enter this cache; authorization still runs on every read. */
export class AudioWaveformDerivativeCache {
  private entries = new Map<
    string,
    { derivative: AudioWaveformDerivative; weight: number; expires: number }
  >();
  private used = 0;
  get(key: string) {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.remove(key);
      return undefined;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.derivative;
  }
  set(
    key: string,
    derivative: AudioWaveformDerivative,
    serializedBytes: number,
  ) {
    // Conservative allowance for JavaScript array/object overhead.
    const weight = serializedBytes * 4;
    if (weight > CACHE_BUDGET_BYTES) return;
    this.remove(key);
    while (this.used + weight > CACHE_BUDGET_BYTES || this.entries.size >= 16)
      this.remove(this.entries.keys().next().value!);
    this.entries.set(key, {
      derivative,
      weight,
      expires: Date.now() + CACHE_TTL_MS,
    });
    this.used += weight;
  }
  private remove(key: string) {
    const previous = this.entries.get(key);
    if (previous) {
      this.used -= previous.weight;
      this.entries.delete(key);
    }
  }
}
export const audioWaveformDerivativeCache = new AudioWaveformDerivativeCache();
