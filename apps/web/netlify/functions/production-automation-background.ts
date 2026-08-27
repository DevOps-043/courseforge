import type { Handler } from "@netlify/functions";
import {
  verifyBackgroundPayload,
  type SignedBackgroundPayload,
} from "../../src/lib/server/background-payload-signature";
import { runProductionAutomationBackground } from "../../src/domains/production/automation/production-automation-background.service";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();
  const request = verifyBackgroundPayload<{ organizationId: string; runId: string }>(
    parseJsonBody<SignedBackgroundPayload>(event),
  );
  await runProductionAutomationBackground(request);
  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
