export function compositionTransportEnabled(state: { saving: boolean; previewReady: boolean; previewMediaState: string }): boolean {
  return !state.saving && state.previewReady && state.previewMediaState !== "PREPARING";
}

const TRANSPORT_ACK_TIMEOUT_MS = 2_000;

/** Tracks only unconfirmed intent, never replaces the runtime's visible playback state. */
export class CompositionTransportIntent {
  private sequence = 0;
  private pending: { requestId: number; active: boolean; expiresAt: number } | null = null;

  toggle(observedActive: boolean, now: number) {
    const active = !(this.pending && now < this.pending.expiresAt ? this.pending.active : observedActive);
    this.pending = { requestId: ++this.sequence, active, expiresAt: now + TRANSPORT_ACK_TIMEOUT_MS };
    return { requestId: this.pending.requestId, active };
  }

  acknowledge(requestId: number) {
    if (this.pending?.requestId === requestId) this.pending = null;
  }

  reset() { this.pending = null; }
}
