import type { Handler } from "@netlify/functions";
import { runHyperframesRenderBackground } from "../../src/domains/production/hyperframes/hyperframes-render-background.service";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

type RenderBackgroundRequest = {
  renderRequestId?: string;
};

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const { renderRequestId } = parseJsonBody<RenderBackgroundRequest>(event);
  if (!renderRequestId) throw new Error("Missing renderRequestId");

  await runHyperframesRenderBackground(renderRequestId);
  return { statusCode: 200, body: "completed" };
};
