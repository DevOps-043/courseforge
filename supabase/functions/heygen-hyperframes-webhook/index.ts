import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { decryptAes256Gcm, hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "../_shared/crypto.ts";
import { getEncryptionKeyHex } from "../_shared/env.ts";
import { jsonResponse, logEvent, methodNotAllowed } from "../_shared/http.ts";
import { rpc } from "../_shared/supabase.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TIMESTAMP_SKEW_SECONDS = 300;
const SUPPORTED_EVENTS = new Set(["hyperframes_video.success", "hyperframes_video.fail"]);

interface WebhookEvent {
  event_data?: Record<string, unknown>;
  event_id?: string;
  event_type?: string;
}

interface VerificationContext {
  encrypted_secret: string;
  organization_id: string;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return methodNotAllowed();

  try {
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (declaredLength > MAX_BODY_BYTES) return jsonResponse({ error: "payload_too_large" }, 413);
    const rawBody = new Uint8Array(await request.arrayBuffer());
    if (rawBody.byteLength === 0 || rawBody.byteLength > MAX_BODY_BYTES) {
      return jsonResponse({ error: "invalid_payload_size" }, 400);
    }

    const event = JSON.parse(new TextDecoder().decode(rawBody)) as WebhookEvent;
    const eventType = readString(event.event_type);
    const eventData = event.event_data && typeof event.event_data === "object" ? event.event_data : {};
    const callbackId = readString(eventData.callback_id);
    const providerRenderId = readString(eventData.render_id) || readString(eventData.video_id);
    if (
      !eventType
      || !isUuid(callbackId)
      || !providerRenderId
      || providerRenderId.length > 255
      || !SUPPORTED_EVENTS.has(eventType)
    ) {
      return jsonResponse({ error: "unsupported_or_uncorrelated_event" }, 400);
    }

    const timestamp = parseTimestamp(request.headers.get("heygen-timestamp"));
    if (timestamp === null || Math.abs(Date.now() / 1000 - timestamp) > MAX_TIMESTAMP_SKEW_SECONDS) {
      return jsonResponse({ error: "stale_or_invalid_timestamp" }, 400);
    }
    const signature = request.headers.get("heygen-signature")?.trim() || "";
    const eventId = request.headers.get("heygen-event-id")?.trim() || readString(event.event_id);
    if (!signature || !eventId || eventId.length > 255) {
      return jsonResponse({ error: "missing_signature_headers" }, 400);
    }

    const contexts = await rpc<VerificationContext[]>("get_heygen_webhook_verification_context", {
      p_callback_id: callbackId,
    });
    const context = contexts[0];
    if (!context) return jsonResponse({ error: "unknown_callback" }, 404);

    const secret = await decryptAes256Gcm(context.encrypted_secret, getEncryptionKeyHex());
    const expectedSignature = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqualHex(signature, expectedSignature)) {
      logEvent("warn", "heygen_webhook_signature_rejected", { callbackId, eventId });
      return jsonResponse({ error: "invalid_signature" }, 401);
    }

    const failureMessage = readString(eventData.failure_message)
      || readString(eventData.error_message)
      || readString(eventData.message);
    const result = await rpc<Array<{ action: string; duplicate: boolean; request_id: string }>>(
      "record_hyperframes_webhook_event",
      {
        p_callback_id: callbackId,
        p_event_id: eventId,
        p_event_type: eventType,
        p_failure_message: failureMessage || null,
        p_payload_sha256: await sha256Hex(rawBody),
        p_provider_render_id: providerRenderId,
      },
    );
    logEvent("info", "heygen_webhook_processed", {
      action: result[0]?.action,
      duplicate: result[0]?.duplicate,
      eventId,
      requestId: result[0]?.request_id,
    });
    return jsonResponse({ accepted: true, duplicate: result[0]?.duplicate || false });
  } catch (error) {
    logEvent("error", "heygen_webhook_failed", {
      message: error instanceof Error ? error.message : "unknown_error",
    });
    return jsonResponse({ error: "webhook_processing_failed" }, 500);
  }
});

function readString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseTimestamp(value: string | null): number | null {
  if (!value || !/^\d{10,13}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) return null;
  return value.length === 13 ? parsed / 1000 : parsed;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
