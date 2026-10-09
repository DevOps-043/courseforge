import {
  HTML_EDITING_PREVIEW_CHANNEL_POLICY, htmlEditingPreviewSessionSchema, parseHtmlEditingPreviewPacket,
  type HtmlEditingPreviewDataPacket, type HtmlEditingPreviewPacket, type HtmlEditingPreviewSession,
} from "./composition-html-editing-preview-channel.contract";

export class HtmlEditingPreviewChannelError extends Error {
  constructor(readonly code: "CLOSED" | "BUSY" | "INVALID_PACKET" | "SEQUENCE" | "RATE_LIMIT" | "ACK_TIMEOUT" | "REJECTED" | "PORT_ERROR") {
    super(`HTML_EDITING_PREVIEW_CHANNEL_${code}`); this.name = "HtmlEditingPreviewChannelError";
  }
}
type Pending = { sequence: number; resolve: () => void; reject: (error: HtmlEditingPreviewChannelError) => void;
  timeout: ReturnType<typeof setTimeout> };

/** Owns one exclusively transferred port, never a global window listener.
 * Stop-and-wait data packets; ACKs also consume independent monotonic sequences
 * and rate budget, but are not ACKed recursively. ACCEPTED acknowledges handler
 * completion only, not persistence, media readiness or a visual render result. */
export class HtmlEditingPreviewChannel {
  private readonly session: HtmlEditingPreviewSession;
  private inboundSequence = 0;
  private outboundSequence = 0;
  private pending: Pending | undefined;
  private executing = false;
  private closed = false;
  private inboundTimes: number[] = [];
  private outboundTimes: number[] = [];
  private readonly messageListener: EventListener;
  private readonly errorListener: EventListener;
  private readonly abortListener: EventListener;
  private readonly controller = new AbortController();

  constructor(private readonly input: {
    port: MessagePort; session: HtmlEditingPreviewSession; receiveKind: "COMMAND" | "EVENT";
    onPacket: (packet: HtmlEditingPreviewDataPacket, signal: AbortSignal) => Promise<void> | void;
    onFailure?: (error: HtmlEditingPreviewChannelError) => void;
    allowResourcePackets?: boolean;
    now?: () => number; signal?: AbortSignal;
  }) {
    this.input = { ...input };
    const session = htmlEditingPreviewSessionSchema.safeParse(input.session);
    if (!session.success) throw new HtmlEditingPreviewChannelError("INVALID_PACKET");
    this.session = session.data;
    this.messageListener = event => { void this.receive((event as MessageEvent).data); };
    this.errorListener = () => this.fail("PORT_ERROR");
    this.abortListener = () => this.fail("CLOSED");
    if (input.signal?.aborted) { this.fail("CLOSED"); return; }
    input.signal?.addEventListener("abort", this.abortListener, { once: true });
    input.port.addEventListener("message", this.messageListener);
    input.port.addEventListener("messageerror", this.errorListener);
    input.port.start();
  }

  getState() { return { closed: this.closed, pending: this.pending !== undefined, executing: this.executing }; }

  send(packet: Pick<HtmlEditingPreviewDataPacket, "kind" | "payload">): Promise<void> {
    if (this.closed) return Promise.reject(new HtmlEditingPreviewChannelError("CLOSED"));
    if (this.pending) return Promise.reject(new HtmlEditingPreviewChannelError("BUSY"));
    if (packet.kind === this.input.receiveKind) return Promise.reject(new HtmlEditingPreviewChannelError("INVALID_PACKET"));
    if ((packet.kind === "RESOURCE_STATE" || packet.kind === "RESOURCE_UPDATE")
      && (!this.input.allowResourcePackets || packet.kind !== (this.input.receiveKind === "EVENT" ? "RESOURCE_UPDATE" : "RESOURCE_STATE")))
      return Promise.reject(new HtmlEditingPreviewChannelError("INVALID_PACKET"));
    const candidate = parseHtmlEditingPreviewPacket({ ...packet, session: this.session, sequence: this.outboundSequence + 1 }, this.session);
    if (!candidate || candidate.kind === "ACK") return Promise.reject(new HtmlEditingPreviewChannelError("INVALID_PACKET"));
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => this.fail("ACK_TIMEOUT"), HTML_EDITING_PREVIEW_CHANNEL_POLICY.acknowledgmentTimeoutMs);
      this.pending = { sequence: candidate.sequence, resolve, reject, timeout };
      try { this.post(candidate); } catch (error) {
        this.fail(error instanceof HtmlEditingPreviewChannelError ? error.code : "PORT_ERROR");
      }
    });
  }

  close() { this.fail("CLOSED"); }

  private budget(direction: "INBOUND" | "OUTBOUND") {
    const now = (this.input.now ?? (() => performance.now()))();
    const times = direction === "INBOUND" ? this.inboundTimes : this.outboundTimes;
    if (!Number.isFinite(now) || times.length && now < times[times.length - 1]) throw new HtmlEditingPreviewChannelError("RATE_LIMIT");
    while (times.length && now - times[0] >= 1_000) times.shift();
    if (times.length >= HTML_EDITING_PREVIEW_CHANNEL_POLICY.messagesPerSecond) throw new HtmlEditingPreviewChannelError("RATE_LIMIT");
    times.push(now);
  }

  private post(packet: HtmlEditingPreviewPacket) {
    if (this.closed) throw new HtmlEditingPreviewChannelError("CLOSED");
    this.budget("OUTBOUND");
    if (packet.sequence !== this.outboundSequence + 1 || packet.sequence > HTML_EDITING_PREVIEW_CHANNEL_POLICY.maximumSequence)
      throw new HtmlEditingPreviewChannelError("SEQUENCE");
    this.outboundSequence = packet.sequence;
    this.input.port.postMessage(packet);
  }

  private async receive(candidate: unknown) {
    if (this.closed) return;
    let processingData = false;
    try {
      this.budget("INBOUND");
      const packet = parseHtmlEditingPreviewPacket(candidate, this.session);
      if (!packet) throw new HtmlEditingPreviewChannelError("INVALID_PACKET");
      if (packet.sequence !== this.inboundSequence + 1) throw new HtmlEditingPreviewChannelError("SEQUENCE");
      this.inboundSequence = packet.sequence;
      if (packet.kind === "ACK") {
        if (!this.pending || packet.acknowledgedSequence !== this.pending.sequence) throw new HtmlEditingPreviewChannelError("SEQUENCE");
        const pending = this.pending; this.pending = undefined; clearTimeout(pending.timeout);
        if (packet.status === "ACCEPTED") pending.resolve(); else pending.reject(new HtmlEditingPreviewChannelError("REJECTED"));
        return;
      }
      const resourceDirection = this.input.receiveKind === "EVENT" ? "RESOURCE_STATE" : "RESOURCE_UPDATE";
      if ((packet.kind !== this.input.receiveKind && !(this.input.allowResourcePackets && packet.kind === resourceDirection))
        || this.executing) throw new HtmlEditingPreviewChannelError("INVALID_PACKET");
      this.executing = true;
      processingData = true;
      let status: "ACCEPTED" | "REJECTED" = "ACCEPTED";
      try { await this.input.onPacket(packet, this.controller.signal); } catch { status = "REJECTED"; }
      if (!this.closed) this.post({ session: this.session, kind: "ACK", sequence: this.outboundSequence + 1,
        acknowledgedSequence: packet.sequence, status });
    } catch (error) {
      this.fail(error instanceof HtmlEditingPreviewChannelError ? error.code : "PORT_ERROR");
    } finally { if (processingData) this.executing = false; }
  }

  private fail(code: HtmlEditingPreviewChannelError["code"]) {
    if (this.closed) return;
    this.closed = true;
    const error = new HtmlEditingPreviewChannelError(code);
    this.controller.abort(error);
    const pending = this.pending; this.pending = undefined;
    if (pending) { clearTimeout(pending.timeout); pending.reject(error); }
    this.input.port.removeEventListener("message", this.messageListener);
    this.input.port.removeEventListener("messageerror", this.errorListener);
    this.input.signal?.removeEventListener("abort", this.abortListener);
    this.input.port.close();
    try { this.input.onFailure?.(error); } catch { /* Teardown is already complete. */ }
  }
}
