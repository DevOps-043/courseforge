import { HtmlEditingPreviewChannel } from "./composition-html-editing-preview-channel.client";
import { htmlEditingPreviewSessionSchema, parseHtmlEditingPreviewPacket, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-channel.contract";
import { createCompositionPreviewParentCommand, type CompositionPreviewIframeMessage, type CompositionPreviewParentCommandInput } from "./composition-preview-protocol";
import { createHtmlPreviewRenewalWireReceiver, sendHtmlPreviewRenewalWire } from "./composition-html-editing-preview-renewal-wire.client";
import { createHtmlPreviewRenewalController } from "./composition-html-editing-preview-renewal-controller.client";
import type { HtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";
import type { consultHtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.client";
import { buildHtmlEditingPreviewPageUrl } from "./composition-html-editing-preview-url";
export { buildHtmlEditingPreviewPageUrl, isHtmlEditingPreviewPageUrl } from "./composition-html-editing-preview-url";

export const HTML_PREVIEW_HOST_POLICY = Object.freeze({ maximumQueuedCommands: 64, commandIntervalMs: 50, connectionTimeoutMs: 10_000 });
/** Parent-only transport. Call connect once from that exact iframe's load event;
 * no global listener, retry, persistence or playback clock. Queue admission is
 * NOT an ACK. The existing visual-patch coordinator still waits for its result.
 * Only adjacent idempotent settings are coalesced; ordered intentions survive. */
export function createHtmlEditingPreviewHost(input: {
  session: HtmlEditingPreviewSession; onEvent: (message: CompositionPreviewIframeMessage) => void;
  onFailure: () => void; createPorts?: () => MessageChannel; isCurrentOwner?: () => boolean;
  subscribeOwner?: (onChange: () => void) => (() => void);
  resources?: { documentId: string; audience: string; revisionId?: string; consult?: typeof consultHtmlPreviewResourceRenewal };
  onRuntimeSignal?: () => void;
}) {
  const session = htmlEditingPreviewSessionSchema.parse(input.session);
  const onEvent = input.onEvent, onFailure = input.onFailure;
  const createPorts = input.createPorts ?? (() => new MessageChannel());
  const isCurrentOwner = input.isCurrentOwner ?? (() => true);
  const subscribeOwner = input.subscribeOwner;
  const resources = input.resources ? { ...input.resources } : undefined;
  if (resources?.revisionId !== undefined) buildHtmlEditingPreviewPageUrl(resources.documentId, session, resources.revisionId);
  const onRuntimeSignal = input.onRuntimeSignal;
  let resourceSignalObserved = false;
  const lifetime = new AbortController();
  let renewalController: ReturnType<typeof createHtmlPreviewRenewalController> | undefined;
  let resourceReceiver: ReturnType<typeof createHtmlPreviewRenewalWireReceiver> | undefined;
  let pendingResourceUpdate: { renewal: HtmlPreviewResourceRenewal; resolve: () => void; reject: (error: Error) => void } | undefined;
  const queue: CompositionPreviewParentCommandInput[] = [];
  let channel: HtmlEditingPreviewChannel | undefined, connected = false, disposed = false, sending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let connectionTimer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribeOwner: (() => void) | undefined;
  const dispose = () => { if (disposed) return; disposed = true; queue.length = 0;
    lifetime.abort(); renewalController?.dispose(); resourceReceiver?.dispose();
    pendingResourceUpdate?.reject(new Error("HTML_PREVIEW_HOST_CLOSED")); pendingResourceUpdate = undefined;
    if (timer) clearTimeout(timer); if (connectionTimer) clearTimeout(connectionTimer);
    unsubscribeOwner?.(); unsubscribeOwner = undefined; channel?.close(); };
  const fail = () => { if (disposed) return; dispose(); try { onFailure(); } catch { /* Owner cannot revive failed transport. */ } };
  const flush = async () => {
    if (disposed || sending || !channel || (!queue.length && !pendingResourceUpdate)) return;
    sending = true;
    const update = pendingResourceUpdate; pendingResourceUpdate = undefined;
    try { if (!isCurrentOwner()) throw new Error("HTML_PREVIEW_OWNER_CHANGED");
      if (update) {
        await sendHtmlPreviewRenewalWire({ channel, kind: "RESOURCE_UPDATE", renewal: update.renewal, signal: lifetime.signal });
        update.resolve();
      } else await channel.send({ kind: "COMMAND", payload: createCompositionPreviewParentCommand(queue.shift()!)! }); }
    catch { update?.reject(new Error("HTML_PREVIEW_RESOURCE_TRANSFER_FAILED")); fail(); }
    finally { sending = false; if (!disposed) timer = setTimeout(() => { timer = undefined; void flush(); }, HTML_PREVIEW_HOST_POLICY.commandIntervalMs); }
  };
  if (resources) resourceReceiver = createHtmlPreviewRenewalWireReceiver({ documentId: resources.documentId, audience: resources.audience, session,
    onFailure: fail, onCommit: async (initial, signal) => {
      signal.throwIfAborted(); if (disposed || renewalController || !isCurrentOwner()) throw new Error("HTML_PREVIEW_OWNER_CHANGED");
      renewalController = createHtmlPreviewRenewalController({ documentId: resources.documentId, audience: resources.audience, session, revisionId: resources.revisionId,
        signal: lifetime.signal, isCurrentOwner, consult: resources.consult, onFailure: fail,
        apply: (renewal, applySignal) => new Promise<void>((resolve, reject) => {
          if (disposed || applySignal.aborted || pendingResourceUpdate) { reject(new Error("HTML_PREVIEW_RESOURCE_TRANSFER_UNAVAILABLE")); return; }
          pendingResourceUpdate = { renewal, resolve, reject };
          if (!sending && !timer) void flush();
        }) });
      if (!renewalController.start(initial)) throw new Error("HTML_PREVIEW_INITIAL_RESOURCES_EXPIRED");
    } });
  return {
    connect(target: Window) {
      if (disposed || connected) return false;
      connected = true;
      let pair: MessageChannel | undefined;
      try {
        if (!isCurrentOwner()) { fail(); return false; }
        unsubscribeOwner = subscribeOwner?.(() => { if (!isCurrentOwner()) fail(); });
        if (disposed) { unsubscribeOwner?.(); unsubscribeOwner = undefined; return false; }
        pair = createPorts();
        channel = new HtmlEditingPreviewChannel({ port: pair.port1, session, receiveKind: "EVENT", onFailure: fail, allowResourcePackets: resources !== undefined,
          onPacket: async (packet, signal) => {
            if (disposed) throw new Error("HTML_PREVIEW_EVENT_INVALID");
            if (!isCurrentOwner()) { fail(); throw new Error("HTML_PREVIEW_OWNER_CHANGED"); }
            if (packet.kind === "RESOURCE_STATE" && resourceReceiver) {
              await resourceReceiver.accept(packet.payload, signal);
              if (!resourceSignalObserved) {
                resourceSignalObserved = true;
                try { onRuntimeSignal?.(); } catch { fail(); throw new Error("HTML_PREVIEW_SIGNAL_HANDLER_FAILED"); }
              }
              if (connectionTimer) { clearTimeout(connectionTimer); connectionTimer = undefined; }
              return;
            }
            if (packet.kind !== "EVENT") throw new Error("HTML_PREVIEW_EVENT_INVALID");
            if (connectionTimer && (!resources || renewalController)) { clearTimeout(connectionTimer); connectionTimer = undefined; }
            try { onEvent(packet.payload); } catch { fail(); throw new Error("HTML_PREVIEW_EVENT_HANDLER_FAILED"); } } });
        connectionTimer = setTimeout(fail, HTML_PREVIEW_HOST_POLICY.connectionTimeoutMs);
        // Opaque iframe cannot have a concrete targetOrigin. Only this bootstrap
        // uses '*'; receiver checks browser-assigned source/origin/exact session.
        target.postMessage({ type: "courseforge-html-preview-connect", session }, "*", [pair.port2]);
        void flush(); return true;
      } catch { pair?.port1.close(); pair?.port2.close(); fail(); return false; }
    },
    send(candidate: CompositionPreviewParentCommandInput) {
      if (disposed) return false;
      if (!isCurrentOwner()) { fail(); return false; }
      const command = createCompositionPreviewParentCommand(candidate);
      if (!command || !parseHtmlEditingPreviewPacket({ kind: "COMMAND", sequence: 1, session, payload: command }, session)) return false;
      const transient = ["courseforge-composition-seek", "courseforge-composition-select", "courseforge-composition-preview-zoom", "courseforge-composition-editor-settings"];
      if (queue.length && transient.includes(command.type) && queue[queue.length - 1]!.type === command.type) queue[queue.length - 1] = command;
      else if (queue.length < HTML_PREVIEW_HOST_POLICY.maximumQueuedCommands) queue.push(command);
      else { fail(); return false; }
      if (!sending && !timer) void flush();
      return true;
    },
    dispose,
    getState: () => ({ connected, disposed, queued: queue.length }),
  };
}
