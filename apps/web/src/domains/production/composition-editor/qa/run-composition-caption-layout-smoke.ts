import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCaptionEffectsFixture } from "../__tests__/composition-caption-effects.fixtures";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS, readCompositionAnimationRuntime } from "../composition-preview-compiler.service";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { captureCompositionQaScreenshot, launchCompositionQaBrowser, compositionQaDelay, type CompositionQaCdpClient } from "./composition-qa-browser";

async function evaluate<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const response = await client.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (response.exceptionDetails) throw new Error(JSON.stringify(response.exceptionDetails));
  return (response.result as { value: T }).value;
}

async function main() {
  const output = resolve(".tmp/composition-caption-layout-qa");
  await mkdir(join(output, "assets"), { recursive: true });
  await writeFile(join(output, "assets/gsap.min.js"), await readCompositionAnimationRuntime());
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-caption-layout-" });
  const reports: unknown[] = [];
  try {
    await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 500, deviceScaleFactor: 1, mobile: false });
    for (const effectsEnabled of [false, true]) {
      const document = createCaptionEffectsFixture();
      document.canvas.width = 1200; document.canvas.height = 500;
      const clip = document.clips[0]!;
      assert.ok(clip.source.type === "NATIVE_CAPTIONS");
      if (!effectsEnabled) delete clip.source.effects;
      else clip.source.effects!.pulse = false;
      clip.layout = { ...clip.layout, x: 40, y: 100, width: 1000, height: 280 };
      clip.source.style = { ...clip.source.style, fontSize: 32, fontFamily: "Arial", paddingX: 24, paddingY: 12 };
      const words = ["Este", "diálogo", "debe", "leerse", "horizontalmente."];
      const text = words.join(" ");
      clip.source.cues = [{ id: "paragraph", text, startSeconds: 0, endSeconds: 4,
        words: words.map((word, index) => ({ id: `word-${index}`, text: word, startSeconds: index * 0.5, endSeconds: (index + 1) * 0.5 })) }];
      const validated = compositionEditorDocumentSchema.parse(document);
      let previewGeometry: unknown;
      for (const target of [COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW, COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER]) {
        const file = join(output, `${target}-${effectsEnabled}.html`);
        await writeFile(file, await compileCompositionPreview({ document: validated, assetUrls: new Map(), target }));
        await browser.client.send("Page.navigate", { url: pathToFileURL(file).href });
        const deadline = Date.now() + 10_000;
        while (!await evaluate(browser.client, `Boolean(window.__timelines?.["courseforge-composition"])`)) {
          if (Date.now() > deadline) throw new Error("No se inició el timeline de captions.");
          await compositionQaDelay(50);
        }
        await evaluate(browser.client, `window.__timelines["courseforge-composition"].time(1.9,true); true`);
        const selector = effectsEnabled ? '[id*="-part-"]' : ".composition-caption-word";
        const geometryExpression = `(() => {
          const cue = document.querySelector('.composition-caption-cue');
          const words = [...cue.querySelectorAll(${JSON.stringify(selector)})].filter(node => node.textContent.trim());
          return {text: cue.textContent, words: words.map(node => { const box=node.getBoundingClientRect(); return {text:node.textContent,x:box.x,y:box.y,width:box.width,height:box.height,opacity:getComputedStyle(node).opacity}; })}; })()`;
        const wide = await evaluate<{ text: string; words: Array<{ text: string; x: number; y: number; opacity: string }> }>(browser.client, geometryExpression);
        assert.equal(wide.text, text);
        assert.equal(wide.words.length, words.length);
        assert.equal(new Set(wide.words.map(word => Math.round(word.y))).size, 1, "El diálogo ancho debe quedar en una sola línea.");
        assert.ok(wide.words.every((word, index) => index === 0 || word.x > wide.words[index - 1]!.x), "Las palabras deben avanzar horizontalmente.");
        if (target === COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW) previewGeometry = wide;
        else assert.deepEqual(wide, previewGeometry, "Preview y render deben tener las mismas posiciones y resaltado.");
        // Redimensionamiento real del contenedor: no se reconstruyen ni reposicionan palabras.
        await evaluate(browser.client, `document.querySelector('[data-hf-id]').style.width='360px'; true`);
        const narrow = await evaluate<typeof wide>(browser.client, geometryExpression);
        const lines = new Set(narrow.words.map(word => Math.round(word.y))).size;
        assert.ok(lines > 1 && lines < words.length, "El caption estrecho debe formar líneas de párrafo.");
        await evaluate(browser.client, `document.querySelector('[data-hf-id]').style.width='1000px'; window.__timelines["courseforge-composition"].time(1.1,true); true`);
        const earlier = await evaluate<typeof wide>(browser.client, geometryExpression);
        assert.equal(earlier.words[0]!.opacity, "1");
        assert.equal(earlier.words[1]!.opacity, "0.55");
        await evaluate(browser.client, `window.__timelines["courseforge-composition"].time(1.9,true); true`);
        assert.deepEqual(await evaluate(browser.client, geometryExpression), wide, "Resize y seek inverso deben restaurar el mismo párrafo.");
        await writeFile(join(output, `${target}-${effectsEnabled}.png`), await captureCompositionQaScreenshot(browser.client));
        reports.push({ target, effectsEnabled, wide, narrowLines: lines, resizeAndReverseSeek: "PASS" });
      }
    }
    await writeFile(join(output, "report.json"), JSON.stringify(reports, null, 2));
    process.stdout.write("OK: captions en párrafo, ajuste de líneas, resize, karaoke y seek inverso; paridad preview/render.\n");
  } finally { await browser.close(); }
}

void main().catch(error => { process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`); process.exitCode = 1; });
