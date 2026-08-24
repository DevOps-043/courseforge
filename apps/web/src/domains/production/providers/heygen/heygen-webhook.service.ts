import type { SupabaseClient } from "@supabase/supabase-js";
import { encrypt } from "@/lib/server/crypto";

const HEYGEN_API_BASE_URL = "https://api.heygen.com";
const WEBHOOK_FUNCTION_NAME = "heygen-hyperframes-webhook";

interface HeygenWebhookEndpointResponse {
  endpoint_id: string;
  secret: string;
  url: string;
}

/**
 * Registers an organization-scoped HeyGen endpoint and stores its one-time
 * signing secret encrypted. The reconciliation cron remains the recovery path
 * if HeyGen cannot deliver a webhook.
 */
export async function configureHeygenHyperframesWebhook(params: {
  apiKey: string;
  organizationId: string;
  previousApiKey?: string | null;
  supabase: SupabaseClient<any, "public", any>;
}): Promise<{ callbackUrl: string; endpointId: string }> {
  const callbackUrl = buildWebhookUrl();
  const previousEndpointId = await readCurrentEndpointId(params.supabase, params.organizationId);
  const created = await createEndpoint(params.apiKey, callbackUrl);

  try {
    const { error } = await params.supabase.rpc("configure_hyperframes_webhook", {
      p_callback_url: callbackUrl,
      p_encrypted_secret: encrypt(created.secret),
      p_endpoint_id: created.endpoint_id,
      p_organization_id: params.organizationId,
    });
    if (error) throw error;
  } catch (error) {
    await deleteEndpoint(params.apiKey, created.endpoint_id).catch(() => undefined);
    throw error;
  }

  if (previousEndpointId && previousEndpointId !== created.endpoint_id) {
    await deleteEndpoint(params.previousApiKey || params.apiKey, previousEndpointId).catch((error) => {
      console.warn("[HeyGen webhook] Could not remove superseded endpoint:", {
        endpointId: previousEndpointId,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    });
  }
  return { callbackUrl, endpointId: created.endpoint_id };
}

export async function disconnectHeygenHyperframesWebhook(params: {
  apiKey: string;
  organizationId: string;
  supabase: SupabaseClient<any, "public", any>;
}): Promise<void> {
  const endpointId = await readCurrentEndpointId(params.supabase, params.organizationId);
  if (endpointId) {
    await deleteEndpoint(params.apiKey, endpointId).catch((error) => {
      console.warn("[HeyGen webhook] Could not remove endpoint during disconnect:", {
        endpointId,
        message: error instanceof Error ? error.message : "unknown_error",
      });
    });
  }
  const { error } = await params.supabase.rpc("clear_hyperframes_webhook", {
    p_organization_id: params.organizationId,
  });
  if (error) throw error;
}

async function createEndpoint(apiKey: string, callbackUrl: string): Promise<HeygenWebhookEndpointResponse> {
  const response = await fetch(`${HEYGEN_API_BASE_URL}/v3/webhooks/endpoints`, {
    body: JSON.stringify({
      events: ["hyperframes_video.success", "hyperframes_video.fail"],
      url: callbackUrl,
    }),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "X-Api-Key": apiKey.trim(),
    },
    method: "POST",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`HeyGen no pudo registrar el webhook (${response.status}).`);
  const payload = await response.json() as { data?: Partial<HeygenWebhookEndpointResponse> };
  if (!payload.data?.endpoint_id || !payload.data.secret) {
    throw new Error("HeyGen no devolvió el secreto del webhook registrado.");
  }
  return {
    endpoint_id: payload.data.endpoint_id,
    secret: payload.data.secret,
    url: payload.data.url || callbackUrl,
  };
}

async function deleteEndpoint(apiKey: string, endpointId: string): Promise<void> {
  const response = await fetch(
    `${HEYGEN_API_BASE_URL}/v3/webhooks/endpoints/${encodeURIComponent(endpointId)}`,
    {
      headers: { "X-Api-Key": apiKey.trim() },
      method: "DELETE",
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!response.ok && response.status !== 404) {
    throw new Error(`HeyGen no pudo eliminar el webhook (${response.status}).`);
  }
}

async function readCurrentEndpointId(
  supabase: SupabaseClient<any, "public", any>,
  organizationId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("hyperframes_workspace_connections")
    .select("webhook_endpoint_id")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return typeof data?.webhook_endpoint_id === "string" ? data.webhook_endpoint_id : null;
}

function buildWebhookUrl(): string {
  const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!projectUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL no está configurada.");
  const url = new URL(`/functions/v1/${WEBHOOK_FUNCTION_NAME}`, projectUrl);
  if (url.protocol !== "https:") throw new Error("El webhook de HeyGen requiere una URL HTTPS.");
  return url.toString();
}
