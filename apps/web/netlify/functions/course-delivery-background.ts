import type { Handler } from "@netlify/functions";
import { z } from "zod";
import { backgroundGuardFailureResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody, jsonResponse } from "./shared/http";
import { createServiceRoleClient } from "./shared/bootstrap";
import { executeDeliveryRun } from "../../src/domains/course-delivery/services/delivery-generation";
import { dispatchBackgroundFunctionJson } from "../../src/lib/server/background-function-client";

export const handler: Handler = async event => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  let payload: unknown;
  try { payload = await parseVerifiedBackgroundBody(event); } catch (error) { return backgroundGuardFailureResponse(error); }
  const parsed = z.object({ runId: z.uuid() }).strict().safeParse(payload);
  if (!parsed.success) return jsonResponse({ error: "Solicitud de generación inválida." }, 400);
  try {
    const result = await executeDeliveryRun(createServiceRoleClient(), parsed.data.runId);
    if (result.status === "QUEUED") await dispatchBackgroundFunctionJson("course-delivery-background", { runId: result.runId }, {
      fallbackError: "El reintento quedó en cola. Actualiza el estado para reanudar si no comienza.",
      localHandlerLoader: async () => ({ handler }),
    });
    return jsonResponse({ success: result.status !== "FAILED", ...result }, result.status === "FAILED" ? 503 : 200);
  }
  catch { return jsonResponse({ error: "No se pudo ejecutar la generación de sesiones." }, 503); }
};
