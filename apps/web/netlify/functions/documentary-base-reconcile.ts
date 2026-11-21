import type { Config, Handler } from "@netlify/functions";
import { signBackgroundPayload } from "../../src/lib/server/background-payload-signature";
import { getFunctionsBaseUrl } from "./shared/bootstrap";
import { jsonResponse } from "./shared/http";

export const config: Config = { schedule: "*/2 * * * *" };

export const handler: Handler = async (event) => {
  if (event.httpMethod !== "POST" || event.headers["x-nf-event"] !== "schedule")
    return jsonResponse({ success: false }, 401);
  try {
    const response = await fetch(`${getFunctionsBaseUrl()}/.netlify/functions/documentary-base-reconcile-background`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(signBackgroundPayload({ operation: "reconcile-documentary-base" })),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return jsonResponse({ success: false }, 503);
    return jsonResponse({ success: true });
  } catch {
    return jsonResponse({ success: false }, 503);
  }
};
