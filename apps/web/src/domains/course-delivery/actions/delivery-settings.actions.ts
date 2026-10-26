"use server";

import { z } from "zod";
import { requireDeliveryAccess } from "../services/delivery-access";
import { deliveryModelSchema, resolveDeliverySettings } from "../services/delivery-settings";
import { DELIVERY_CAPABILITIES, DELIVERY_PROMPTS } from "../config/delivery.config";

const inputSchema = z.object({
  operation: z.enum(["AGENDA", "PLAN", "MATERIALS"]),
  model: deliveryModelSchema.nullable(),
  prompt: z.string().trim().min(1).max(40000),
});
export async function getDeliverySettingsAction() {
  const { tenant, admin } = await requireDeliveryAccess(undefined, true);
  return Promise.all((["AGENDA", "PLAN", "MATERIALS"] as const).map(async operation => ({
    operation, settings: await resolveDeliverySettings(admin, tenant.organizationId, operation).catch(error => {
      if (!(error instanceof Error) || !error.message.startsWith("Configura un modelo")) throw error;
      return {
        model: { model_name: "", fallback_model: null, temperature: 0.3, thinking_level: "medium" as const },
        settingType: DELIVERY_CAPABILITIES[operation].setting, inherited: false, modelSource: "organization" as const,
        prompt: { code: DELIVERY_CAPABILITIES[operation].prompt, content: DELIVERY_PROMPTS[DELIVERY_CAPABILITIES[operation].prompt], version: "code-1", source: "default" as const },
        hash: "unconfigured",
      };
    }),
  })));
}
export async function saveDeliverySettingsAction(input: unknown) {
  const parsed = inputSchema.parse(input);
  const { tenant, admin } = await requireDeliveryAccess(undefined, true);
  const capability = DELIVERY_CAPABILITIES[parsed.operation];
  const { error } = await admin.rpc("save_course_delivery_setting", {
    p_organization_id: tenant.organizationId, p_user_id: tenant.userId,
    p_setting_type: capability.setting, p_model: parsed.model, p_prompt: parsed.prompt,
  });
  if (error) throw new Error("No se pudo guardar la configuración de generación sincrónica.");
  return { success: true };
}
