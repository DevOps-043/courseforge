import assert from "node:assert/strict";
import test from "node:test";
import {
  createDefaultArtifactWorkspacePreferences,
  getArtifactWorkspaceStorageKey,
  loadArtifactWorkspacePreferences,
  resolveRestoredArtifactWorkflowStep,
  saveArtifactWorkspacePreferences,
  type ArtifactWorkflowStep,
} from "../artifact-workspace-preferences";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

test("keeps step and scroll positions isolated per artifact", () => {
  const storage = new MemoryStorage();
  saveArtifactWorkspacePreferences(storage, "artifact-a", {
    currentStep: 5,
    scrollByStep: { 4: 320, 5: 1_240 },
  });

  assert.deepEqual(loadArtifactWorkspacePreferences(storage, "artifact-a"), {
    currentStep: 5,
    scrollByStep: { 4: 320, 5: 1_240 },
  });
  assert.deepEqual(
    loadArtifactWorkspacePreferences(storage, "artifact-b"),
    createDefaultArtifactWorkspacePreferences(),
  );
});

test("rejects malformed or unsupported persisted data", () => {
  const storage = new MemoryStorage();
  storage.setItem(getArtifactWorkspaceStorageKey("malformed"), "not-json");
  storage.setItem(
    getArtifactWorkspaceStorageKey("unsupported"),
    JSON.stringify({ version: 2, currentStep: 8, scrollByStep: { 8: 999 } }),
  );

  assert.deepEqual(
    loadArtifactWorkspacePreferences(storage, "malformed"),
    createDefaultArtifactWorkspacePreferences(),
  );
  assert.deepEqual(
    loadArtifactWorkspacePreferences(storage, "unsupported"),
    createDefaultArtifactWorkspacePreferences(),
  );
});

test("sanitizes invalid scroll positions", () => {
  const storage = new MemoryStorage();
  storage.setItem(
    getArtifactWorkspaceStorageKey("artifact-a"),
    JSON.stringify({
      version: 1,
      currentStep: 3,
      scrollByStep: { 1: -1, 2: "400", 3: 800, 9: 900 },
    }),
  );

  assert.deepEqual(loadArtifactWorkspacePreferences(storage, "artifact-a"), {
    currentStep: 3,
    scrollByStep: { 3: 800 },
  });
});

test("does not restore a locally persisted step that is no longer accessible", () => {
  const preferences = {
    currentStep: 8 as ArtifactWorkflowStep,
    scrollByStep: { 8: 1_000 },
  };

  assert.equal(resolveRestoredArtifactWorkflowStep(preferences, (step) => step <= 5), 1);
  assert.equal(resolveRestoredArtifactWorkflowStep(preferences, () => true), 8);
});
