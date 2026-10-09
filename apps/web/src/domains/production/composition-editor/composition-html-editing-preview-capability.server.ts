import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { assertHtmlEditingPreviewParentOrigin, htmlEditingPreviewSessionSchema } from "./composition-html-editing-preview-channel.contract";
import { HTML_PREVIEW_RENEWAL_POLICY, htmlPreviewResourceLocalPathSchema } from "./composition-html-editing-preview-renewal.contract";

export const HTML_PREVIEW_CAPABILITY_POLICY = Object.freeze({ tokenBytes: 4096, keyBytes: 32, lifetimeSeconds: HTML_PREVIEW_RENEWAL_POLICY.lifetimeSeconds });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const claimsSchema = z.object({ format: z.literal("courseforge-html-preview-resource-v1"),
  actorId: z.string().uuid(), organizationId: z.string().uuid(), documentId: z.string().uuid(),
  session: htmlEditingPreviewSessionSchema, audience: z.string().max(512),
  bundleSha256: sha256, inventoryFingerprint: sha256,
  localPath: htmlPreviewResourceLocalPathSchema,
  checksum: sha256, fileSizeBytes: z.number().int().positive().max(2 * 1024 * 1024 * 1024), mimeType: z.string().max(128),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
}).strict().superRefine((claims, context) => {
  try { assertHtmlEditingPreviewParentOrigin(claims.audience); } catch { context.addIssue({ code: "custom", message: "Invalid audience" }); }
  if (claims.expiresAt - claims.issuedAt !== HTML_PREVIEW_CAPABILITY_POLICY.lifetimeSeconds) context.addIssue({ code: "custom", message: "Invalid lifetime" });
});
export type HtmlPreviewResourceClaims = z.infer<typeof claimsSchema>;
export class HtmlPreviewCapabilityError extends Error {
  constructor() { super("HTML_PREVIEW_RESOURCE_CAPABILITY_INVALID"); this.name = "HtmlPreviewCapabilityError"; }
}
const mac = (key: Uint8Array, body: string) => createHmac("sha256", key).update("courseforge-html-preview-resource-v1\0").update(body).digest();
function assertKey(key: Uint8Array) { if (!(key instanceof Uint8Array) || key.byteLength !== HTML_PREVIEW_CAPABILITY_POLICY.keyBytes) throw new HtmlPreviewCapabilityError(); }

/** Issuer must supply independently authorized inventory, never request claims.
 * Use a dedicated operator key shared by instances; no reuse of auth/service keys.
 * Tokens are read-only bearer capabilities, not permanent authorization leases. */
export function issueHtmlPreviewResourceCapability(claims: HtmlPreviewResourceClaims, key: Uint8Array): string {
  try {
    assertKey(key);
    const body = Buffer.from(JSON.stringify(claimsSchema.parse(claims))).toString("base64url");
    const token = `${body}.${mac(key, body).toString("base64url")}`;
    if (Buffer.byteLength(token) > HTML_PREVIEW_CAPABILITY_POLICY.tokenBytes) throw new Error();
    return token;
  } catch { throw new HtmlPreviewCapabilityError(); }
}

export function verifyHtmlPreviewResourceCapability(input: { token: string; key: Uint8Array; audience: string; documentId: string; nowSeconds: number }) {
  try {
    assertKey(input.key);
    if (!Number.isSafeInteger(input.nowSeconds) || input.nowSeconds < 0 || typeof input.token !== "string"
      || Buffer.byteLength(input.token) > HTML_PREVIEW_CAPABILITY_POLICY.tokenBytes) throw new Error();
    const parts = input.token.split(".");
    if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9_-]+$/.test(part))) throw new Error();
    const [body, encodedMac] = parts as [string, string];
    const received = Buffer.from(encodedMac, "base64url"), expected = mac(input.key, body);
    if (received.length !== expected.length || received.toString("base64url") !== encodedMac || !timingSafeEqual(received, expected)) throw new Error();
    const bytes = Buffer.from(body, "base64url");
    if (bytes.toString("base64url") !== body) throw new Error();
    const claims = claimsSchema.parse(JSON.parse(bytes.toString("utf8")));
    if (claims.audience !== input.audience || claims.documentId !== input.documentId
      || input.nowSeconds < claims.issuedAt || input.nowSeconds >= claims.expiresAt) throw new Error();
    return claims;
  } catch { throw new HtmlPreviewCapabilityError(); }
}
