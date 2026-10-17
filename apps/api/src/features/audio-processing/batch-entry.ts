import dotenv from "dotenv";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createNodeSupabaseClient } from "../../core/supabase-client";
import { processAudioProcessingBatch } from "./audio-worker";
import { runBoundedAudioBatches } from "./audio-batch-runner";
import { WAVEFORM_AUDIO_PROFILE_ID } from "./worker-capabilities";

// CI supplies environment secrets; local use shares the web configuration.
dotenv.config({ path: path.join(__dirname, "../../../../web/.env.local") });
dotenv.config();

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`AUDIO_BATCH_ENV_MISSING_${name}`);
  return value;
}

function positiveInteger(name: string, fallback: number) {
  const raw = process.env[name];
  const parsed = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error("AUDIO_BATCH_LIMITS_INVALID");
  return parsed;
}

async function run() {
  const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const limits = {
    maxJobs: positiveInteger("AUDIO_BATCH_MAX_JOBS", 12),
    maxMilliseconds: positiveInteger("AUDIO_BATCH_MAX_MILLISECONDS", 20 * 60 * 1000),
  };
  // Fail before claiming leases if the runner cannot decode audio.
  for (const binary of ["ffmpeg", "ffprobe"])
    execFileSync(binary, ["-version"], { stdio: "ignore", timeout: 10_000, windowsHide: true });
  const supabase = createNodeSupabaseClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: init?.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) }) },
  });
  console.info("audio_batch_started", { profile: WAVEFORM_AUDIO_PROFILE_ID, ...limits });
  const summary = await runBoundedAudioBatches({
    limits,
    shouldStop: () => stopping,
    processBatch: (limit) => processAudioProcessingBatch(supabase, [WAVEFORM_AUDIO_PROFILE_ID], limit),
    onBatch: (result) => console.info("audio_processing_batch", result),
  });
  console.info("audio_batch_finished", summary);
  if (summary.failed > 0) process.exitCode = 1;
}

void run().catch((error: unknown) => {
  // Detailed per-job safe diagnostics are emitted by the worker itself.
  const code = error instanceof Error && /^[A-Z][A-Z0-9_]+$/.test(error.message)
    ? error.message : "AUDIO_BATCH_EXECUTION_FAILED";
  console.error("audio_batch_failed", { code });
  process.exitCode = 1;
});
