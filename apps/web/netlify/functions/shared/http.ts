import type { HandlerEvent, HandlerResponse } from "@netlify/functions";

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

export function parseJsonBody<TData>(event: HandlerEvent): TData {
  try {
    return JSON.parse(event.body || "{}") as TData;
  } catch {
    throw new Error("Bad Request: Invalid JSON");
  }
}
