const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");
const { createRequire, Module } = require("node:module");
const ts = require("typescript");

const filename = resolve(__dirname, "../apps/web/src/domains/production/fonts/components/GoogleFontPreparationControl.tsx");
const source = readFileSync(filename, "utf8");
const appRequire = createRequire(resolve(__dirname, "../apps/web/package.json"));
const React = appRequire("react");
const { renderToStaticMarkup } = appRequire("react-dom/server");
const compiled = ts.transpileModule(source, {
  compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, esModuleInterop: true }, fileName: filename,
}).outputText;
const loaded = new Module(filename, module);
loaded.filename = filename;
// Real TSX/React. Only the network adapter is substituted; this is not browser QA.
loaded.require = specifier => specifier === "../google-font-preparation.client"
  ? { requestGoogleFontPreparation: () => { throw new Error("SSR must not acquire or persist fonts"); } }
  : specifier === "../google-font-preparation-policy" ? { GOOGLE_FONT_PREPARATION_POLICY: { clientTimeoutMs: 30000 } }
  : appRequire(specifier);
loaded._compile(compiled, filename);
const { GoogleFontPreparationControl } = loaded.exports;
const render = properties => renderToStaticMarkup(React.createElement(GoogleFontPreparationControl, {
  fontId: "00000000-0000-4000-8000-000000000011", family: "Inter", ...properties,
}));
test("font control names the family, exposes inspection and does not imply native activation", () => {
  const markup = render({});
  assert.match(markup, /aria-label="Preparación local de Inter"/);
  assert.match(markup, /Consultar archivos/);
  assert.match(markup, /Después guarda la plantilla para usarlas en nuevas diapositivas editables/);
  assert.match(markup, /no cambia materiales existentes/);
  assert.doesNotMatch(markup, /Guardar archivos revisados|Verificar guardado|<script>/);
});
test("the host lock disables the initial font acquisition control", () => assert.match(render({ disabled: true }), /<button[^>]*disabled=""/));
test("font controls use Engine tokens and explicit user actions with cancellation", () => {
  assert.match(source, /var\(--engine-accent\)/);
  assert.match(source, /pending\.current\?\.abort\(\)/);
  assert.match(source, /onClick=\{\(\) => void run\(false\)\}/);
  assert.match(source, /onClick=\{\(\) => void run\(true\)\}/);
  assert.doesNotMatch(source, /useEffect\([^]*?requestGoogleFontPreparation[^]*?\}, \[/);
});
