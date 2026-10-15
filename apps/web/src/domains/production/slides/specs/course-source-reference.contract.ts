import { z } from "zod";

/** References are opaque IDs, component paths, or complete URLs, never display copy.
 * Keep the same bounded contract across every consumer; truncation destroys identity.
 * 8192 characters accommodate long URLs while bounding persisted/provider metadata.
 */
export const COURSE_SOURCE_REFERENCE_MAX_LENGTH = 8192;

export const courseSourceReferenceSchema = z.string()
  .min(1)
  .max(COURSE_SOURCE_REFERENCE_MAX_LENGTH)
  .refine((reference) => reference.trim().length > 0, "Source reference must not be blank");
