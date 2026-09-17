import type { Handler } from "@netlify/functions";
import { scormProcessRequestSchema } from "../../src/domains/scorm/scorm-job-contracts";
import { ScormParsingService } from "../../src/domains/scorm/services/scorm-parsing.service";
import { createServiceRoleClient } from "./shared/bootstrap";
import { createOperationalLogger, resolveCorrelationId } from "../../src/lib/server/operational-logger";
import {
  jsonResponse,
  methodNotAllowedResponse,
  parseVerifiedBackgroundBody,
  backgroundGuardFailureResponse,
} from "./shared/http";

interface ScormParsingRequest {
  correlationId?: unknown;
  importId?: unknown;
  organizationId?: unknown;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  let request: ScormParsingRequest;
  try {
    request = await parseVerifiedBackgroundBody<ScormParsingRequest>(event);
  } catch (error) {
    return backgroundGuardFailureResponse(error);
  }

  const importId = scormProcessRequestSchema.shape.importId.safeParse(request.importId);
  const organizationId = scormProcessRequestSchema.shape.importId.safeParse(request.organizationId);
  if (!importId.success || !organizationId.success) {
    return jsonResponse({ error: "Invalid SCORM parsing request" }, 400);
  }
  const correlationId = resolveCorrelationId(
    typeof request.correlationId === "string" ? request.correlationId : null,
  );
  const logger = createOperationalLogger("scorm.parsing.background", {
    correlationId,
    importId: importId.data,
    organizationId: organizationId.data,
  });

  try {
    const result = await new ScormParsingService(createServiceRoleClient()).processImport(
      importId.data,
      organizationId.data,
    );
    return jsonResponse({ importId: importId.data, ...result });
  } catch (error) {
    logger.error("scorm.parsing.failed", error);
    return jsonResponse({ correlationId, error: "SCORM parsing failed" }, 500);
  }
};
