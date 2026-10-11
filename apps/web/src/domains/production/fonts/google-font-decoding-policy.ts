/** Server decoding budget, separate from compressed acquisition and render quotas. */
export const GOOGLE_FONT_DECODING_POLICY = Object.freeze({
  maximumDecodedBytes: 32 * 1024 * 1024,
  maximumTables: 256,
  maximumGlyphs: 65535,
  maximumPathCommands: 2_000_000,
  maximumCoverageRanges: 8192,
  timeoutMs: 5000,
  workerHeapMb: 96,
});
