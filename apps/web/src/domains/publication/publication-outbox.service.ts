import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSofliaInboxEnv } from "@/lib/server/env";
import { createOperationalLogger, resolveCorrelationId } from "@/lib/server/operational-logger";
import {
  hashPublicationPayload,
  PUBLICATION_OUTBOX_LEASE_SECONDS,
  PUBLICATION_OUTBOX_STEP,
  publicationOutboxPayloadSchema,
} from "./publication-outbox";

interface PublicationOutboxRecord {
  id: string;
  correlation_id: string | null;
  idempotency_key: string;
  outbox_payload: unknown;
  outbox_payload_hash: string;
}

const SOFLIA_INBOX_TIMEOUT_MS = 15_000;

function fetchSofliaWithDeadline(input: RequestInfo | URL, init?: RequestInit) {
  const timeoutSignal = AbortSignal.timeout(SOFLIA_INBOX_TIMEOUT_MS);
  const signal = init?.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal;
  return fetch(input, { ...init, signal });
}

export class PublicationOutboxService {
  constructor(private readonly supabase: SupabaseClient) {}

  async process(requestId: string) {
    const { data, error } = await this.supabase.rpc("claim_publication_outbox", {
      p_lease_seconds: PUBLICATION_OUTBOX_LEASE_SECONDS,
      p_request_id: requestId,
    });
    if (error) throw new Error(`PUBLICATION_CLAIM_FAILED: ${error.message}`);
    const rawClaim = Array.isArray(data) ? data[0] : data;
    if (!rawClaim) return { delivered: false, alreadyProcessing: true };

    const claim = rawClaim as PublicationOutboxRecord;
    const correlationId = resolveCorrelationId(claim.correlation_id);
    const logger = createOperationalLogger("publication.outbox", { correlationId, requestId });
    const startedAt = Date.now();
    logger.info("publication.delivery.started");
    const parsedPayload = publicationOutboxPayloadSchema.safeParse(claim.outbox_payload);
    if (!parsedPayload.success) return this.recordRetryableFailure(claim, "INVALID_OUTBOX_PAYLOAD");
    if (hashPublicationPayload(parsedPayload.data) !== claim.outbox_payload_hash) {
      return this.recordRetryableFailure(claim, "OUTBOX_PAYLOAD_HASH_MISMATCH");
    }
    if (parsedPayload.data.course.slug !== claim.idempotency_key) {
      return this.recordRetryableFailure(claim, "OUTBOX_IDEMPOTENCY_KEY_MISMATCH");
    }

    const inboxEnv = getSofliaInboxEnv();
    const soflia = createSupabaseClient(inboxEnv.url, inboxEnv.key, {
      global: { fetch: fetchSofliaWithDeadline },
    });
    const { error: inboxError } = await soflia.from("courseengine_inbox").upsert({
      course_slug: claim.idempotency_key,
      error_message: null,
      payload: parsedPayload.data,
      status: "pending",
      updated_at: new Date().toISOString(),
    }, { onConflict: "course_slug" });
    if (inboxError) return this.recordRetryableFailure(claim, `SOFLIA_INBOX_ERROR: ${inboxError.message}`);

    const now = new Date().toISOString();
    const { data: completed, error: completionError } = await this.supabase
      .from("publication_requests")
      .update({
        publish_heartbeat_at: null,
        publish_last_error: null,
        publish_lease_expires_at: null,
        publish_step: PUBLICATION_OUTBOX_STEP.sent,
        sent_at: now,
        soflia_response: { inbox_status: "pending", payload_hash: claim.outbox_payload_hash },
        status: "SENT",
        updated_at: now,
      })
      .eq("id", claim.id)
      .eq("status", "READY")
      .eq("publish_step", PUBLICATION_OUTBOX_STEP.running)
      .eq("outbox_payload_hash", claim.outbox_payload_hash)
      .select("id")
      .maybeSingle();
    if (completionError || !completed) {
      logger.error("publication.local_commit.failed", completionError || new Error("ownership lost"), {
        durationMs: Date.now() - startedAt,
      });
      throw new Error(`PUBLICATION_LOCAL_COMMIT_FAILED: ${completionError?.message || "ownership lost"}`);
    }
    logger.info("publication.delivery.completed", {
      attempt: (rawClaim as { publish_attempt?: unknown }).publish_attempt,
      durationMs: Date.now() - startedAt,
      payloadHash: claim.outbox_payload_hash,
    });
    return { delivered: true };
  }

  private async recordRetryableFailure(claim: PublicationOutboxRecord, internalError: string): Promise<never> {
    const logger = createOperationalLogger("publication.outbox", {
      correlationId: resolveCorrelationId(claim.correlation_id),
      requestId: claim.id,
    });
    logger.error("publication.delivery.retry_scheduled", new Error(internalError));
    const { error } = await this.supabase
      .from("publication_requests")
      .update({
        publish_last_error: "No se pudo depositar la publicación en Soflia; se reintentará automáticamente.",
        updated_at: new Date().toISOString(),
      })
      .eq("id", claim.id)
      .eq("status", "READY")
      .eq("publish_step", PUBLICATION_OUTBOX_STEP.running);
    if (error) logger.error("publication.failure_state.persist_failed", error);
    throw new Error("PUBLICATION_DELIVERY_FAILED");
  }
}
