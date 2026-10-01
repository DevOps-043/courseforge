import type { CompositionEditorDocument } from "./composition-document.types";

export const COMPOSITION_COMMAND_HISTORY_DEFAULTS = {
  maxEntries: 50,
  maxSerializedBytes: 20 * 1024 * 1024,
} as const;

export type CompositionCommandHistoryEntry = {
  afterDocument: CompositionEditorDocument;
  beforeDocument: CompositionEditorDocument;
  id: string;
  serializedBytes: number;
  source: "AGENT" | "SYSTEM" | "USER";
  summary: string;
};

export type CompositionCommandHistorySnapshot = {
  canRedo: boolean;
  canUndo: boolean;
  redoLabel: string | null;
  retainedEntries: number;
  retainedSerializedBytes: number;
  undoLabel: string | null;
};

type HistoryLimits = {
  maxEntries?: number;
  maxSerializedBytes?: number;
};

type RecordCommandInput = {
  afterDocument: CompositionEditorDocument;
  beforeDocument: CompositionEditorDocument;
  source: CompositionCommandHistoryEntry["source"];
  summary: string;
};

/**
 * Session-scoped command history for the composition editor.
 *
 * Entries contain immutable document checkpoints rather than inverse patches:
 * restoring an older document is already an atomic, validated server command,
 * and this avoids maintaining a second inverse implementation for every patch.
 */
export class CompositionCommandHistory {
  private readonly maxEntries: number;
  private readonly maxSerializedBytes: number;
  private readonly redoEntries: CompositionCommandHistoryEntry[] = [];
  private sequence = 0;
  private readonly undoEntries: CompositionCommandHistoryEntry[] = [];

  constructor(limits: HistoryLimits = {}) {
    this.maxEntries = limits.maxEntries ?? COMPOSITION_COMMAND_HISTORY_DEFAULTS.maxEntries;
    this.maxSerializedBytes = limits.maxSerializedBytes ?? COMPOSITION_COMMAND_HISTORY_DEFAULTS.maxSerializedBytes;
    if (!Number.isInteger(this.maxEntries) || this.maxEntries < 1) throw new Error("El historial requiere al menos una entrada.");
    if (!Number.isInteger(this.maxSerializedBytes) || this.maxSerializedBytes < 1) throw new Error("El historial requiere un presupuesto de memoria positivo.");
  }

  clear() {
    this.undoEntries.length = 0;
    this.redoEntries.length = 0;
  }

  commitRedo(expectedEntryId: string) {
    const entry = this.redoEntries.at(-1);
    if (!entry || entry.id !== expectedEntryId) return false;
    this.redoEntries.pop();
    this.undoEntries.push(entry);
    return true;
  }

  commitUndo(expectedEntryId: string) {
    const entry = this.undoEntries.at(-1);
    if (!entry || entry.id !== expectedEntryId) return false;
    this.undoEntries.pop();
    this.redoEntries.push(entry);
    return true;
  }

  peekRedo() {
    return this.redoEntries.at(-1) || null;
  }

  peekUndo() {
    return this.undoEntries.at(-1) || null;
  }

  record(input: RecordCommandInput) {
    const beforeJson = JSON.stringify(input.beforeDocument);
    const afterJson = JSON.stringify(input.afterDocument);
    if (beforeJson === afterJson) return false;

    const serializedBytes = utf8ByteLength(beforeJson) + utf8ByteLength(afterJson);
    if (serializedBytes > this.maxSerializedBytes) {
      this.clear();
      return false;
    }

    this.sequence += 1;
    this.redoEntries.length = 0;
    this.undoEntries.push({
      afterDocument: JSON.parse(afterJson) as CompositionEditorDocument,
      beforeDocument: JSON.parse(beforeJson) as CompositionEditorDocument,
      id: `composition-command-${this.sequence}`,
      serializedBytes,
      source: input.source,
      summary: input.summary,
    });
    this.enforceLimits();
    return true;
  }

  snapshot(): CompositionCommandHistorySnapshot {
    const undo = this.peekUndo();
    const redo = this.peekRedo();
    const retained = [...this.undoEntries, ...this.redoEntries];
    return {
      canRedo: Boolean(redo),
      canUndo: Boolean(undo),
      redoLabel: redo?.summary || null,
      retainedEntries: retained.length,
      retainedSerializedBytes: retained.reduce((total, entry) => total + entry.serializedBytes, 0),
      undoLabel: undo?.summary || null,
    };
  }

  private enforceLimits() {
    while (this.undoEntries.length + this.redoEntries.length > this.maxEntries) this.undoEntries.shift();
    while (this.snapshot().retainedSerializedBytes > this.maxSerializedBytes && this.undoEntries.length > 0) {
      this.undoEntries.shift();
    }
  }
}

function utf8ByteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
