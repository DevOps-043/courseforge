import type { HtmlEditingPreviewChannel } from "./composition-html-editing-preview-channel.client";
import { HTML_PREVIEW_RENEWAL_POLICY, parseHtmlPreviewResourceRenewal, type HtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";
import { buildHtmlPreviewRenewalWireMessages, HTML_PREVIEW_RENEWAL_WIRE_POLICY, htmlPreviewRenewalWireMessageSchema,
  type HtmlPreviewRenewalWireMessage } from "./composition-html-editing-preview-renewal-wire.contract";
import { htmlEditingPreviewSessionSchema, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-session.contract";

/** Caller exclusively owns the channel send slot during this transfer. COMMIT's
 * transport ACK follows the receiver's awaited apply, not just receipt of bytes. */
export async function sendHtmlPreviewRenewalWire(input: {
  channel: HtmlEditingPreviewChannel; kind: "RESOURCE_STATE" | "RESOURCE_UPDATE";
  renewal: HtmlPreviewResourceRenewal; signal: AbortSignal;
}) {
  const { channel, kind, signal } = input;
  signal.throwIfAborted();
  const messages = buildHtmlPreviewRenewalWireMessages(input.renewal);
  const abortChannel = () => channel.close();
  signal.addEventListener("abort", abortChannel, { once: true });
  try {
    for (let index = 0; index < messages.length; index++) {
      signal.throwIfAborted();
      await channel.send({ kind, payload: messages[index]! });
      signal.throwIfAborted();
      if (index + 1 < messages.length) await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); reject(new Error("HTML_PREVIEW_RENEWAL_CANCELLED")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, HTML_PREVIEW_RENEWAL_WIRE_POLICY.intervalMs);
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  } finally { signal.removeEventListener("abort", abortChannel); }
}

/** Bounded staging area: never mutates resources on BEGIN/BATCH. The owner must
 * close the channel/frame on failure, including an assembly timeout while idle. */
export function createHtmlPreviewRenewalWireReceiver(input: {
  documentId: string; session: HtmlEditingPreviewSession; audience: string;
  initial?: HtmlPreviewResourceRenewal;
  onCommit: (renewal: HtmlPreviewResourceRenewal, signal: AbortSignal) => Promise<void>;
  onFailure: () => void; nowSeconds?: () => number;
}) {
  const { documentId, audience, onCommit, onFailure } = input;
  const session = htmlEditingPreviewSessionSchema.parse(input.session), now = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  let previous = input.initial ? parseHtmlPreviewResourceRenewal(input.initial, { documentId, audience, session }) : undefined;
  const initialOnly = previous === undefined;
  let completed = false, disposed = false, applying = false, encodedBytes = 0;
  let stage: Extract<HtmlPreviewRenewalWireMessage, { type: "BEGIN" }> | undefined;
  let resources: HtmlPreviewResourceRenewal["resources"] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stageSignal: AbortSignal | undefined;
  const abortStage = () => fail();
  const aliases = new Set<string>(), urls = new Set<string>();
  const controller = new AbortController();
  const clearStage = () => { clearTimeout(timer); timer = undefined;
    stageSignal?.removeEventListener("abort", abortStage); stageSignal = undefined;
    stage = undefined; resources = []; encodedBytes = 0; aliases.clear(); urls.clear(); };
  const dispose = () => { if (disposed) return; disposed = true; controller.abort(); clearStage(); previous = undefined; };
  const fail = () => { if (disposed) return; dispose(); try { onFailure(); } catch { /* Owner cannot revive a rejected transfer. */ } };
  return {
    async accept(candidate: HtmlPreviewRenewalWireMessage, externalSignal: AbortSignal) {
      const signal = AbortSignal.any([externalSignal, controller.signal]);
      try {
        signal.throwIfAborted();
        if (disposed || applying) throw new Error();
        const message = htmlPreviewRenewalWireMessageSchema.parse(candidate);
        if (new TextEncoder().encode(JSON.stringify(message)).byteLength > HTML_PREVIEW_RENEWAL_WIRE_POLICY.packetBytes) throw new Error();
        if (message.type === "BEGIN") {
          if (stage || initialOnly && completed) throw new Error();
          const header = parseHtmlPreviewResourceRenewal({ ...message.metadata, resources: [] }, {
            documentId, audience, session, bundleSha256: previous?.bundleSha256, inventoryFingerprint: previous?.inventoryFingerprint });
          const currentTime = now();
          if (!Number.isSafeInteger(currentTime) || currentTime < header.issuedAt
            || header.expiresAt - currentTime < HTML_PREVIEW_RENEWAL_POLICY.minimumRemainingSeconds
            || previous && (header.issuedAt <= previous.issuedAt || header.expiresAt <= previous.expiresAt
              || message.resourceCount !== previous.resources.length)) throw new Error();
          stage = message;
          stageSignal = externalSignal; stageSignal.addEventListener("abort", abortStage, { once: true });
          signal.throwIfAborted();
          timer = setTimeout(fail, HTML_PREVIEW_RENEWAL_WIRE_POLICY.assemblyTimeoutMs);
          return;
        }
        if (!stage || message.issuedAt !== stage.metadata.issuedAt) throw new Error();
        if (message.type === "BATCH") {
          if (message.index !== resources.length || resources.length + message.resources.length > stage.resourceCount) throw new Error();
          // Validate URLs and identities before retaining any part of the batch.
          const batch = parseHtmlPreviewResourceRenewal({ ...stage.metadata, resources: message.resources }, { documentId, audience, session });
          for (const resource of batch.resources) {
            if (aliases.has(resource.localPath) || urls.has(resource.url)
              || previous && !previous.resources.some(prior => prior.localPath === resource.localPath)) throw new Error();
            aliases.add(resource.localPath); urls.add(resource.url);
          }
          encodedBytes += new TextEncoder().encode(JSON.stringify(batch.resources)).byteLength;
          if (encodedBytes > HTML_PREVIEW_RENEWAL_POLICY.responseBytes) throw new Error();
          resources.push(...batch.resources); return;
        }
        if (resources.length !== stage.resourceCount) throw new Error();
        const renewal = parseHtmlPreviewResourceRenewal({ ...stage.metadata, resources }, { documentId, audience, session });
        applying = true;
        await onCommit(structuredClone(renewal), signal);
        signal.throwIfAborted();
        const completedAt = now();
        if (!Number.isSafeInteger(completedAt) || completedAt < renewal.issuedAt || completedAt >= renewal.expiresAt
          || previous && completedAt >= previous.expiresAt) throw new Error();
        previous = renewal; completed = true; clearStage();
      } catch { fail(); throw new Error("HTML_PREVIEW_RENEWAL_WIRE_REJECTED"); }
      finally { applying = false; }
    },
    dispose,
    getState: () => ({ disposed, applying, staged: stage !== undefined, resources: resources.length, completed }),
  };
}
