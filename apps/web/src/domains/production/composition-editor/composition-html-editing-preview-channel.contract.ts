import { z } from "zod";
import { compositionPreviewIframeMessageSchema, compositionPreviewParentCommandSchema } from "./composition-preview-protocol";
import { htmlEditingPreviewSessionSchema, sameHtmlEditingPreviewSession,
  type HtmlEditingPreviewSession } from "./composition-html-editing-preview-session.contract";
import { htmlPreviewRenewalWireMessageSchema } from "./composition-html-editing-preview-renewal-wire.contract";
export { assertHtmlEditingPreviewParentOrigin, htmlEditingPreviewSessionSchema, sameHtmlEditingPreviewSession,
  type HtmlEditingPreviewSession } from "./composition-html-editing-preview-session.contract";

export const HTML_EDITING_PREVIEW_CHANNEL_POLICY = Object.freeze({
  version: 1, messageBytes: 64 * 1024, messagesPerSecond: 60, acknowledgmentTimeoutMs: 5_000,
  maximumSequence: 2_147_483_647,
});
const base = { session: htmlEditingPreviewSessionSchema,
  sequence: z.number().int().min(1).max(HTML_EDITING_PREVIEW_CHANNEL_POLICY.maximumSequence) };
export const htmlEditingPreviewPacketSchema = z.discriminatedUnion("kind", [
  z.object({ ...base, kind: z.literal("COMMAND"), payload: compositionPreviewParentCommandSchema }).strict(),
  z.object({ ...base, kind: z.literal("EVENT"), payload: compositionPreviewIframeMessageSchema }).strict(),
  z.object({ ...base, kind: z.literal("RESOURCE_STATE"), payload: htmlPreviewRenewalWireMessageSchema }).strict(),
  z.object({ ...base, kind: z.literal("RESOURCE_UPDATE"), payload: htmlPreviewRenewalWireMessageSchema }).strict(),
  z.object({ ...base, kind: z.literal("ACK"), acknowledgedSequence: base.sequence,
    status: z.enum(["ACCEPTED", "REJECTED"]) }).strict(),
]);
export type HtmlEditingPreviewPacket = z.infer<typeof htmlEditingPreviewPacketSchema>;
export type HtmlEditingPreviewDataPacket = Exclude<HtmlEditingPreviewPacket, { kind: "ACK" }>;
export const htmlEditingPreviewHandshakeSchema = z.object({
  type: z.literal("courseforge-html-preview-connect"), session: htmlEditingPreviewSessionSchema,
}).strict();

function bounded(candidate: unknown) {
  const encoded = JSON.stringify(candidate);
  return typeof encoded === "string" && new TextEncoder().encode(encoded).byteLength <= HTML_EDITING_PREVIEW_CHANNEL_POLICY.messageBytes;
}

export function parseHtmlEditingPreviewPacket(candidate: unknown, session: HtmlEditingPreviewSession): HtmlEditingPreviewPacket | null {
  try {
    if (!bounded(candidate)) return null;
    const parsed = htmlEditingPreviewPacketSchema.safeParse(candidate);
    if (!parsed.success || !sameHtmlEditingPreviewSession(parsed.data.session, session)) return null;
    const packet = parsed.data;
    if ((packet.kind === "RESOURCE_STATE" || packet.kind === "RESOURCE_UPDATE") && packet.payload.type === "BEGIN"
      && !sameHtmlEditingPreviewSession(packet.payload.metadata.session, session)) return null;
    if (packet.kind === "COMMAND" && packet.payload.type === "courseforge-composition-visual-patch"
      && packet.payload.baseDocumentHash !== session.documentHash) return null;
    if (packet.kind === "EVENT") {
      const event = packet.payload;
      if (event.previewGeneration !== undefined && event.previewGeneration !== session.previewGeneration) return null;
      if ((event.type === "courseforge-composition-ready" || event.type === "courseforge-composition-load-error")
        && event.documentHash !== session.documentHash) return null;
    }
    return packet;
  } catch { return null; }
}

/** Source identity and a previously bound session are mandatory. origin=null
 * alone is never authority. Exactly one transferred port, only one handshake. */
export function acceptHtmlEditingPreviewHandshake(input: {
  event: Pick<MessageEvent, "data" | "source" | "origin" | "ports">;
  expectedSource: MessageEventSource; expectedOrigin: string; session: HtmlEditingPreviewSession; alreadyConnected: boolean;
}): MessagePort | null {
  try {
    if (input.alreadyConnected || input.event.source !== input.expectedSource || input.event.origin !== input.expectedOrigin
      || input.event.ports.length !== 1 || !bounded(input.event.data)) return null;
    const parsed = htmlEditingPreviewHandshakeSchema.safeParse(input.event.data);
    if (!parsed.success || !sameHtmlEditingPreviewSession(parsed.data.session, htmlEditingPreviewSessionSchema.parse(input.session))) return null;
    const port = input.event.ports[0];
    return port && typeof port.postMessage === "function" && typeof port.close === "function" ? port : null;
  } catch { return null; }
}

export function createHtmlEditingPreviewSession(documentHash: string, previewGeneration: number): HtmlEditingPreviewSession {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  const nonce = [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
  return htmlEditingPreviewSessionSchema.parse({ version: 1, nonce, documentHash, previewGeneration });
}
