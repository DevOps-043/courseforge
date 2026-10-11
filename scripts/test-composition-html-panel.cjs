const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire, Module } = require("node:module");
const ts = require("typescript");

const componentDirectory = resolve(__dirname, "../apps/web/src/domains/materials/components/composition-editor");
const appRequire = createRequire(resolve(__dirname, "../apps/web/package.json"));
const React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const source = name => readFileSync(resolve(componentDirectory, name), "utf8");

// Render the real TSX without a Next server. Only CSS imports and domain services
// are substituted; these tests do not claim browser layout or integration QA.
function loadComponent(name, dependencies = {}) {
  const filename = resolve(componentDirectory, name);
  const compiled = ts.transpileModule(source(name), {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    fileName: filename,
  }).outputText;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = specifier => {
    if (Object.hasOwn(dependencies, specifier)) return dependencies[specifier];
    if (specifier.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
    return appRequire(specifier);
  };
  loaded._compile(compiled, filename);
  return loaded.exports;
}

const { CompositionHtmlPanel } = loadComponent("CompositionHtmlPanel.tsx");
const renderPanel = props => renderToStaticMarkup(React.createElement(CompositionHtmlPanel, {
  title: "Contenido HTML editable", label: "Inspector HTML editorial", ...props,
}, React.createElement("button", { type: "button", "data-primary": "true" }, "Cargar campos editables")));

test("main editing panel is immediately visible, named and exposes busy state", () => {
  const markup = renderPanel({ busy: true });
  assert.match(markup, /aria-label="Inspector HTML editorial" aria-busy="true"/);
  assert.match(markup, /<h3[^>]*>Contenido HTML editable<\/h3>/);
  assert.match(markup, /data-primary="true"/);
  assert.doesNotMatch(markup, /<details/);
});

test("technical tools default to a native closed disclosure", () => {
  const markup = renderPanel({ collapsible: true });
  assert.match(markup, /<details class="disclosure">/);
  assert.match(markup, /<summary class="header">/);
  assert.doesNotMatch(markup, /<details[^>]*open/);
});

test("pending recovery can stay open and descriptions are escaped", () => {
  const markup = renderPanel({ collapsible: true, initiallyOpen: true, description: "<script>unsafe</script>" });
  assert.match(markup, /<details[^>]*open=""/);
  assert.match(markup, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.doesNotMatch(markup, /<script>/);
});

test("actual scalar editor labels its field and does not enable an empty batch", () => {
  const { CompositionHtmlEditableFields } = loadComponent("CompositionHtmlEditableFields.tsx", {
    "@/domains/production/composition-editor/html-editing/html-editing.contract": { HTML_EDITING_LIMITS: { commandOverrides: 20, textCharacters: 1000 } },
    "@/domains/production/composition-editor/composition-html-editing-field-command.client": {},
    "./CompositionHtmlSlotsField": {}, "./CompositionHtmlChartField": {}, "./CompositionHtmlStyleRangeField": {},
  });
  const view = { revisionSha256: "fixture", manifest: { elements: [
    { elementId: "title", kind: "TEXT", label: "Título de diapositiva", maxCharacters: 80, multiline: true },
  ] }, defaults: [{ elementId: "title", kind: "TEXT", value: "Ventas" }], state: { overrides: [] } };
  const markup = renderToStaticMarkup(React.createElement(CompositionHtmlEditableFields, {
    view, busy: false, onCommit: () => { throw new Error("Rendering must never commit"); },
  }));
  assert.match(markup, /disabled=""[^>]*>Guardar cambios \(0\)/);
  assert.match(markup, /<legend>Título de diapositiva<\/legend>/);
  assert.match(markup, /<textarea[^>]*>Ventas<\/textarea>/);
  assert.match(markup, /Preparar cambio/);
});

test("editor precedes setup/adoption and recovery safeguards remain explicit", () => {
  const inspector = source("CompositionHtmlEditorialInspector.tsx");
  assert.ok(inspector.indexOf("{enabled && <ScopedInspector") < inspector.indexOf("{host && <CompositionHtmlInitializationPanel"));
  assert.ok(inspector.indexOf("{host && <CompositionHtmlInitializationPanel") < inspector.indexOf("{host && <CompositionHtmlLegacyAdoptionPanel"));
  assert.match(inspector, /host=\{mutationsEnabled \? host : undefined\}/);
  assert.match(inspector, /<details><summary>Ver valores y límites declarados/);
  assert.match(source("CompositionHtmlInitializationPanel.tsx"), /collapsible=\{Boolean\(target\)\}/);
  assert.match(source("CompositionHtmlLegacyAdoptionPanel.tsx"), /initiallyOpen=\{tracking\?\.status !== "EMPTY"\}/);
});

test("styles are scoped, use Engine tokens and support keyboard/narrow panels", () => {
  const css = source("CompositionHtmlPanel.module.css");
  assert.match(css, /var\(--studio-text, var\(--engine-text/);
  assert.match(css, /font-family: var\(--font-system-ui/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /flex-wrap: wrap/);
  assert.match(css, /min-height: 40px/);
  assert.doesNotMatch(css, /:root|!important/);
});

test("initial anchor step is explicit, uses the coordinated host and does not prepare during rendering", () => {
  const { CompositionHtmlInitialAnchorStep } = loadComponent("CompositionHtmlInitialAnchorStep.tsx");
  const markup = renderToStaticMarkup(React.createElement(CompositionHtmlInitialAnchorStep, {
    scope: {}, disabled: false, host: { initialAnchor: () => { throw new Error("Render must not perform I/O"); } },
    onAvailabilityChange: () => { throw new Error("Render must not change availability"); },
  }));
  assert.match(markup, /Comprobar revisión guardada/);
  assert.match(markup, /no cambia el timeline, no aprueba el video ni ejecuta un render/);
  assert.doesNotMatch(markup, /Preparar primera revisión para editar/);
  const step = source("CompositionHtmlInitialAnchorStep.tsx");
  assert.match(step, /action === "PREPARE" && status !== "MISSING"/);
  assert.match(step, /setStatus\("UNKNOWN"\)/);
  assert.doesNotMatch(step, /setInterval|setTimeout|fetch\(/);
  assert.match(source("CompositionHtmlInitializationPanel.tsx"), /host.initialAnchor && !anchorAvailable/);
});
