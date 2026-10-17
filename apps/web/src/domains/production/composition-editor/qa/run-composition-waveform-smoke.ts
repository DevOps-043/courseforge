import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compositionQaDelay, launchCompositionQaBrowser, type CompositionQaCdpClient } from "./composition-qa-browser";

async function main() {
  const workspaceRoot = process.cwd();
  const outputDirectory = resolve(workspaceRoot, ".tmp/composition-waveform-qa");
  const bundlePath = resolve(outputDirectory, "fixture.js");
  const htmlPath = resolve(outputDirectory, "index.html");
  await mkdir(outputDirectory, { recursive: true });
  await build({
    bundle: true,
    entryPoints: [resolve(workspaceRoot, "src/domains/production/composition-editor/qa/composition-waveform-smoke.fixture.tsx")],
    format: "iife",
    logLevel: "silent",
    outfile: bundlePath,
    platform: "browser",
    target: ["chrome120"],
    tsconfig: resolve(workspaceRoot, "tsconfig.json"),
  });
  await writeFile(htmlPath, "<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\"><title>Waveform smoke</title><style>#audio-clip>span{position:absolute;left:8px;right:8px;top:12px;bottom:4px;display:block}#audio-clip svg{width:100%;height:100%}</style></head><body><div id=\"root\"></div><script src=\"./fixture.js\"></script></body></html>", "utf8");

  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-waveform-smoke-" });
  try {
    await browser.client.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    await waitFor(browser.client, "Boolean(document.querySelector('#audio-clip svg path')?.getAttribute('d'))");
    const originalPath = await evaluate<string>(browser.client, "document.querySelector('#audio-clip svg path').getAttribute('d')");
    await evaluate(browser.client, "document.querySelector('#trim').click()");
    await waitFor(browser.client, `document.querySelector('#audio-clip svg path')?.getAttribute('d') !== ${JSON.stringify(originalPath)}`);
    const trimmedPath = await evaluate<string>(browser.client, "document.querySelector('#audio-clip svg path').getAttribute('d')");
    if (!trimmedPath.includes("V100.0")) throw new Error("El trim perdió el pico del archivo.");

    const originalViewBox = await evaluate<string>(browser.client, "document.querySelector('#audio-clip svg').getAttribute('viewBox')");
    await evaluate(browser.client, "document.querySelector('#zoom').click()");
    await waitFor(browser.client, `document.querySelector('#audio-clip svg')?.getAttribute('viewBox') !== ${JSON.stringify(originalViewBox)}`);
    const zoomedViewBox = await evaluate<string>(browser.client, "document.querySelector('#audio-clip svg').getAttribute('viewBox')");
    process.stdout.write(`${JSON.stringify({
      browserPath: browser.browserPath,
      initialRender: "passed",
      peakAfterTrim: "passed",
      resizedViewBox: zoomedViewBox,
    }, null, 2)}\n`);
  } finally {
    await browser.close();
  }
}

async function waitFor(client: CompositionQaCdpClient, expression: string) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await evaluate<boolean>(client, expression)) return;
    await compositionQaDelay(50);
  }
  throw new Error(`El smoke de waveform no completó: ${expression}`);
}

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const result = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  const exception = result.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
  if (exception) throw new Error(exception.exception?.description || exception.text || "Falló una evaluación CDP.");
  return (result.result as { value?: T } | undefined)?.value as T;
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
