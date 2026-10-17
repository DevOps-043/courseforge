import dotenv from "dotenv";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { createNodeSupabaseClient } from "../../core/supabase-client";
import { classifyVideoIntegrityFailure, processVideoIntegrityJob } from "./video-integrity.worker";

dotenv.config({ path: path.join(__dirname, "../../../web/.env.local") });
dotenv.config();

async function main() {
  if (process.env.HYPERFRAMES_VIDEO_INTEGRITY_WORKER_ENABLED !== "true") {
    throw new Error("VIDEO_INTEGRITY_WORKER_NOT_ENABLED");
  }
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !key) throw new Error("VIDEO_INTEGRITY_ENVIRONMENT_MISSING");
  const supabase = createNodeSupabaseClient(supabaseUrl, key, { auth: { persistSession: false } });
  const shutdown = new AbortController();
  const stop = () => shutdown.abort();
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  try {
    while (!shutdown.signal.aborted) {
      try {
        const result = await processVideoIntegrityJob(supabase, supabaseUrl);
        if (result.status !== "IDLE") console.info("video_integrity_job", result);
      } catch (error) {
        console.error("video_integrity_worker_failed", { code: classifyVideoIntegrityFailure(error).code });
      }
      try { await delay(5_000, undefined, { signal: shutdown.signal }); }
      catch (error) { if (!shutdown.signal.aborted) throw error; }
    }
  } finally { process.removeListener("SIGINT", stop); process.removeListener("SIGTERM", stop); }
}

void main().catch((error) => {
  console.error("video_integrity_worker_startup_failed", { code: classifyVideoIntegrityFailure(error).code });
  process.exitCode = 1;
});
