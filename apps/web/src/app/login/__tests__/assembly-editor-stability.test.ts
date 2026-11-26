import assert from "node:assert/strict";
import test from "node:test";
import { load } from "./source-test-loader";

type Node = { type: unknown; props: Record<string, unknown> };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Ejecuta las fuentes del contenedor con fronteras de datos controladas. No
// simula al editor: verifica que su nodo no desaparece durante una actualización.
function harness() {
  const slots: Slot[] = []; let cursor = 0; let dirty = true;
  let effects: Array<() => void> = [];
  const same = (a?: unknown[], b?: unknown[]) => Boolean(a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i])));
  const hook = () => slots[cursor++] ?? (slots[cursor - 1] = {});
  const memo = (factory: () => unknown, deps: unknown[]) => { const s = hook(); if (!same(s.deps, deps)) { s.value = factory(); s.deps = deps; } return s.value; };
  const react = {
    useState(initial: unknown) { const s = hook(); if (!("value" in s)) s.value = initial; return [s.value, (next: unknown) => {
      const value = typeof next === "function" ? next(s.value) : next; if (!Object.is(s.value, value)) { s.value = value; dirty = true; }
    }]; },
    useRef(initial: unknown) { const s = hook(); return s.value ?? (s.value = { current: initial }); },
    useMemo: memo, useCallback: (fn: () => unknown, deps: unknown[]) => memo(() => fn, deps),
    useEffect(effect: () => (() => void) | void, deps: unknown[]) { const s = hook(); if (!same(s.deps, deps)) {
      s.deps = deps; effects.push(() => { s.cleanup?.(); s.cleanup = effect() || undefined; });
    } },
  };
  const requests: ReturnType<typeof deferred<unknown[]>>[] = [];
  const getArtifactComponents = () => { const next = deferred<unknown[]>(); requests.push(next); return next.promise; };
  const materialState = { materials: { lessons: [{ id: "material-lesson", lesson_id: "lesson", lesson_title: "Lección" }] },
    loading: false, getArtifactComponents, refresh: async () => {} };
  const Panel = () => null;
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const { PostproductionAssemblyContainer: Component } = load<{ PostproductionAssemblyContainer: (props: object) => Node }>(
    "src/domains/materials/components/PostproductionAssemblyContainer.tsx", {
      react, "react/jsx-runtime": { jsx, jsxs: jsx }, "next/navigation": { useSearchParams: () => ({ get: () => null }) },
      "lucide-react": { CheckCircle2: "icon", Clapperboard: "icon", Film: "icon", Loader2: "spinner" },
      "../hooks/useMaterials": { useMaterials: () => materialState }, "./HyperframesCompositionPanel": { HyperframesCompositionPanel: Panel },
      "./production-asset-ui": { PRODUCTION_THEME: {} },
      "../../course-delivery/lib/delivery-production-scope": { isAcademyProductionLesson: (id: string, ids: string[] | null) => ids === null || ids.includes(id) },
    }, { console: { error() {} } });
  let tree: Node;
  let props: object = { artifactId: "course", academyLessonIds: ["lesson"] };
  const render = (next?: object) => { if (next) props = next; cursor = 0; dirty = false; effects = []; tree = Component(props); effects.forEach(run => run()); };
  const settle = async () => { for (let i = 0; i < 10; i++) { await Promise.resolve(); if (dirty) render(); } };
  const nodes = (type: unknown): Node[] => {
    const found: Node[] = [];
    const visit = (value: unknown) => { if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === "object" && "props" in value) {
      const node = value as Node; if (node.type === type) found.push(node); Object.values(node.props).forEach(visit);
    } }; visit(tree); return found;
  };
  return { render, settle, requests, materialState, panel: () => nodes(Panel)[0],
    close: () => slots.forEach(s => s.cleanup?.()), text: () => JSON.stringify(tree) };
}

const row = (title = "Video") => [{ id: "video", material_lesson_id: "material-lesson", type: "VIDEO_DEMO", content: { title } }];

test("el alcance equivalente y las actualizaciones de materiales conservan el estudio abierto", async () => {
  const h = harness(); h.render(); h.requests[0].resolve(row()); await h.settle();
  assert.equal(h.panel()?.props.componentId, "video");
  h.render({ artifactId: "course", academyLessonIds: ["lesson", "lesson"] }); await h.settle();
  assert.equal(h.requests.length, 1, "Otro arreglo equivalente no vuelve a preparar la lista");
  h.materialState.materials = structuredClone(h.materialState.materials); h.render(); await h.settle();
  assert.equal(h.requests.length, 2);
  assert.equal(h.panel()?.props.componentId, "video", "El editor no se sustituye por el spinner");
  h.requests[1].reject(new Error("temporal")); await h.settle();
  assert.equal(h.panel()?.props.componentId, "video");
  assert.match(h.text(), /Se conserva el editor abierto/);
  h.close();
});

test("una respuesta antigua no reemplaza la lista nueva ni reabre otro borrador", async () => {
  const h = harness(); h.render(); h.requests[0].resolve(row()); await h.settle();
  h.materialState.materials = structuredClone(h.materialState.materials); h.render();
  h.materialState.materials = structuredClone(h.materialState.materials); h.render();
  h.requests[2].resolve(row("Actual")); await h.settle();
  h.requests[1].resolve(row("Anterior")); await h.settle();
  assert.equal(h.panel()?.props.componentTitle, "Actual");
  h.render({ artifactId: "course", academyLessonIds: [] });
  h.requests[3].resolve(row()); await h.settle();
  assert.equal(h.panel(), undefined, "Un cambio real del alcance sí retira la lección");
  h.close();
});
