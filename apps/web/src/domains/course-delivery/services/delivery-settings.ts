import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DELIVERY_CAPABILITIES, DELIVERY_PROMPTS } from "../config/delivery.config";
import type { DeliveryOperation } from "../types/delivery.schemas";
import { getTextModelProvider } from "../../../shared/ai/text-model-provider";
import { deliveryHash } from "../lib/delivery-hash";

export const deliveryModelSchema = z.object({
  model_name: z.string().trim().min(1).max(120),
  fallback_model: z.string().trim().max(120).nullable(),
  temperature: z.number().min(0).max(2),
  thinking_level: z.enum(["minimal", "low", "medium", "high"]).nullable(),
}).superRefine((setting, context) => {
  for (const field of ["model_name", "fallback_model"] as const) {
    if (setting[field] && !getTextModelProvider(setting[field])) context.addIssue({ code: "custom", path: [field], message: "Selecciona un modelo Gemini u OpenAI compatible." });
  }
  if (setting.fallback_model && setting.fallback_model === setting.model_name) context.addIssue({ code: "custom", path: ["fallback_model"], message: "El respaldo debe ser distinto del modelo principal." });
});
export interface DeliverySettings {
  model: z.infer<typeof deliveryModelSchema>;
  settingType: string;
  inherited: boolean;
  modelSource: "organization" | "global";
  prompt: { code: string; content: string; version: string; source: "organization" | "global" | "default" };
  hash: string;
}
async function findSetting(admin: SupabaseClient, type: string, organizationId: string | null) {
  let query = admin.from("model_settings").select("model_name,fallback_model,temperature,thinking_level")
    .eq("setting_type", type).eq("is_active", true).order("id", { ascending: false }).limit(1);
  query = organizationId ? query.eq("organization_id", organizationId) : query.is("organization_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("No se pudo consultar la configuración de modelos.");
  return data;
}
async function findPrompt(admin: SupabaseClient, code: string, organizationId: string | null) {
  let query = admin.from("system_prompts").select("content,version").eq("code", code).eq("is_active", true)
    .order("updated_at", { ascending: false }).limit(1);
  query = organizationId ? query.eq("organization_id", organizationId) : query.is("organization_id", null);
  const { data, error } = await query.maybeSingle();
  if (error) throw new Error("No se pudo consultar el prompt configurado.");
  return data;
}
export async function resolveDeliverySettings(admin: SupabaseClient, organizationId: string, operation: DeliveryOperation): Promise<DeliverySettings> {
  const capability = DELIVERY_CAPABILITIES[operation];
  let selected: Awaited<ReturnType<typeof findSetting>> = null;
  let source: "organization" | "global" = "organization";
  let settingType: string = capability.setting;
  for (const type of [capability.setting, capability.parent]) {
    selected = await findSetting(admin, type, organizationId);
    if (selected) { source = "organization"; settingType = type; break; }
    selected = await findSetting(admin, type, null);
    if (selected) { source = "global"; settingType = type; break; }
  }
  if (!selected) throw new Error("Configura un modelo de la fase correspondiente antes de generar sesiones.");
  const model = deliveryModelSchema.parse(selected);
  const orgPrompt = await findPrompt(admin, capability.prompt, organizationId);
  const globalPrompt = orgPrompt ? null : await findPrompt(admin, capability.prompt, null);
  const prompt = {
    code: capability.prompt, content: orgPrompt?.content || globalPrompt?.content || DELIVERY_PROMPTS[capability.prompt],
    version: orgPrompt?.version || globalPrompt?.version || "code-1",
    source: (orgPrompt ? "organization" : globalPrompt ? "global" : "default") as "organization" | "global" | "default",
  };
  const result = { model, settingType, inherited: settingType !== capability.setting, modelSource: source, prompt };
  return { ...result, hash: deliveryHash(result) };
}
