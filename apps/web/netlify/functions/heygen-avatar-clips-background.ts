import type { Handler } from "@netlify/functions";
import {
  verifyBackgroundPayload,
  type SignedBackgroundPayload,
} from "../../src/lib/server/background-payload-signature";
import {
  runHeygenAvatarClipsBackground,
  type HeygenAvatarClipsBackgroundRequest,
} from "../../src/domains/production/providers/heygen/heygen-avatar-background.service";
import { methodNotAllowedResponse, parseJsonBody } from "./shared/http";

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST") return methodNotAllowedResponse();

  const envelope = parseJsonBody<SignedBackgroundPayload>(event);
  const request = verifyBackgroundPayload<HeygenAvatarClipsBackgroundRequest>(
    envelope,
  );
  await runHeygenAvatarClipsBackground(request);
  return { statusCode: 200, body: "completed" };
};
