import { createClient } from "@supabase/supabase-js";
import { resolveModelSetting } from "./shared/bootstrap";
import { runCurationWorkflowV2 } from "./shared/curation-v2/workflow";

interface UnifiedCurationParams {
  artifactId: string;
  curationId: string;
  customPrompt?: string;
  supabaseUrl: string;
  supabaseKey: string;
  openAiApiKey?: string | null;
  resume?: boolean;
}

const OPENAI_CURATION_DEFAULTS = {
  model: process.env.OPENAI_CURATION_MODEL || "gpt-5.4-mini",
  fallbackModel: process.env.OPENAI_CURATION_MODEL || "gpt-5.4-mini",
  temperature: 0.1,
  thinkingLevel: "low",
};

export async function processUnifiedCuration({
  artifactId,
  curationId,
  customPrompt,
  supabaseUrl,
  supabaseKey,
  openAiApiKey,
  resume,
}: UnifiedCurationParams) {
  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required for curation v2.");
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { data: artifact, error } = await supabase
    .from("artifacts")
    .select("organization_id")
    .eq("id", artifactId)
    .single();
  if (error) throw new Error(error.message);

  const setting = await resolveModelSetting(
    supabase,
    "CURATION",
    OPENAI_CURATION_DEFAULTS,
    artifact?.organization_id || null,
  );
  const configuredModel = setting.model || OPENAI_CURATION_DEFAULTS.model;
  const model = configuredModel.toLowerCase().startsWith("gemini-")
    ? OPENAI_CURATION_DEFAULTS.model
    : configuredModel;

  console.log(
    `[Curation V2] OpenAI-only workflow. Model: ${model}. Artifact: ${artifactId}.`,
  );
  return runCurationWorkflowV2({
    artifactId,
    curationId,
    customPrompt,
    model,
    openAiApiKey,
    supabase,
    resume,
  });
}
