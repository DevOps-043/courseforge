import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
  clearCompositionRecoveryEntry,
  createCompositionRecoveryEntry,
  readCompositionRecoveryEntry,
  resolveCompositionRecovery,
  writeCompositionRecoveryEntry,
  type CompositionRecoveryStorage,
} from "../composition-recovery-journal";
import { applyCompositionEditorPatches } from "../editor-patch.service";
import { createTransitionDocument } from "./composition-transition-test-fixtures";

const DRAFT_ID = "10000000-0000-4000-8000-000000000001";

test("replays only when the durable document still matches the journal base", async () => {
  const storage = new MemoryStorage();
  const document = createTransitionDocument();
  const operations = [{ height: 1920 as const, type: "composition.canvas-size" as const, width: 1080 as const }];
  const target = applyCompositionEditorPatches(document, operations, "USER");
  const entry = await createCompositionRecoveryEntry({
    baseDocumentHash: "a".repeat(64),
    draftId: DRAFT_ID,
    entryId: "20000000-0000-4000-8000-000000000002",
    nowMs: 1_000,
    operations,
    source: "USER",
    summary: "Cambió el lienzo.",
    targetDocument: target,
  });
  writeCompositionRecoveryEntry(storage, entry);

  assert.equal(entry.targetDocumentHash, createHash("sha256").update(stableStringify(target)).digest("hex"));
  assert.equal(resolveCompositionRecovery(storage, DRAFT_ID, "a".repeat(64), 2_000).status, "REPLAY");
  assert.equal(resolveCompositionRecovery(storage, DRAFT_ID, entry.targetDocumentHash, 2_000).status, "ALREADY_COMMITTED");
  assert.equal(resolveCompositionRecovery(storage, DRAFT_ID, "b".repeat(64), 2_000).status, "CONFLICT");
});

test("rejects stale or malformed entries and clears only the expected command", async () => {
  const storage = new MemoryStorage();
  const document = createTransitionDocument();
  const nowMs = Date.now();
  const entry = await createCompositionRecoveryEntry({
    baseDocumentHash: "a".repeat(64),
    draftId: DRAFT_ID,
    entryId: "20000000-0000-4000-8000-000000000002",
    nowMs,
    operations: [{ height: 1920, type: "composition.canvas-size", width: 1080 }],
    source: "USER",
    summary: "Cambió el lienzo.",
    targetDocument: document,
  });
  writeCompositionRecoveryEntry(storage, entry);
  assert.equal(clearCompositionRecoveryEntry(storage, DRAFT_ID, "30000000-0000-4000-8000-000000000003"), false);
  assert.ok(readCompositionRecoveryEntry(storage, DRAFT_ID, nowMs + 1_000));
  assert.equal(readCompositionRecoveryEntry(storage, DRAFT_ID, entry.expiresAtMs), null);

  storage.setItem(`courseforge:composition-recovery:v1:${DRAFT_ID}`, "not-json");
  assert.equal(readCompositionRecoveryEntry(storage, DRAFT_ID), null);
});

class MemoryStorage implements CompositionRecoveryStorage {
  private readonly values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) || null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
