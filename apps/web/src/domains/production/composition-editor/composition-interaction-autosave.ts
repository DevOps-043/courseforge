export const COMPOSITION_AUTOSAVE_DELAY_MS = 600;
export type CompositionAutosaveCommit = () => Promise<boolean | void> | boolean | void;
export type CompositionAutosaveState = "IDLE" | "PENDING" | "SAVING" | "INVALID" | "ERROR";
type PendingInteraction = { signature: string; commit: CompositionAutosaveCommit; token: symbol };

/** Conserva el callback del borrador, aunque una respuesta posterior vuelva a renderizar el control. */
export class CompositionInteractionAutosave {
  private pending: PendingInteraction | null = null;
  private readonly active = new Map<PendingInteraction, Promise<boolean>>();
  private confirmed: string;
  state: CompositionAutosaveState = "IDLE";
  constructor(signature: string, private readonly notify: () => void = () => {}, private readonly options: { serialize?: boolean } = {}) { this.confirmed = signature; }
  get serializesCommit() { return this.options.serialize === true; }
  get dirty() { return this.pending !== null; }
  get pendingToken() { return this.pending?.token; }
  confirmPersisted(token?: symbol) { if (token && this.pending?.token !== token) return; if (this.pending) this.confirmed = this.pending.signature; this.pending = null; this.state = "IDLE"; this.notify(); }
  discard(token?: symbol) { if (this.active.size || token && this.pending?.token !== token) return false; this.pending = null; this.state = "IDLE"; this.notify(); return true; }
  observe(signature: string) { if (!this.dirty && !this.active.size) this.confirmed = signature; }
  stage(signature: string, commit: CompositionAutosaveCommit) {
    if (this.pending?.signature === signature) { if (!this.active.has(this.pending)) this.pending.commit = commit; return; }
    if (!this.pending && !this.active.size && signature === this.confirmed) return;
    const failed = this.state === "ERROR";
    if (signature === this.confirmed && !this.active.size) { this.pending = null; this.state = "IDLE"; }
    else { this.pending = { signature, commit, token: Symbol() }; this.state = failed ? "ERROR" : "PENDING"; }
    this.notify();
  }
  flush(retry = false): Promise<boolean> {
    if (this.serializesCommit && this.active.size) return this.active.values().next().value!;
    if (this.state === "ERROR" && !retry) return Promise.resolve(false);
    const pending = this.pending;
    if (!pending) return Promise.resolve(true);
    const existing = this.active.get(pending);
    if (existing) return existing;
    this.state = "SAVING"; this.notify();
    // El callback admite el comando sin esperar red. La cola del documento serializa I/O.
    let result: ReturnType<CompositionAutosaveCommit>;
    try { result = pending.commit(); } catch { result = false; }
    const active = Promise.resolve(result).then((saved) => {
      if (saved === true) {
        this.confirmed = pending.signature;
        if (this.pending === pending) { this.pending = null; this.state = "IDLE"; }
        else if (this.state !== "ERROR" && this.state !== "INVALID") this.state = this.pending ? "PENDING" : "IDLE";
      } else this.state = saved === false ? "ERROR" : "INVALID";
      return saved === true;
    }, () => { this.state = "ERROR"; return false; }).finally(() => { this.active.delete(pending); this.notify(); });
    this.active.set(pending, active);
    return active;
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
    if (!session.serializesCommit) return this.performCommit(session, retry);
    // Los campos HTML mantienen la coordinación exclusiva anterior a esta optimización.
    const task = this.serial.then(() => this.performCommit(session, retry));
    this.serial = task.catch(() => false);
    return task;
  }
  private performCommit(session: CompositionInteractionAutosave, retry: boolean): Promise<boolean> {
    this.committing += 1; if (retry) this.retrying += 1;
    const previous = this.activeSession;
    this.activeSession = session;
    let task: Promise<boolean>;
    try { task = session.flush(retry); }
    finally { this.activeSession = previous; }
    return task.finally(() => { this.committing -= 1; if (retry) this.retrying -= 1; this.changed(); });
  }
  async flush(retry = false) {
    if (this.isCommitting) return true;
    for (const session of this.sessions) {
      if (session.dirty && !await this.commit(session, retry)) return false;
    }
    return true;
  }
}
