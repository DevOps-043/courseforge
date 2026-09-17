import type { HandlerEvent, HandlerResponse } from "@netlify/functions";
import {
  verifyBackgroundPayloadEnvelope,
  type SignedBackgroundPayload,
} from "../../../src/lib/server/background-payload-signature";
import { isLocalBackgroundInvocation } from "../../../src/lib/server/background-request-environment";
import { createServiceRoleClient } from "./bootstrap";
import { getErrorMessage } from "./errors";
import { createOperationalLogger } from "../../../src/lib/server/operational-logger";

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

export class BackgroundGuardDependencyUnavailableError extends Error {
  constructor(message = "No se pudo verificar la solicitud de background.") {
    super(message);
    this.name = "BackgroundGuardDependencyUnavailableError";
  }
}

export function backgroundGuardFailureResponse(error: unknown): HandlerResponse {
  if (error instanceof BackgroundGuardDependencyUnavailableError) {
    return jsonResponse(
      {
        error: "Background request verification temporarily unavailable",
        retryable: true,
      },
      503,
    );
  }

  return unauthorizedBackgroundResponse();
}

export function parseJsonBody<TData>(event: HandlerEvent): TData {
  try {
    return JSON.parse(event.body || "{}") as TData;
  } catch {
    throw new Error("Bad Request: Invalid JSON");
  }
}

export async function parseVerifiedBackgroundBody<TData>(event: HandlerEvent): Promise<TData> {
  const logger = createOperationalLogger("background.guard", { path: event.path });

  let verified;
  try {
    const envelope = parseJsonBody<SignedBackgroundPayload>(event);
    verified = verifyBackgroundPayloadEnvelope<TData>(envelope);
  } catch (error) {
    logger.warn("background.guard_rejected", { reason: getErrorMessage(error, "envelope_invalido") });
    throw error;
  }

  if (isLocalBackgroundInvocation({
    netlify: process.env.NETLIFY,
    nodeEnv: process.env.NODE_ENV,
    rawUrl: event.rawUrl,
  })) {
    return verified.value;
  }

  let accepted: unknown;
  try {
    const admin = createServiceRoleClient();
    const { data, error } = await admin.rpc(
      "consume_background_request_nonce",
      {
        p_expires_at: new Date(verified.issuedAt + (5 * 60 * 1000)).toISOString(),
        p_nonce: verified.nonce,
      },
    );
    if (error) {
      throw error;
    }
    accepted = data;
  } catch (error) {
    // Fallo de infraestructura (credenciales, RPC ausente, base inalcanzable): no es un
    // rechazo de seguridad y debe quedar registrado, porque el llamador ya recibio 202.
    logger.error("background.guard_dependency_unavailable", error);
    throw new BackgroundGuardDependencyUnavailableError();
  }

  if (accepted !== true) {
    logger.warn("background.guard_rejected", { reason: "nonce_consumido" });
    throw new Error("Replay de background rechazado.");
  }

  return verified.value;
}
