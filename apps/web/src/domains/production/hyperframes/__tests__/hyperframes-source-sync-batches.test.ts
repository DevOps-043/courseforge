import assert from "node:assert/strict";
import { it } from "node:test";
import { synchronizeHyperframesSourceBatches } from "../hyperframes-source-sync-batches";

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

it("limita comprobaciones a cuatro y conserva las descargas/escrituras secuenciales", async () => {
  let checking = 0;
  let maxChecking = 0;
  let downloading = 0;
  let maxDownloading = 0;
  const written: number[] = [];
  await synchronizeHyperframesSourceBatches(Array.from({ length: 11 }, (_, index) => index), async (reference) => {
    checking += 1;
    maxChecking = Math.max(maxChecking, checking);
    assert.equal(downloading, 0);
    await nextTurn();
    checking -= 1;
    return reference;
  }, async (reference) => {
    assert.equal(checking, 0);
    downloading += 1;
    maxDownloading = Math.max(maxDownloading, downloading);
    await nextTurn();
    written.push(reference);
    downloading -= 1;
  });
  assert.equal(maxChecking, 4);
  assert.equal(maxDownloading, 1);
  assert.deepEqual(written, Array.from({ length: 11 }, (_, index) => index));
});

it("resuelve comprobaciones en vuelo y no inicia escrituras ni otro lote tras un error", async () => {
  const checked: number[] = [];
  const completed: number[] = [];
  const written: number[] = [];
  const failure = new Error("Storage no disponible");
  await assert.rejects(synchronizeHyperframesSourceBatches([0, 1, 2, 3, 4, 5], async (reference) => {
    checked.push(reference);
    if (reference === 1) throw failure;
    await nextTurn();
    completed.push(reference);
    return reference;
  }, async (reference) => { written.push(reference); }), (error) => error === failure);
  assert.deepEqual(checked, [0, 1, 2, 3]);
  assert.deepEqual(completed, [0, 2, 3]);
  assert.deepEqual(written, []);
});

it("detiene lotes posteriores cuando falla la persistencia y admite una lista vacía", async () => {
  const checked: number[] = [];
  await assert.rejects(synchronizeHyperframesSourceBatches([0, 1, 2, 3, 4], async (reference) => {
    checked.push(reference);
    return reference;
  }, async () => { throw new Error("No se pudo guardar"); }), /No se pudo guardar/);
  assert.deepEqual(checked, [0, 1, 2, 3]);
  await synchronizeHyperframesSourceBatches([], async () => assert.fail(), async () => assert.fail());
});
