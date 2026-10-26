import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { backgroundGuardFailureResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody, jsonResponse } from "./shared/http";
import { createServiceRoleClient } from "./shared/bootstrap";
import { executeDeliveryRun } from "../../src/domains/course-delivery/services/delivery-generation";

export const handler: Handler = async event => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  let payload: unknown;
  try { payload = await parseVerifiedBackgroundBody(event); } catch (error) { return backgroundGuardFailureResponse(error); }
  const parsed = z.object({ runId: z.uuid() }).strict().safeParse(payload);
  if (!parsed.success) return jsonResponse({ error: "Solicitud de generación inválida." }, 400);
  try { await executeDeliveryRun(createServiceRoleClient(), parsed.data.runId); return jsonResponse({ success: true }); }
  catch { return jsonResponse({ error: "No se pudo ejecutar la generación de sesiones." }, 503); }
};
