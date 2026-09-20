import type { Handler } from "@netlify/functions";
import {
  verifyBackgroundPayload,
  type SignedBackgroundPayload,
} from "../../src/lib/server/background-payload-signature";
import {
  runHeygenCatalogBackground,
  type HeygenCatalogBackgroundRequest,
} from "../../src/domains/production/providers/heygen/heygen-catalog-background.service";
import { createOperationalLogger } from "../../src/lib/server/operational-logger";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  const envelope = parseJsonBody<SignedBackgroundPayload>(event);
  const request = verifyBackgroundPayload<HeygenCatalogBackgroundRequest>(envelope);
  const logger = createOperationalLogger("production.heygen.catalog_background", {
    correlationId: request.requestId,
  });
  try {
    logger.info("production.heygen.catalog_background.started", {
      organizationId: request.organizationId,
      syncRunId: request.syncRunId,
    });
    const result = await runHeygenCatalogBackground(request);
    logger.info("production.heygen.catalog_background.completed", {
      assetCount: result.assetCount,
      avatarCount: result.avatarCount,
      organizationId: request.organizationId,
      syncRunId: request.syncRunId,
      voiceCount: result.voiceCount,
    });
    return { statusCode: 200, body: "completed" };
  } catch (error) {
    logger.error("production.heygen.catalog_background.failed", error, {
      organizationId: request.organizationId,
      syncRunId: request.syncRunId,
    });
    throw error;
  }
};
