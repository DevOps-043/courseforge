import type { Handler } from "@netlify/functions";
import { publicationOutboxRequestSchema } from "../../src/domains/publication/publication-outbox";
import { PublicationOutboxService } from "../../src/domains/publication/publication-outbox.service";
import { createOperationalLogger, resolveCorrelationId } from "../../src/lib/server/operational-logger";
import { createServiceRoleClient } from "./shared/bootstrap";
import { jsonResponse, methodNotAllowedResponse, parseVerifiedBackgroundBody, unauthorizedBackgroundResponse } from "./shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  let body: unknown;
  try {
    body = await parseVerifiedBackgroundBody(event);
  } catch {
    return unauthorizedBackgroundResponse();
  }
  const parsed = publicationOutboxRequestSchema.safeParse(body);
  if (!parsed.success) return jsonResponse({ error: "Invalid publication request" }, 400);
  const correlationId = resolveCorrelationId(parsed.data.correlationId);
  const logger = createOperationalLogger("publication.background", {
    correlationId,
    requestId: parsed.data.requestId,
  });

  try {
    const result = await new PublicationOutboxService(createServiceRoleClient()).process(parsed.data.requestId);
    return jsonResponse({ requestId: parsed.data.requestId, ...result });
  } catch (error) {
    logger.error("publication.background.failed", error);
    return jsonResponse({ correlationId, error: "Publication delivery failed" }, 500);
  }
};
