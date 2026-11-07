import assert from "node:assert/strict";
import { it } from "node:test";
import { prepareHyperframesEditor } from "../hyperframes-editor-preparation.client";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

it("solapa composición y sincronización; biblioteca y borrador esperan medios actuales", async () => {
  const sync = deferred();
  const composition = deferred();
  const events: string[] = [];
  const preparation = prepareHyperframesEditor({
    synchronize: async () => { events.push("sync"); await sync.promise; },
    prepareComposition: async () => { events.push("composition"); await composition.promise; return "composición"; },
    loadAssets: async () => { events.push("assets"); },
    openDraft: async (value) => { assert.equal(value, "composición"); events.push("draft"); },
  });
  await nextTurn();
  assert.deepEqual(events, ["sync", "composition"]);
  sync.resolve();
  await nextTurn();
  assert.deepEqual(events, ["sync", "composition", "assets"]);
  composition.resolve();
  await preparation;
  assert.equal(events.at(-1), "draft");
});

it("no espera la biblioteca para solicitar el borrador, pero sí para completar la apertura", async () => {
  const assets = deferred();
  let draftOpened = false;
  let finished = false;
  const preparation = prepareHyperframesEditor({
    synchronize: async () => {},
    prepareComposition: async () => "composición",
    loadAssets: () => assets.promise,
    openDraft: async () => { draftOpened = true; },
  }).then(() => { finished = true; });
  await nextTurn();
  assert.equal(draftOpened, true);
  assert.equal(finished, false);
  assets.resolve();
  await preparation;
  assert.equal(finished, true);
});

it("conserva la carga de biblioteca ante errores de composición o borrador", async () => {
  for (const failureAt of ["composition", "draft"]) {
    let loaded = false;
    const failure = new Error(failureAt);
    await assert.rejects(prepareHyperframesEditor({
      synchronize: async () => {},
      prepareComposition: async () => { if (failureAt === "composition") throw failure; return "composición"; },
      loadAssets: async () => { loaded = true; },
      openDraft: async () => { throw failure; },
    }), (error) => error === failure);
    assert.equal(loaded, true);
  }
});

it("propaga fallo de biblioteca después de terminar las operaciones en vuelo", async () => {
  const draft = deferred();
  const failure = new Error("biblioteca");
  const preparation = prepareHyperframesEditor({
    synchronize: async () => {},
    prepareComposition: async () => "composición",
    loadAssets: async () => { throw failure; },
    openDraft: () => draft.promise,
  });
  const rejected = assert.rejects(preparation, (error) => error === failure);
  await nextTurn();
  draft.resolve();
  await rejected;
});
