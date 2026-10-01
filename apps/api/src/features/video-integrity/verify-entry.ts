import dotenv from "dotenv";
import path from "node:path";
import { createNodeSupabaseClient } from "../../core/supabase-client";
import { writeVerifiedVideoReceipt } from "./video-integrity.receipt";
import { checkImportedHyperframesVideo, verifyImportedHyperframesVideo } from "./video-integrity.service";

dotenv.config({ path: path.join(__dirname, "../../../web/.env.local") });
dotenv.config();

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

async function main() {
  const argumentsList = process.argv.slice(2);
  const checkOnly = argumentsList.includes("--check-only");
  const receiptOptionIndex = argumentsList.indexOf("--receipt-output");
  const receiptOutput = receiptOptionIndex >= 0 ? argumentsList[receiptOptionIndex + 1] : undefined;
  const [organizationId, requestId, ...extra] = argumentsList.filter((value, index) =>
    value !== "--check-only" && (receiptOptionIndex < 0 || (index !== receiptOptionIndex && index !== receiptOptionIndex + 1)));
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!organizationId || !requestId || extra.length > 0 || !uuidPattern.test(organizationId) || !uuidPattern.test(requestId)
    || (receiptOptionIndex >= 0 && (!checkOnly || !receiptOutput || receiptOutput.startsWith("--")))) {
    throw new Error("VIDEO_INTEGRITY_ARGUMENTS_INVALID");
  }
  const supabaseUrl = process.env.SUPABASE_URL?.trim() || requiredEnvironment("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnvironment("SUPABASE_SERVICE_ROLE_KEY");
  const supabase = createNodeSupabaseClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const input = { organizationId, requestId, supabase, supabaseUrl };
  if (checkOnly) {
    const result = await checkImportedHyperframesVideo(input);
    if (receiptOutput) await writeVerifiedVideoReceipt(receiptOutput, result);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }
  const result = await verifyImportedHyperframesVideo(input);
  process.stdout.write(`${JSON.stringify({ status: "VERIFIED", ...result })}\n`);
}

void main().catch((error) => {
  const code = error instanceof Error && /^VIDEO_INTEGRITY_[A-Z_]+$/.test(error.message)
    ? error.message
    : "VIDEO_INTEGRITY_FAILED";
  process.stderr.write(`${code}\n`);
  process.exitCode = 1;
});
