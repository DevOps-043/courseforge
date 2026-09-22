import dotenv from "dotenv";
import path from "node:path";
import { createNodeSupabaseClient } from "../../core/supabase-client";
import { processAudioProcessingBatch } from "./audio-worker";
import { configureManagedDeepFilterRuntime } from "./deepfilter-runtime-config";

dotenv.config({ path: path.join(__dirname, "../../../web/.env.local") });
dotenv.config();

const supabaseUrl = requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
const pollMilliseconds = boundedPositiveInteger(process.env.AUDIO_PROCESSING_POLL_MILLISECONDS, 5_000, 1_000, 60_000);
const batchSize = boundedPositiveInteger(process.env.AUDIO_PROCESSING_BATCH_SIZE, 1, 1, 4);
const supabase = createNodeSupabaseClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

async function run() {
  while (!stopping) {
    try {
      const result = await processAudioProcessingBatch(supabase, batchSize);
      if (result.claimed > 0) console.info("audio_processing_batch", result);
    } catch (error) {
      console.error("audio_processing_batch_failed", { code: error instanceof Error ? error.message : "UNKNOWN" });
    }
    await delay(pollMilliseconds);
  }
}

function requiredEnvironment(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function boundedPositiveInteger(raw: string | undefined, fallback: number, min: number, max: number) {
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

void configureManagedDeepFilterRuntime().then(run).catch((error) => {
  console.error("audio_processing_worker_startup_failed", {
    code: error instanceof Error ? error.message : "UNKNOWN",
  });
  process.exitCode = 1;
});
