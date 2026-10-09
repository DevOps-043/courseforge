import { z } from "zod";
import { htmlPreviewResourceRenewalSchema, HTML_PREVIEW_RENEWAL_POLICY, type HtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";

export const HTML_PREVIEW_RENEWAL_WIRE_POLICY = Object.freeze({ batchResources: 4, packetBytes: 48 * 1024, intervalMs: 50, assemblyTimeoutMs: 15_000 });
const issuedAt = z.number().int().nonnegative();
const { resources: resourceListSchema, ...metadataShape } = htmlPreviewResourceRenewalSchema.shape;
export const htmlPreviewRenewalWireMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("BEGIN"), metadata: z.object(metadataShape).strict(),
    resourceCount: z.number().int().nonnegative().max(HTML_PREVIEW_RENEWAL_POLICY.maximumResources) }).strict(),
  z.object({ type: z.literal("BATCH"), issuedAt, index: z.number().int().nonnegative().max(HTML_PREVIEW_RENEWAL_POLICY.maximumResources),
    resources: resourceListSchema.min(1).max(HTML_PREVIEW_RENEWAL_WIRE_POLICY.batchResources) }).strict(),
  z.object({ type: z.literal("COMMIT"), issuedAt }).strict(),
]);
export type HtmlPreviewRenewalWireMessage = z.infer<typeof htmlPreviewRenewalWireMessageSchema>;

/** Every batch fits the64KiB private packet limit, including session/envelope.
 * Neither BEGIN nor BATCH means resources have been applied to the live frame. */
export function buildHtmlPreviewRenewalWireMessages(candidate: HtmlPreviewResourceRenewal): HtmlPreviewRenewalWireMessage[] {
  const parsed = htmlPreviewResourceRenewalSchema.parse(candidate), { resources, ...metadata } = parsed;
  const messages: HtmlPreviewRenewalWireMessage[] = [{ type: "BEGIN", metadata, resourceCount: resources.length }];
  for (let index = 0; index < resources.length; index += HTML_PREVIEW_RENEWAL_WIRE_POLICY.batchResources)
    messages.push({ type: "BATCH", issuedAt: parsed.issuedAt, index,
      resources: resources.slice(index, index + HTML_PREVIEW_RENEWAL_WIRE_POLICY.batchResources) });
  messages.push({ type: "COMMIT", issuedAt: parsed.issuedAt });
  if (new TextEncoder().encode(JSON.stringify(parsed)).byteLength > HTML_PREVIEW_RENEWAL_POLICY.responseBytes
    || messages.some(message => new TextEncoder().encode(JSON.stringify(message)).byteLength > HTML_PREVIEW_RENEWAL_WIRE_POLICY.packetBytes))
    throw new Error("HTML_PREVIEW_RENEWAL_WIRE_INVALID");
  return messages;
}
