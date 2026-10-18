export const COMPOSITION_AUTOSAVE_DELAY_MS = 600;
export type CompositionAutosaveCommit = () => Promise<boolean | void> | boolean | void;
export type CompositionAutosaveState = "IDLE" | "PENDING" | "SAVING" | "INVALID" | "ERROR";

/** Conserva el callback del borrador, aunque una respuesta posterior vuelva a renderizar el control. */
export class CompositionInteractionAutosave {
  private pending: { signature: string; commit: CompositionAutosaveCommit } | null = null;
  private active: Promise<boolean> | null = null;
  private confirmed: string;
  state: CompositionAutosaveState = "IDLE";
  constructor(signature: string, private readonly notify: () => void = () => {}) { this.confirmed = signature; }
  get dirty() { return this.pending !== null; }
  confirmPersisted() { if (this.pending) this.confirmed = this.pending.signature; this.pending = null; this.state = "IDLE"; this.notify(); }
  discard() { if (this.active) return false; this.pending = null; this.state = "IDLE"; this.notify(); return true; }
  observe(signature: string) { if (!this.dirty && !this.active) this.confirmed = signature; }
  stage(signature: string, commit: CompositionAutosaveCommit) {
    if (this.pending?.signature === signature) { if (!this.active) this.pending.commit = commit; return; }
    if (!this.pending && !this.active && signature === this.confirmed) return;
    const failed = this.state === "ERROR";
    if (signature === this.confirmed && !this.active) { this.pending = null; this.state = "IDLE"; }
    else { this.pending = { signature, commit }; this.state = failed ? "ERROR" : "PENDING"; }
    this.notify();
  }
  flush(retry = false): Promise<boolean> {
    if (this.active) return this.active;
    if (this.state === "ERROR" && !retry) return Promise.resolve(false);
    const pending = this.pending;
    if (!pending) return Promise.resolve(true);
    this.state = "SAVING"; this.notify();
    this.active = Promise.resolve().then(() => pending.commit()).then((saved) => {
      if (saved === true) {
        this.confirmed = pending.signature;
        if (this.pending?.signature === pending.signature) this.pending = null;
        this.state = this.pending ? "PENDING" : "IDLE";
      } else this.state = saved === false ? "ERROR" : "INVALID";
      return saved === true;
    }, () => { this.state = "ERROR"; return false; }).finally(() => { this.active = null; this.notify(); });
    return this.active;
  }
}

/** Los formularios se vacían en orden antes de una acción que necesita documento confirmado. */
export class CompositionAutosaveCoordinator {
  private readonly sessions = new Set<CompositionInteractionAutosave>();
  private readonly listeners = new Set<() => void>();
  private readonly detached = new Set<CompositionInteractionAutosave>();
  private committing = 0;
  private retrying = 0;
  private serial: Promise<unknown> = Promise.resolve();
  activeSession: CompositionInteractionAutosave | null = null;
  get isCommitting() { return this.committing > 0; }
  get isRetrying() { return this.retrying > 0; }
  get pending() { return [...this.sessions].some((session) => session.dirty); }
  changed() { for (const session of this.detached) if (!session.dirty) { this.sessions.delete(session); this.detached.delete(session); } for (const listener of this.listeners) listener(); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  register(session: CompositionInteractionAutosave) {
    this.sessions.add(session);
    this.changed();
    return () => { if (session.dirty) this.detached.add(session); else this.sessions.delete(session); this.changed(); };
  }
  commit(session: CompositionInteractionAutosave, retry = false): Promise<boolean> {
    const task = this.serial.then(async () => {
      this.committing += 1; if (retry) this.retrying += 1; this.activeSession = session;
      try { return await session.flush(retry); }
      finally { this.committing -= 1; if (retry) this.retrying -= 1; this.activeSession = null; this.changed(); }
    });
    this.serial = task.catch(() => false);
    return task;
  }
  async flush(retry = false) {
    if (this.isCommitting) return true;
    for (const session of this.sessions) {
      if (session.dirty && !await this.commit(session, retry)) return false;
    }
    return true;
  }
}
