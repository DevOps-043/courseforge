import type { HandlerEvent, HandlerResponse } from "@netlify/functions";
import {
  verifyBackgroundPayloadEnvelope,
  type SignedBackgroundPayload,
} from "../../../src/lib/server/background-payload-signature";
import { createServiceRoleClient } from "./bootstrap";

export function jsonResponse(
  body: Record<string, unknown>,
  statusCode: number = 200,
): HandlerResponse {
  return {
    statusCode,
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  };
}

export function methodNotAllowedResponse(): HandlerResponse {
  return {
    statusCode: 405,
    body: "Method Not Allowed",
  };
}

export function unauthorizedBackgroundResponse(): HandlerResponse {
  return jsonResponse({ error: "Unauthorized background request" }, 401);
}

export function parseJsonBody<TData>(event: HandlerEvent): TData {
  try {
    return JSON.parse(event.body || "{}") as TData;
  } catch {
    throw new Error("Bad Request: Invalid JSON");
  }
}

export async function parseVerifiedBackgroundBody<TData>(event: HandlerEvent): Promise<TData> {
  const envelope = parseJsonBody<SignedBackgroundPayload>(event);
  const verified = verifyBackgroundPayloadEnvelope<TData>(envelope);
  const admin = createServiceRoleClient();
  const { data: accepted, error } = await admin.rpc(
    "consume_background_request_nonce",
    {
      p_expires_at: new Date(verified.issuedAt + (5 * 60 * 1000)).toISOString(),
      p_nonce: verified.nonce,
    },
  );
  if (error || accepted !== true) {
    throw new Error("Replay de background rechazado.");
  }
  return verified.value;
}
