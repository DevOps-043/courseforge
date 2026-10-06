import { z } from "zod";

export const NARRATIVE_EXTRACTION_RATE_POLICY = { limit: 12, windowSeconds: 60 } as const;
const RATE_KEY_PREFIX = { PLAN: "narrative-extraction-plan", APPLY: "narrative-extraction-apply", RECOVERY: "narrative-extraction-recovery" } as const;
const rateResultSchema = z.array(z.object({ allowed: z.boolean(), remaining: z.number().int().nonnegative(),
  reset_at: z.string().datetime({ offset: true }) })).length(1);

/** Uses the existing atomic PostgreSQL limiter, never an instance-local counter. */
export async function consumeNarrativeExtractionRateLimit(params: {
  organizationId: string; userId: string;
  purpose?: keyof typeof RATE_KEY_PREFIX;
  consume: (policy: { p_rate_key: string; p_limit: number; p_window_seconds: number }) => PromiseLike<{ data: unknown; error: unknown }>;
}) {
  const uuid = z.string().uuid();
  const organizationId = uuid.parse(params.organizationId);
  const userId = uuid.parse(params.userId);
  const response = await params.consume({ p_rate_key: `${RATE_KEY_PREFIX[params.purpose ?? "PLAN"]}:${organizationId}:${userId}`,
    p_limit: NARRATIVE_EXTRACTION_RATE_POLICY.limit, p_window_seconds: NARRATIVE_EXTRACTION_RATE_POLICY.windowSeconds });
  const parsed = rateResultSchema.safeParse(response.data);
  if (response.error || !parsed.success) return { status: "UNAVAILABLE" } as const;
  const row = parsed.data[0]!;
  if (row.allowed) return { status: "ALLOWED" } as const;
  const retryAfterSeconds = Math.min(NARRATIVE_EXTRACTION_RATE_POLICY.windowSeconds,
    Math.max(1, Math.ceil((Date.parse(row.reset_at) - Date.now()) / 1000)));
  return { status: "LIMITED", retryAfterSeconds } as const;
}
