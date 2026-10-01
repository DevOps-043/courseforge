import { z } from "zod";

export const DECLARED_NATIVE_FONT_USAGE_POLICY = "DECLARED_CUSTOM_NATIVE_FONT_USAGE_V1";
/** Isomorphic schema: the browser-facing contract must not import server hashing/filesystem code. */
export const declaredNativeFontUsageContractSchema = z.object({policy: z.literal(DECLARED_NATIVE_FONT_USAGE_POLICY),
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  bindings: z.array(z.object({elementId: z.string().min(1).max(280), fontAssetId: z.string().uuid()}).strict()).max(2048),
}).strict().refine((contract) => new Set(contract.bindings.map((binding) => binding.elementId)).size === contract.bindings.length,
  "CONFORMANCE_FONT_CONTRACT_DUPLICATE");

/** Explicit missing provenance; pixel parity or a second preview is not renderer attestation. */
export const rendererFontUsagePendingSchema = z.object({policy: z.literal(DECLARED_NATIVE_FONT_USAGE_POLICY),
  scope: z.literal("RENDERER_GLYPH_PROVENANCE"), status: z.literal("INCOMPLETE"),
  reason: z.literal("RENDERER_FONT_USAGE_EVIDENCE_UNAVAILABLE"), manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  requiredBindingCount: z.number().int().positive().max(2048),
}).strict();
