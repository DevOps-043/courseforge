import assert from "node:assert/strict";
import test from "node:test";
import { requestCompositionDocumentSave } from "../composition-document-save-request";
import { CompositionSaveQueue } from "../composition-save-queue";

test("un guardado sin respuesta libera la cola y conserva el resultado incierto", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (_url, options) => new Promise<Response>((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    });
    let failure = "";
    const queue = new CompositionSaveQueue<null>(async () => {
      try { await requestCompositionDocumentSave("http://localhost/document", { method: "PUT" }, 10); return true; }
      catch (error) { failure = String(error); return false; }
    });
    // Mantener vivo el proceso para observar AbortSignal.timeout en Node.
    const keepAlive = setTimeout(() => {}, 1000);
    try {
      assert.equal(await queue.enqueue(null), false);
      await queue.whenIdle();
      assert.equal(queue.snapshot().status, "IDLE");
      assert.match(failure, /servidor podría haberlo completado/);
      globalThis.fetch = async () => Response.json({ data: { documentHash: "nuevo" } });
      assert.equal(await queue.enqueue(null), true, "La misma cola admite un guardado posterior.");
      const saved = await requestCompositionDocumentSave("http://localhost/document", { method: "PUT" });
      assert.equal(saved.response.status, 200);
      assert.deepEqual(saved.body, { data: { documentHash: "nuevo" } });
    } finally { clearTimeout(keepAlive); }
  } finally { globalThis.fetch = originalFetch; }
});

test("el límite incluye el cuerpo de respuesta y conserva los conflictos HTTP", async () => {
  const originalFetch = globalThis.fetch;
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    globalThis.fetch = async (_url, options) => ({ json: () => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
    }) }) as Response;
    await assert.rejects(requestCompositionDocumentSave("http://localhost/document", {}, 10), /tiempo de espera/);
    globalThis.fetch = async () => Response.json({ error: "Conflicto" }, { status: 409 });
    const conflict = await requestCompositionDocumentSave("http://localhost/document", {});
    assert.equal(conflict.response.status, 409);
  } finally { globalThis.fetch = originalFetch; clearTimeout(keepAlive); }
});
