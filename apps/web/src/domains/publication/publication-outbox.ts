import { createHash } from "node:crypto";
import { z } from "zod";

export const publicationOutboxRequestSchema = z.object({
  correlationId: z.string().uuid().optional(),
  requestId: z.string().uuid(),
}).strict();

export const publicationOutboxPayloadSchema = z.object({
  source: z.object({
    platform: z.literal("courseengine"),
    artifact_id: z.string().uuid(),
  }).passthrough(),
  course: z.object({
    slug: z.string().trim().min(1).max(160),
  }).passthrough(),
  modules: z.array(z.unknown()),
}).passthrough();

export const PUBLICATION_OUTBOX_STEP = {
  queued: "QUEUED",
  running: "RUNNING",
  sent: "SENT",
} as const;

export const PUBLICATION_OUTBOX_LEASE_SECONDS = 300;
export const PUBLICATION_OUTBOX_QUEUE_STALE_MS = 60_000;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonicalize(child)]),
  );
}

export function hashPublicationPayload(payload: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(payload)))
    .digest("hex");
}

export function isRecoverablePublicationOutbox(
  step: unknown,
  leaseExpiresAt: unknown,
  updatedAt: unknown,
  nowMs = Date.now(),
) {
  if (step === PUBLICATION_OUTBOX_STEP.running && typeof leaseExpiresAt === "string") {
    const expiresAt = Date.parse(leaseExpiresAt);
    return Number.isFinite(expiresAt) && expiresAt <= nowMs;
  }
  if (step === PUBLICATION_OUTBOX_STEP.queued && typeof updatedAt === "string") {
    const queuedAt = Date.parse(updatedAt);
    return Number.isFinite(queuedAt) && queuedAt <= nowMs - PUBLICATION_OUTBOX_QUEUE_STALE_MS;
  }
  return false;
}
