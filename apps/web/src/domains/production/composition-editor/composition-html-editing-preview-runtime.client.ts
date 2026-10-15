import { HtmlEditingPreviewChannel } from "./composition-html-editing-preview-channel.client";
import { acceptHtmlEditingPreviewHandshake, assertHtmlEditingPreviewParentOrigin, htmlEditingPreviewSessionSchema, parseHtmlEditingPreviewPacket, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-channel.contract";
import { compositionPreviewIframeMessageSchema, type CompositionPreviewIframeMessage, type CompositionPreviewParentCommandInput } from "./composition-preview-protocol";
import { createHtmlPreviewResourceUpdater } from "./composition-html-editing-preview-resource-updater.client";
import { parseHtmlPreviewResourceRenewal, type HtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";
import { createHtmlPreviewRenewalWireReceiver } from "./composition-html-editing-preview-renewal-wire.client";
import { buildHtmlPreviewRenewalWireMessages, HTML_PREVIEW_RENEWAL_WIRE_POLICY, type HtmlPreviewRenewalWireMessage } from "./composition-html-editing-preview-renewal-wire.contract";

export const HTML_EDITING_PREVIEW_RUNTIME_POLICY = Object.freeze({ maximumQueuedEvents: 128, eventIntervalMs: 100 });
type CommandHandler = (message: CompositionPreviewParentCommandInput) => void;

/** Installed inside the opaque frame by packaged code, not called from parent
 * DOM access. Only handshake uses window messaging; commands/events use its port.
 * Delegates to the existing controller and never owns the playback clock. */
export function installHtmlEditingPreviewRuntime(input: { session: HtmlEditingPreviewSession; parentOrigin: string }, browserWindow: Window = window) {
  const session = htmlEditingPreviewSessionSchema.parse(input.session);
  const parentOrigin = input.parentOrigin;
  assertHtmlEditingPreviewParentOrigin(parentOrigin);
  let channel: HtmlEditingPreviewChannel | undefined;
  let handler: CommandHandler | undefined;
  let disposed = false;
  let sending = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resourceExpiryTimer: ReturnType<typeof setTimeout> | undefined;
  let updater: ReturnType<typeof createHtmlPreviewResourceUpdater> | undefined;
  let resourceReceiver: ReturnType<typeof createHtmlPreviewRenewalWireReceiver> | undefined;
  let seconds = 0, duration = Infinity, playbackIntent = false, buffering = false;
  let mediaReloadController = new AbortController();
  const resourceQueue: HtmlPreviewRenewalWireMessage[] = [];
  const queue: CompositionPreviewIframeMessage[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    try { handler?.({ type: "courseforge-composition-pause", protocolVersion: 1 }); } catch { /* Teardown cannot reopen the transport. */ }
    if (timer) clearTimeout(timer);
    clearTimeout(resourceExpiryTimer); updater?.dispose(); resourceReceiver?.dispose(); resourceQueue.length = 0;
    mediaReloadController.abort();
    queue.length = 0;
    browserWindow.removeEventListener("message", connect);
    browserWindow.removeEventListener("pagehide", dispose);
    channel?.close();
  };
  const flush = async () => {
    if (disposed || sending || !channel || (!queue.length && !resourceQueue.length)) return;
    sending = true;
    const resource = resourceQueue.shift();
    try {
      if (resource) await channel.send({ kind: "RESOURCE_STATE", payload: resource });
      else await channel.send({ kind: "EVENT", payload: queue.shift()! });
    } catch { dispose(); }
    finally {
      sending = false;
      if (!disposed) timer = setTimeout(() => { timer = undefined; void flush(); }, resource
        ? HTML_PREVIEW_RENEWAL_WIRE_POLICY.intervalMs : HTML_EDITING_PREVIEW_RUNTIME_POLICY.eventIntervalMs);
    }
  };
  const connect: EventListener = candidate => {
    const event = candidate as MessageEvent;
    const port = acceptHtmlEditingPreviewHandshake({ event, expectedSource: browserWindow.parent,
      expectedOrigin: parentOrigin, session, alreadyConnected: channel !== undefined || disposed });
    if (!port) return;
    channel = new HtmlEditingPreviewChannel({ port, session, receiveKind: "COMMAND", onFailure: dispose, allowResourcePackets: resourceReceiver !== undefined,
      onPacket: async (packet, signal) => {
        if (packet.kind === "RESOURCE_UPDATE" && resourceReceiver && !disposed) return resourceReceiver.accept(packet.payload, signal);
        if (packet.kind !== "COMMAND" || !handler || disposed) throw new Error("HTML_PREVIEW_CONTROLLER_UNAVAILABLE");
        if (packet.payload.type === "courseforge-composition-play") playbackIntent = true;
        if (packet.payload.type === "courseforge-composition-pause" || packet.payload.type === "courseforge-composition-seek") playbackIntent = false;
        handler(packet.payload);
      } });
    browserWindow.removeEventListener("message", connect);
    void flush();
  };
  browserWindow.addEventListener("message", connect);
  browserWindow.addEventListener("pagehide", dispose, { once: true });
  const setResourceExpiry = (renewal: HtmlPreviewResourceRenewal) => {
    const remaining = renewal.expiresAt * 1000 - Date.now();
    if (remaining <= 0) throw new Error("HTML_PREVIEW_RESOURCES_EXPIRED");
    clearTimeout(resourceExpiryTimer); resourceExpiryTimer = setTimeout(dispose, remaining);
  };
  return {
    setResources: (candidate: HtmlPreviewResourceRenewal) => {
      if (disposed || channel || updater) throw new Error("HTML_PREVIEW_RESOURCES_ALREADY_BOUND");
      try {
        const initial = parseHtmlPreviewResourceRenewal(candidate, { documentId: candidate.documentId, session, audience: parentOrigin });
        updater = createHtmlPreviewResourceUpdater({ initial, audience: parentOrigin, document: browserWindow.document,
          onMediaReload: media => media.addEventListener("loadedmetadata", () => {
            if (disposed || !handler) return;
            // Resynchronize using the CURRENT transport intention: a user seek
            // after renewal must not be overwritten by an old metadata callback.
            const restoreSeconds = seconds, restorePlayback = playbackIntent;
            try {
              handler({ type: "courseforge-composition-seek", seconds: restoreSeconds, protocolVersion: 1 });
              playbackIntent = restorePlayback;
              if (restorePlayback) handler({ type: "courseforge-composition-play", protocolVersion: 1 });
            } catch { dispose(); }
          }, { once: true, signal: mediaReloadController.signal }) });
        setResourceExpiry(initial);
        resourceReceiver = createHtmlPreviewRenewalWireReceiver({ documentId: initial.documentId, audience: parentOrigin, session, initial,
          onFailure: dispose, onCommit: async (renewal, signal) => {
            if (!handler || !updater || disposed) throw new Error("HTML_PREVIEW_CONTROLLER_UNAVAILABLE");
            const restoreSeconds = seconds, restorePlayback = playbackIntent;
            try {
              mediaReloadController.abort(); mediaReloadController = new AbortController();
              handler({ type: "courseforge-composition-pause", protocolVersion: 1 });
              updater.apply(renewal, signal); signal.throwIfAborted();
              handler({ type: "courseforge-composition-seek", seconds: restoreSeconds, protocolVersion: 1 });
              playbackIntent = restorePlayback;
              if (restorePlayback) handler({ type: "courseforge-composition-play", protocolVersion: 1 });
              setResourceExpiry(renewal);
            } catch { dispose(); throw new Error("HTML_PREVIEW_RESOURCE_APPLICATION_FAILED"); }
          } });
        resourceQueue.push(...buildHtmlPreviewRenewalWireMessages(initial));
      } catch { dispose(); throw new Error("HTML_PREVIEW_RESOURCE_INITIALIZATION_FAILED"); }
    },
    attach: (candidate: CommandHandler) => {
      if (handler || disposed) throw new Error("HTML_PREVIEW_CONTROLLER_ALREADY_ATTACHED");
      handler = candidate;
    },
    post: (candidate: CompositionPreviewIframeMessage) => {
      if (disposed) return;
      const parsed = compositionPreviewIframeMessageSchema.safeParse(candidate);
      if (!parsed.success || !parseHtmlEditingPreviewPacket({ kind: "EVENT", sequence: 1, session, payload: parsed.data }, session)) { dispose(); return; }
      const message = parsed.data;
      if (message.type === "courseforge-composition-time") seconds = message.seconds;
      if (message.type === "courseforge-composition-ready") duration = message.duration;
      if (message.type === "courseforge-composition-media-state") buffering = message.state === "BUFFERING";
      if (message.type === "courseforge-composition-playback") {
        if (message.playing) playbackIntent = true;
        else if (!buffering || seconds >= duration) playbackIntent = false;
      }
      // Coalesce only transient transport state, never commits/errors/selection.
      const transient = ["courseforge-composition-time", "courseforge-composition-audio-meter", "courseforge-composition-media-state"];
      const existing = transient.includes(message.type) ? queue.findIndex(queued => queued.type === message.type) : -1;
      if (existing >= 0) queue[existing] = message;
      else if (queue.length < HTML_EDITING_PREVIEW_RUNTIME_POLICY.maximumQueuedEvents) queue.push(message);
      else { dispose(); return; }
      if (!sending && !timer) void flush();
    },
    dispose,
    getState: () => ({ disposed, connected: channel !== undefined, attached: handler !== undefined, queued: queue.length }),
  };
}
