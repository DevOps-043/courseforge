export interface AudioBatchResult {
  claimed: number;
  failed: number;
}

export interface AudioBatchLimits {
  maxJobs: number;
  maxMilliseconds: number;
}

/** Stop between jobs, allowing every claimed lease to finish before exiting. */
export async function runBoundedAudioBatches(options: {
  limits: AudioBatchLimits;
  processBatch: (limit: number) => Promise<AudioBatchResult>;
  now?: () => number;
  shouldStop?: () => boolean;
  onBatch?: (result: AudioBatchResult) => void;
}) {
  const { maxJobs, maxMilliseconds } = options.limits;
  if (!Number.isSafeInteger(maxJobs) || maxJobs < 1 || maxJobs > 100 ||
      !Number.isSafeInteger(maxMilliseconds) || maxMilliseconds < 1 || maxMilliseconds > 30 * 60 * 1000)
    throw new Error("AUDIO_BATCH_LIMITS_INVALID");
  const now = options.now ?? Date.now;
  const startedAt = now();
  let claimed = 0;
  let failed = 0;
  while (true) {
    const reason = options.shouldStop?.() ? "STOP_REQUESTED"
      : claimed >= maxJobs ? "JOB_LIMIT"
      : now() - startedAt >= maxMilliseconds ? "TIME_BUDGET" : null;
    if (reason) return { claimed, failed, reason };
    const result = await options.processBatch(1);
    claimed += result.claimed;
    failed += result.failed;
    options.onBatch?.(result);
    if (result.claimed === 0) return { claimed, failed, reason: "QUEUE_EMPTY" };
  }
}
