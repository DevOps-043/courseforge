import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

// Carga las fuentes reales con fronteras de red/Next simuladas, sin credenciales.
export function load<T>(relative: string, imports: Record<string, unknown> = {}): T {
  const filename = path.resolve(relative);
  const source = ts.transpileModule(readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  const require = createRequire(filename);
  vm.runInNewContext("(function(require,module,exports){" + source + "\n})", { console, TextEncoder, Headers, URL, URLSearchParams, File, Error, DOMException, Response, crypto: globalThis.crypto })(
    (name: string) => Object.hasOwn(imports, name) ? imports[name] : require(name), module, module.exports,
  );
  return module.exports as T;
}
