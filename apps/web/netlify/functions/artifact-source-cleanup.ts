import type { Config, Handler } from "@netlify/functions";
import { cleanDeletedArtifactSources } from "../../src/domains/artifacts/services/artifact-source-cleanup";
import { createOperationalLogger, resolveCorrelationId } from "../../src/lib/server/operational-logger";
import { createServiceRoleClient } from "./shared/bootstrap";
import { jsonResponse, methodNotAllowedResponse } from "./shared/http";

export const config: Config = { schedule: "*/5 * * * *" };

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  if (event.headers["x-nf-event"] !== "schedule") {
    return jsonResponse({ error: "Se requiere una invocación programada." }, 401);
  }

  const logger = createOperationalLogger("artefactos.limpieza_documental", { correlationId: resolveCorrelationId() });
  try {
    const processed = await cleanDeletedArtifactSources(createServiceRoleClient());
    if (processed) logger.info("artefacto.limpieza_documental_completada", { procesados: processed });
    return jsonResponse({ processed });
  } catch {
    logger.warn("artefacto.limpieza_documental_pendiente");
    return jsonResponse({ error: "No se pudo completar la limpieza documental." }, 503);
  }
};
