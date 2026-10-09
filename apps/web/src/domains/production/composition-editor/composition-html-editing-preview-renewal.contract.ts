import { z } from "zod";
import { assertHtmlEditingPreviewParentOrigin, htmlEditingPreviewSessionSchema, sameHtmlEditingPreviewSession,
  type HtmlEditingPreviewSession } from "./composition-html-editing-preview-session.contract";

export const HTML_PREVIEW_RENEWAL_POLICY = Object.freeze({ lifetimeSeconds: 180, responseBytes: 2 * 1024 * 1024,
  maximumResources: 512, requestTimeoutMs: 180_000, minimumRemainingSeconds: 30, renewBeforeExpirySeconds: 60 });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
export const htmlPreviewResourceLocalPathSchema = z.string().regex(/^(conformance-media\/[a-f0-9-]{36}|assets\/fonts\/[a-f0-9]{64}\.(woff2?|ttf|otf))$/);
export const htmlPreviewResourceRenewalSchema = z.object({
  format: z.literal("courseforge-html-preview-resource-renewal-v1"), documentId: z.string().uuid(),
  session: htmlEditingPreviewSessionSchema, bundleSha256: sha256, inventoryFingerprint: sha256,
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  resources: z.array(z.object({ localPath: htmlPreviewResourceLocalPathSchema, url: z.string().max(8192) }).strict())
    .max(HTML_PREVIEW_RENEWAL_POLICY.maximumResources),
}).strict().superRefine((renewal, context) => {
  if (renewal.expiresAt - renewal.issuedAt !== HTML_PREVIEW_RENEWAL_POLICY.lifetimeSeconds
    || new Set(renewal.resources.map(resource => resource.localPath)).size !== renewal.resources.length
    || new Set(renewal.resources.map(resource => resource.url)).size !== renewal.resources.length)
    context.addIssue({ code: "custom", message: "Invalid resource renewal" });
});
export type HtmlPreviewResourceRenewal = z.infer<typeof htmlPreviewResourceRenewalSchema>;

/** Transport validation only. URLs are authenticated issuer output, never proof
 * of grants or integrity. Client/receiver must additionally compare its pinned
 * bundle/inventory and stop when the owner or base session changes. */
export function parseHtmlPreviewResourceRenewal(candidate: unknown, expected: {
  documentId: string; session: HtmlEditingPreviewSession; audience: string;
  bundleSha256?: string; inventoryFingerprint?: string;
}): HtmlPreviewResourceRenewal {
  try { return parseRenewal(candidate, expected); }
  catch { throw new Error("HTML_PREVIEW_RENEWAL_INVALID"); }
}

function parseRenewal(candidate: unknown, expected: {
  documentId: string; session: HtmlEditingPreviewSession; audience: string;
  bundleSha256?: string; inventoryFingerprint?: string;
}): HtmlPreviewResourceRenewal {
  const serialized = JSON.stringify(candidate);
  if (!serialized || new TextEncoder().encode(serialized).byteLength > HTML_PREVIEW_RENEWAL_POLICY.responseBytes)
    throw new Error("HTML_PREVIEW_RENEWAL_INVALID");
  assertHtmlEditingPreviewParentOrigin(expected.audience);
  const renewal = htmlPreviewResourceRenewalSchema.parse(candidate);
  if (renewal.documentId !== expected.documentId || !sameHtmlEditingPreviewSession(renewal.session, expected.session)
    || expected.bundleSha256 !== undefined && renewal.bundleSha256 !== expected.bundleSha256
    || expected.inventoryFingerprint !== undefined && renewal.inventoryFingerprint !== expected.inventoryFingerprint)
    throw new Error("HTML_PREVIEW_RENEWAL_INVALID");
  const endpoint = `${expected.audience}/api/production/hyperframes/drafts/${expected.documentId}/html-preview/resources`;
  for (const resource of renewal.resources) {
    const url = new URL(resource.url), query = [...url.searchParams.entries()];
    if (`${url.origin}${url.pathname}` !== endpoint || url.username || url.password || url.hash
      || query.length !== 1 || query[0]![0] !== "cap" || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(query[0]![1])
      || url.href !== resource.url) throw new Error("HTML_PREVIEW_RENEWAL_INVALID");
  }
  return renewal;
}
