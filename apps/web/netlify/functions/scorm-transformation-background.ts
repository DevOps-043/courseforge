import type { Handler } from "@netlify/functions";
import { scormProcessRequestSchema } from "../../src/domains/scorm/scorm-job-contracts";
import { ScormTransformationService } from "../../src/domains/scorm/services/scorm-transformation.service";
import {
  jsonResponse,
  methodNotAllowedResponse,
  parseVerifiedBackgroundBody,
  unauthorizedBackgroundResponse,
} from "./shared/http";
import { createServiceRoleClient } from "./shared/bootstrap";
import { createOperationalLogger, resolveCorrelationId } from "../../src/lib/server/operational-logger";

interface ScormTransformationRequest {
  correlationId?: unknown;
  importId?: unknown;
  organizationId?: unknown;
}

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  let request: ScormTransformationRequest;
  try {
    request = await parseVerifiedBackgroundBody<ScormTransformationRequest>(event);
  } catch {
    return unauthorizedBackgroundResponse();
  }

  const importId = scormProcessRequestSchema.shape.importId.safeParse(request.importId);
  const organizationId = scormProcessRequestSchema.shape.importId.safeParse(request.organizationId);
  if (!importId.success || !organizationId.success) {
    return jsonResponse({ error: "Invalid SCORM transformation request" }, 400);
  }
  const correlationId = resolveCorrelationId(
    typeof request.correlationId === "string" ? request.correlationId : null,
  );
  const logger = createOperationalLogger("scorm.transformation.background", {
    correlationId,
    importId: importId.data,
    organizationId: organizationId.data,
  });

  try {
    const result = await new ScormTransformationService(createServiceRoleClient()).processImport(
      importId.data,
      organizationId.data,
    );
    return jsonResponse({
      artifactId: result.artifactId || null,
      completed: result.completed,
      importId: importId.data,
    });
  } catch (error) {
    logger.error("scorm.transformation.failed", error);
    return jsonResponse({ correlationId, error: "SCORM transformation failed" }, 500);
  }
};
