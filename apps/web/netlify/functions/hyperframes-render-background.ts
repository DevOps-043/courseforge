import type { Handler } from "@netlify/functions";
import { runHyperframesRenderBackground } from "../../src/domains/production/hyperframes/hyperframes-render-background.service";
import { methodNotAllowedResponse, parseVerifiedBackgroundBody, unauthorizedBackgroundResponse } from "./shared/http";

type RenderBackgroundRequest = {
  renderRequestId?: string;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  let request: RenderBackgroundRequest;
  try {
    request = await parseVerifiedBackgroundBody<RenderBackgroundRequest>(event);
  } catch {
    return unauthorizedBackgroundResponse();
  }
  const { renderRequestId } = request;
  if (!renderRequestId) throw new Error("Missing renderRequestId");

  await runHyperframesRenderBackground(renderRequestId);
  return { statusCode: 200, body: "completed" };
};
