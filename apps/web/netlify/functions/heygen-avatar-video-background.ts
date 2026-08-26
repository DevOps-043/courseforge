import type { Handler } from "@netlify/functions";
import {
  verifyBackgroundPayload,
  type SignedBackgroundPayload,
} from "../../src/lib/server/background-payload-signature";
import {
  runHeygenAvatarVideoBackground,
  type HeygenAvatarVideoBackgroundRequest,
} from "../../src/domains/production/providers/heygen/heygen-video-background.service";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const envelope = parseJsonBody<SignedBackgroundPayload>(event);
  const request = verifyBackgroundPayload<HeygenAvatarVideoBackgroundRequest>(
    envelope,
  );
  await runHeygenAvatarVideoBackground(request);
  return { statusCode: 200, body: "completed" };
};
