import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import dotenv from "dotenv";

const require = createRequire(import.meta.url);
async function main() {
  dotenv.config({ path: fileURLToPath(new URL("../apps/web/.env.local", import.meta.url)), quiet: true });
  dotenv.config({ quiet: true });
  if (process.env.HYPERFRAMES_CONFORMANCE_WORKER_ENABLED !== "true") throw new Error("CONFORMANCE_JOB_WORKER_NOT_ENABLED");
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !key) throw new Error("CONFORMANCE_JOB_ENVIRONMENT_MISSING");
  const { createNodeSupabaseClient } = require("../apps/api/dist/core/supabase-client.js");
  const { snapshotImportedHyperframesVideo, checkImportedHyperframesVideo } = require("../apps/api/dist/features/video-integrity/video-integrity.service.js");
  const { processConformanceJob, classifyConformanceJobFailure } = require("../apps/web/dist/composition-worker/domains/production/composition-editor/qa/composition-conformance-job-worker.js");
  const { executeConformanceJob } = require("../apps/web/dist/composition-worker/domains/production/composition-editor/qa/composition-conformance-job-execution.js");
  const { RenderInternals } = require("@remotion/renderer");
  const ffmpegPath = RenderInternals.getExecutablePath({ binariesDirectory: null, indent: false, logLevel: "error", type: "ffmpeg" });
  const supabase = createNodeSupabaseClient(supabaseUrl, key, { auth: { persistSession: false } });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    while (!shutdown.signal.aborted) {
      try {
        const result = await processConformanceJob(supabase, (claim, signal) => executeConformanceJob({ claim, signal, supabase, supabaseUrl, ffmpegPath,
          allowLongAudio: process.env.HYPERFRAMES_CONFORMANCE_LONG_AUDIO_ENABLED === "true",
          capturePlaybackAudio: process.env.HYPERFRAMES_CONFORMANCE_PLAYBACK_AUDIO_ENABLED === "true" },
          { snapshot: snapshotImportedHyperframesVideo, recheck: checkImportedHyperframesVideo }), undefined, {signal: shutdown.signal});
        if (result.status !== "IDLE") console.info("conformance_job", result);
      } catch (error) { console.error("conformance_worker_failed", classifyConformanceJobFailure(error)); }
      try { await delay(5_000, undefined, { signal: shutdown.signal }); }
      catch (error) { if (!shutdown.signal.aborted) throw error; }
    }
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}
void main().catch((error) => {
  const code = error instanceof Error && /^CONFORMANCE_JOB_[A-Z_]+$/.test(error.message) ? error.message : "CONFORMANCE_JOB_STARTUP_FAILED";
  console.error("conformance_worker_startup_failed", { code }); process.exitCode = 1;
});
