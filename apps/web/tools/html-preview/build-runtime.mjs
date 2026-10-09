import { build, version } from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const webRoot = fileURLToPath(new URL("../../", import.meta.url));
const repositoryRoot = path.resolve(webRoot, "../..");
const output = path.join(webRoot, ".tmp/html-preview-runtime");
const result = await build({
  absWorkingDir: webRoot, entryPoints: ["src/domains/production/composition-editor/composition-html-editing-preview-runtime.client.ts"],
  bundle: true, write: false, platform: "browser", format: "iife", globalName: "CourseforgeHtmlPreviewRuntime",
  target: "es2020", minify: true, legalComments: "inline", metafile: true,
});
if (result.outputFiles.length !== 1 || Object.values(result.metafile.outputs).some(item => item.imports.length)) throw new Error("HTML_PREVIEW_BUNDLE_NOT_SELF_CONTAINED");
const bytes = result.outputFiles[0].contents;
if (bytes.length > 512 * 1024) throw new Error("HTML_PREVIEW_BUNDLE_LIMIT");
const inputs = [];
for (const name of Object.keys(result.metafile.inputs).sort()) {
  const absolute = path.resolve(webRoot, name), relative = path.relative(repositoryRoot, absolute).replaceAll("\\", "/");
  if (relative.startsWith("../") || path.isAbsolute(relative)) throw new Error("HTML_PREVIEW_BUILD_INPUT_SCOPE");
  inputs.push({ path: relative, sha256: createHash("sha256").update(await readFile(absolute)).digest("hex") });
}
const manifest = { format: "courseforge-html-preview-runtime-v1", esbuildVersion: version,
  bundleSha256: createHash("sha256").update(bytes).digest("hex"), bundleBytes: bytes.length, inputs };
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "runtime.js"), bytes);
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest));
process.stdout.write(`HTML preview runtime built: ${bytes.length} bytes, ${inputs.length} pinned inputs\n`);
