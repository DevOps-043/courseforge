import assert from "node:assert/strict";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { load } from "./source-test-loader";

test("campos de diapositivas pertenece a Herramientas y cerrar no ejecuta preparación", () => {
  const events: string[] = [];
  const source = "src/domains/materials/components/composition-editor/CompositionSlideEditingTools.tsx";
  const { CompositionSlideEditingTools } = load<{ CompositionSlideEditingTools: (props: Record<string, unknown>) => ReactNode }>(source, {
    "@/components/ui/EngineDialog": { EngineDialog: ({ isOpen, children, title }: { isOpen: boolean; children: ReactNode; title: string }) => isOpen
      ? createElement("section", { role: "dialog", "aria-label": title }, children) : null },
    "./CompositionHtmlRecoveryCenter": { CompositionHtmlRecoveryCenter: () => createElement("div", null, "Seguimiento editorial") },
  });
  const props = { open: false, onClose() {}, busy: false, draftId: "draft", compositionId: "composition",
    host: { prepareGeneratedDeck: () => events.push("prepare"), initialAnchor: () => events.push("anchor") },
    document: { canvas: { durationMode: "AUTO", durationSource: "slides" } }, onRecalculateDuration: async () => {} };
  assert.equal(renderToStaticMarkup(createElement(CompositionSlideEditingTools, props)), "");
  const opened = renderToStaticMarkup(createElement(CompositionSlideEditingTools, { ...props, open: true }));
  assert.match(opened, /role="dialog"/); assert.match(opened, /Campos de diapositivas/); assert.match(opened, /Seguimiento editorial/);
  assert.doesNotMatch(opened, /Recalcular duración/);
  const pendingDuration = renderToStaticMarkup(createElement(CompositionSlideEditingTools, { ...props, open: true, document: { canvas: { durationMode: "AUTO" } } }));
  assert.match(pendingDuration, /Recalcular duración/);
  assert.deepEqual(events, []);
});

test("las diapositivas preparadas conservan su estado al reabrir herramientas y no usan disclosure", () => {
  const source = "src/domains/materials/components/composition-editor/CompositionGeneratedDeckPreparationPanel.tsx";
  let calls = 0;
  const { CompositionGeneratedDeckPreparationPanel: Panel } = load<{ CompositionGeneratedDeckPreparationPanel: (props: Record<string, unknown>) => ReactNode }>(source, {
    "@/domains/production/composition-editor/composition-generated-deck-initialization-coordinator.client": {},
    "@/domains/production/composition-editor/composition-html-initial-anchor.client": {},
    "./CompositionHtmlInitialAnchorStep": {},
    "./CompositionHtmlPanel": { CompositionHtmlPanel: ({ children, collapsible }: { children: ReactNode; collapsible?: boolean }) =>
      createElement(collapsible ? "details" : "section", null, children) },
  }, { process: { env: {} } });
  const rendered = renderToStaticMarkup(createElement(Panel, { scope: {}, document: { clips: [{ id: "slide", kind: "DECK_SLIDE" }], htmlEditing: { items: [{ clipId: "slide" }] } },
    host: { generatedDeckTracking: () => ({ status: "EMPTY" }), prepareGeneratedDeck: () => { calls++; } } }));
  assert.match(rendered, /1 diapositivas con campos habilitados/); assert.match(rendered, /Cargar campos editables/);
  assert.doesNotMatch(rendered, /<details|<summary/); assert.equal(calls, 0);
});

test("el menú del monitor ofrece el acceso editorial", () => {
  const source = "src/domains/materials/components/composition-editor/CompositionPreviewToolbar.tsx";
  const { CompositionPreviewToolbar: Toolbar } = load<{ CompositionPreviewToolbar: (props: Record<string, unknown>) => ReactNode }>(source, {
    "@/components/ui/EngineSelect": { EngineSelect: () => null },
    "@/domains/production/composition-editor/composition-preview-view.config": { COMPOSITION_PREVIEW_ZOOM: { minimum: 0.25, maximum: 2, step: 0.1 } },
    "@/domains/production/composition-editor/composition-ui-presentation": { formatCompositionUiTimecode: () => "00:00" },
    "./CompositionPreviewZoomControls": { CompositionPreviewZoomControls: () => null },
    "../../../../config/app": { APP_CONFIG: { name: "Engine", assistant: { displayName: "SofLIA" } } },
    "./useCompositionPanelFocus": { useCompositionPanelFocus() {} }, "./useCompositionAnchoredPopover": { useCompositionAnchoredPopover() {} },
    "./CompositionStudio.module.css": { default: {} },
  });
  const rendered = renderToStaticMarkup(createElement(Toolbar, { canvas: { width: 1920, height: 1080 }, duration: 20, toolMenuOpen: true,
    previewZoom: 1, toolMenuRef: { current: null }, onOpenSlideEditing() {}, removalRangeStartSeconds: null }));
  assert.match(rendered, /role="menuitem"[^>]*><[^]*?Campos de diapositivas/);
});
