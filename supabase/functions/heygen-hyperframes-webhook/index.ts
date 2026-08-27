import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { decryptAes256Gcm, hmacSha256Hex, sha256Hex, timingSafeEqualHex } from "../_shared/crypto.ts";
import { getEncryptionKeyHex } from "../_shared/env.ts";
import { jsonResponse, logEvent, methodNotAllowed } from "../_shared/http.ts";
import { rpc } from "../_shared/supabase.ts";

const MAX_BODY_BYTES = 256 * 1024;
const MAX_TIMESTAMP_SKEW_SECONDS = 300;
const TERMINAL_EVENT = /^[a-z][a-z0-9_]{0,80}\.(?:success|fail)$/;

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
    const providerRenderId = readProviderId(eventData);
    // A workspace-level endpoint also receives videos created outside
    // Courseforge. They have no callback_id and are deliberately ignored.
    if (!isUuid(callbackId)) {
      return jsonResponse({ accepted: true, ignored: "uncorrelated_event" }, 202);
    }
    if (!eventType || !TERMINAL_EVENT.test(eventType)) {
      return jsonResponse({ accepted: true, ignored: "unsupported_correlated_event" }, 202);
    }
    if (providerRenderId.length > 255) {
      return jsonResponse({ error: "invalid_provider_id" }, 400);
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
    const payloadSha256 = await sha256Hex(rawBody);
    const isHyperframes = eventType.startsWith("hyperframes_video.");
    const result = isHyperframes
      ? await rpc<Array<{ action: string; duplicate: boolean; request_id: string }>>(
          "record_hyperframes_webhook_event",
          {
            p_callback_id: callbackId,
            p_event_id: eventId,
            p_event_type: eventType,
            p_failure_message: failureMessage || null,
            p_payload_sha256: payloadSha256,
            p_provider_render_id: providerRenderId,
          },
        )
      : await rpc<Array<{ action: string; duplicate: boolean; operation_id: string }>>(
          "record_heygen_platform_webhook_event",
          {
            p_callback_id: callbackId,
            p_event_data: eventData,
            p_event_id: eventId,
            p_event_type: eventType,
            p_failure_message: failureMessage || null,
            p_payload_sha256: payloadSha256,
            p_provider_id: providerRenderId,
          },
        );
    const correlatedId = isHyperframes
      ? (result[0] as { request_id?: string } | undefined)?.request_id
      : (result[0] as { operation_id?: string } | undefined)?.operation_id;
    logEvent("info", "heygen_webhook_processed", {
      action: result[0]?.action,
      duplicate: result[0]?.duplicate,
      eventId,
      correlatedId,
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

function readProviderId(data: Record<string, unknown>): string {
  for (const key of [
    "render_id", "video_id", "video_translation_id", "session_id", "lipsync_id",
    "ai_clipping_id", "filler_word_removal_id", "proofread_id", "batch_id", "voice_clone_id", "id",
  ]) {
    const value = readString(data[key]);
    if (value) return value;
  }
  return "";
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
