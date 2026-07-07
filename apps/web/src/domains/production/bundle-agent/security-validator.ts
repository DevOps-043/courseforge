import JSZip from "jszip";
import { validateRemotionBundle, type ValidationReport } from "../validation/bundle-validator";

const FORBIDDEN_IMPORTS = new Set([
  "fs",
  "node:fs",
  "path",
  "node:path",
  "child_process",
  "node:child_process",
  "process",
  "node:process",
  "os",
  "node:os",
  "net",
  "node:net",
  "tls",
  "node:tls",
  "http",
  "node:http",
  "https",
  "node:https",
]);

const FORBIDDEN_CODE_PATTERNS: Array<[RegExp, string]> = [
  [/\beval\s*\(/, "eval"],
  [/\bnew\s+Function\s*\(/, "new Function"],
  [/\bFunction\s*\(/, "Function constructor"],
  [/\bfetch\s*\(/, "fetch"],
  [/\bXMLHttpRequest\b/, "XMLHttpRequest"],
  [/\bWebSocket\b/, "WebSocket"],
  [/\bprocess\./, "process"],
  [/\bsetInterval\s*\(/, "setInterval"],
  [/\bsetTimeout\s*\(/, "setTimeout"],
  [/\bimport\s*\(/, "dynamic import"],
  [/\brequire\s*\(/, "require"],
];

const REMOTE_URL_PATTERN = /https?:\/\//i;

function getExtension(name: string) {
  const dotIndex = name.toLowerCase().lastIndexOf(".");
  return dotIndex === -1 ? "" : name.toLowerCase().slice(dotIndex);
}

function parseStaticImports(source: string): string[] {
  const imports = new Set<string>();
  const importRegex = /\bimport\s+(?:[^'"]+\s+from\s+)?["']([^"']+)["']/g;
  const exportRegex = /\bexport\s+[^'"]+\s+from\s+["']([^"']+)["']/g;
  let match: RegExpExecArray | null;

  while ((match = importRegex.exec(source))) {
    imports.add(match[1]);
  }

  while ((match = exportRegex.exec(source))) {
    imports.add(match[1]);
  }

  return Array.from(imports);
}

function mergeValidationReport(base: ValidationReport, extraErrors: string[], extraWarnings: string[]): ValidationReport {
  const errors = [...base.errors, ...extraErrors];
  return {
    ...base,
    isValid: errors.length === 0,
    errors,
    warnings: [...base.warnings, ...extraWarnings],
  };
}

export async function validateGeneratedRemotionBundle(
  buffer: ArrayBuffer,
  fileName: string,
): Promise<ValidationReport> {
  const baseReport = await validateRemotionBundle(buffer, fileName);
  const errors: string[] = [];
  const warnings: string[] = [];
  const zip = new JSZip();
  const contents = await zip.loadAsync(buffer);

  for (const [name, file] of Object.entries(contents.files)) {
    if (file.dir) continue;

    const extension = getExtension(name);
    if (![".ts", ".tsx", ".js", ".jsx", ".css", ".json"].includes(extension)) {
      continue;
    }

    const text = await file.async("text");
    if ((extension === ".ts" || extension === ".tsx" || extension === ".js" || extension === ".jsx") && REMOTE_URL_PATTERN.test(text)) {
      errors.push(`Codigo generado contiene URL remota no permitida: ${name}`);
    }

    if (extension === ".css" && REMOTE_URL_PATTERN.test(text)) {
      errors.push(`CSS generado contiene URL remota no permitida: ${name}`);
    }

    for (const importPath of parseStaticImports(text)) {
      const rootImport = importPath.startsWith("@") ? importPath.split("/").slice(0, 2).join("/") : importPath.split("/")[0];
      if (FORBIDDEN_IMPORTS.has(rootImport) || FORBIDDEN_IMPORTS.has(importPath)) {
        errors.push(`Import no permitido en bundle generado (${importPath}): ${name}`);
      }
    }

    for (const [pattern, label] of FORBIDDEN_CODE_PATTERNS) {
      if (pattern.test(text)) {
        errors.push(`Uso no permitido de ${label} en bundle generado: ${name}`);
      }
    }
  }

  const manifest = baseReport.info.manifest;
  if (manifest) {
    if ((manifest.defaultDurationFrames || 0) > 900) {
      errors.push("defaultDurationFrames supera el maximo permitido para bundles generados por SofLIA.");
    }
    if ((manifest.fps || 0) > 60) {
      errors.push("fps supera el maximo permitido para bundles generados por SofLIA.");
    }
    if (JSON.stringify(manifest.defaultProps || {}).length > 16_384) {
      errors.push("defaultProps supera el tamano maximo permitido para bundles generados por SofLIA.");
    }
    if (manifest.propsSchema && manifest.propsSchema.type !== "object") {
      errors.push("propsSchema debe ser un JSON Schema simple de tipo object.");
    }
  }

  return mergeValidationReport(baseReport, errors, warnings);
}
