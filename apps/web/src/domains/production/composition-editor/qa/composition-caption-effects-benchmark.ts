import { performance } from "node:perf_hooks";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createCaptionEffectsFixture } from "../__tests__/composition-caption-effects.fixtures";
import { compositionEditorDocumentSchema } from "../composition-document.types";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "../composition-preview-compiler.service";
import { buildCaptionEffectPlan } from "../composition-caption-effects-plan";
import { launchCompositionQaBrowser, compositionQaDelay } from "./composition-qa-browser";

/** At the runtime limit: 100 phrases / 2,000 timed words; no remote media or provider calls. */
export async function benchmarkCaptionEffects(outputDirectory: string) {
  const document = createCaptionEffectsFixture();
  const clip = document.clips[0]!;
  if (clip.source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions");
  document.canvas.durationSeconds = 201;
  clip.durationSeconds = 200;
  clip.source.cues = Array.from({ length: 100 }, (_, index) => ({
    id: `benchmark-${index}`, text: Array.from({ length: 20 }, (_, word) => `w${word}`).join(" "),
    startSeconds: index * 2, endSeconds: (index + 1) * 2,
    words: Array.from({ length: 20 }, (_, word) => ({ id: `word-${word}`, text: `w${word}`,
      startSeconds: index * 2 + word / 10, endSeconds: index * 2 + (word + 1) / 10 })),
  }));
  const validated = compositionEditorDocumentSchema.parse(document);
  const compileStart = performance.now();
  const html = await compileCompositionPreview({ document: validated, assetUrls: new Map(), target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER });
  const compileMs = performance.now() - compileStart;
  const path = join(outputDirectory, "benchmark.html");
  await writeFile(path, html);
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-caption-benchmark-" });
  try {
    const initializationStart = performance.now();
    await browser.client.send("Page.navigate", { url: pathToFileURL(path).href });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const state = await browser.client.send("Runtime.evaluate", { returnByValue: true, expression: `Boolean(window.__timelines?.["courseforge-composition"])` });
      if ((state.result as { value?: unknown } | undefined)?.value === true) { ready = true; break; }
      await compositionQaDelay(50);
    }
    if (!ready) throw new Error("CAPTION_BENCHMARK_INIT_FAILED");
    const initializationMs = performance.now() - initializationStart;
    const result = await browser.client.send("Runtime.evaluate", { returnByValue: true, expression: `(() => {
      const durations = [];
      for (const seconds of [1.6,100.6,190.6,100.6,1.6]) {
        const started = performance.now();
        window.__timelines["courseforge-composition"].time(seconds,true);
        document.body.getBoundingClientRect();
        durations.push(performance.now()-started);
      }
      return durations;
    })()` });
    const seekMs = (result.result as { value?: unknown } | undefined)?.value;
    if (result.exceptionDetails || !Array.isArray(seekMs)) throw new Error("CAPTION_BENCHMARK_SEEK_FAILED");
    return { cues: 100, timedWords: 2000, targets: new Set(buildCaptionEffectPlan(validated).map((step) => step.targetId)).size,
      documentBytes: Buffer.byteLength(JSON.stringify(validated)), htmlBytes: Buffer.byteLength(html), compileMs, initializationMs, seekMs };
  } finally { await browser.close(); }
}
