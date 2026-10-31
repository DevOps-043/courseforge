import assert from "node:assert/strict";
import test from "node:test";
import { createCompositionPositionPreviewRuntime } from "../composition-position-preview-runtime";
import { createCompositionPreviewParentCommand } from "../composition-preview-protocol";
import { compositionLayoutSchema } from "../composition-document.types";

function fixture() {
  const target = { style: { left: "100px", top: "50px", opacity: "0.5", width: "400px", transform: "rotate(15deg)" } };
  const nodes = new Map([["clip", target]]);
  const runtime = createCompositionPositionPreviewRuntime(id => nodes.get(id) as unknown as HTMLElement ?? null, {
    minimum: compositionLayoutSchema.shape.x.minValue!, maximum: compositionLayoutSchema.shape.x.maxValue!,
  });
  return { runtime, target, nodes };
}

test("el preview parcial conserva el otro eje, tamaño, opacidad y rotación", () => {
  const { runtime, target } = fixture();
  runtime.preview("clip", { x: -120.5 });
  runtime.preview("clip", { y: 240 });
  assert.deepEqual(target.style, { left: "-120.5px", top: "240px", opacity: "0.5", width: "400px", transform: "rotate(15deg)" });
  runtime.preview("clip", null);
  assert.equal(target.style.left, "100px");
  assert.equal(target.style.top, "50px");
});

test("una confirmación anterior actualiza la base y conserva el borrador posterior", () => {
  const { runtime, target } = fixture();
  runtime.preview("clip", { x: 300 });
  runtime.restore();
  target.style.left = "200px";
  runtime.rebase();
  assert.equal(target.style.left, "300px");
  runtime.preview("clip", null);
  assert.equal(target.style.left, "200px");
});

test("confirmar la posición temporal elimina la superposición sin revertir al limpiar", () => {
  const { runtime, target } = fixture();
  runtime.preview("clip", { x: 300 });
  runtime.restore();
  target.style.left = "300px";
  runtime.rebase();
  runtime.preview("clip", null);
  assert.equal(target.style.left, "300px");
});

test("una escena nueva conserva el borrador sobre el nodo nuevo y tolera eliminación", () => {
  const { runtime, nodes } = fixture();
  runtime.preview("clip", { x: 300 });
  runtime.restore();
  const replacement = { style: { left: "250px", top: "60px", opacity: "1", width: "500px", transform: "none" } };
  nodes.set("clip", replacement);
  runtime.rebase();
  assert.equal(replacement.style.left, "300px");
  runtime.preview("clip", null);
  assert.equal(replacement.style.left, "250px");
  runtime.preview("clip", { x: 350 });
  nodes.delete("clip");
  assert.doesNotThrow(() => { runtime.rebase(); runtime.preview("clip", null); });
});

test("protocolo y receptor rechazan valores inválidos sin tocar el último preview válido", () => {
  const { runtime, target } = fixture();
  runtime.preview("clip", { x: 200 });
  for (const position of [{ x: NaN }, { y: Infinity }, { x: 9000 }, {}, { opacity: 0.5 }]) {
    assert.equal(createCompositionPreviewParentCommand({ type: "courseforge-composition-preview-position", hfId: "clip", position } as never), null);
    runtime.preview("clip", position as { x: number });
    assert.equal(target.style.left, "200px");
  }
  for (const position of [{ x: -100.5 }, { y: 0 }, null]) {
    assert.ok(createCompositionPreviewParentCommand({ type: "courseforge-composition-preview-position", hfId: "clip", position }));
  }
});
