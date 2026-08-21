import assert from "node:assert/strict";
import test from "node:test";
import {
  clampPreviewPlayhead,
  classifyPreviewTimeMessage,
  isPreviewRefreshRequired,
} from "../composition-preview-playhead.service";

test("ignora el cero inicial del iframe mientras espera restaurar el playhead", () => {
  assert.deepEqual(classifyPreviewTimeMessage({
    pendingRestoreSeconds: 42,
    pendingSeekSeconds: null,
    reportedSeconds: 0,
  }), { accept: false, completesRestore: false });
});

test("mantiene pendiente la restauración hasta que el iframe confirma el seek", () => {
  const stale = classifyPreviewTimeMessage({
    pendingRestoreSeconds: 42,
    pendingSeekSeconds: 42,
    reportedSeconds: 0,
  });
  const confirmed = classifyPreviewTimeMessage({
    pendingRestoreSeconds: 42,
    pendingSeekSeconds: 42,
    reportedSeconds: 42.01,
  });

  assert.deepEqual(stale, { accept: false, completesRestore: false });
  assert.deepEqual(confirmed, { accept: true, completesRestore: true });
});

test("conserva el comportamiento normal para reproducción y seeks manuales", () => {
  assert.deepEqual(classifyPreviewTimeMessage({
    pendingRestoreSeconds: null,
    pendingSeekSeconds: null,
    reportedSeconds: 18,
  }), { accept: true, completesRestore: false });
  assert.deepEqual(classifyPreviewTimeMessage({
    pendingRestoreSeconds: null,
    pendingSeekSeconds: 18,
    reportedSeconds: 18.02,
  }), { accept: true, completesRestore: false });
});

test("ajusta la posición restaurada a la nueva duración del canvas", () => {
  assert.equal(clampPreviewPlayhead(42, 30), 30);
  assert.equal(clampPreviewPlayhead(-1, 30), 0);
  assert.equal(clampPreviewPlayhead(12, 30), 12);
});

test("solicita una sola actualización cuando el documento guardado supera al preview", () => {
  assert.equal(isPreviewRefreshRequired({
    persistedDocumentHash: "version-2",
    previewDirty: true,
    previewDocumentHash: "version-1",
  }), true);
  assert.equal(isPreviewRefreshRequired({
    persistedDocumentHash: "version-2",
    previewDirty: false,
    previewDocumentHash: "version-2",
  }), false);
});
