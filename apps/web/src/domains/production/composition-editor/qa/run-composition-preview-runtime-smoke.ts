import { access, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  captureCompositionQaScreenshot,
  compositionQaDelay,
  launchCompositionQaBrowser,
  type CompositionQaCdpClient,
} from "./composition-qa-browser";
type SmokeFixture = {
  marker: string;
  path: string;
  result: string;
  screenshotPath?: string;
};

const smokeFixtures: readonly SmokeFixture[] = [
  {
    marker: 'data-runtime-patch-smoke="passed"',
    path: ".tmp/composition-preview-qa-interactive/index.html",
    result: "runtimePatchSmoke",
  },
  {
    marker: 'data-transition-runtime-smoke="passed"',
    path: ".tmp/composition-transition-qa-interactive/index.html",
    result: "transitionRuntimeSmoke",
  },
  {
    marker: 'data-caption-runtime-smoke="passed"',
    path: ".tmp/composition-caption-qa-interactive/index.html",
    result: "captionRuntimeSmoke",
    screenshotPath: ".tmp/composition-caption-qa-interactive/caption-karaoke-seek-smoke.png",
  },
];
async function main() {
  const gpuEnabled = process.argv.includes("--gpu");
  const results: Record<string, boolean | number | string> = { gpuEnabled };
  for (const fixture of smokeFixtures) {
    const fixturePath = resolve(process.cwd(), fixture.path);
    await access(fixturePath);
    const metrics = await runSmokeFixture({ fixturePath, gpuEnabled, marker: fixture.marker });
    results.browserPath = metrics.browserPath;
    results[fixture.result] = "passed";
    if (fixture.screenshotPath && metrics.screenshot) {
      await writeFile(resolve(process.cwd(), fixture.screenshotPath), metrics.screenshot);
      results.captionRuntimeScreenshot = fixture.screenshotPath;
    }
    if (metrics.colorPatchDurationMs !== null) {
      results.colorPatchDispatchMs1080p = metrics.colorPatchDurationMs;
    }
    if (metrics.colorRuntimeState) results.colorRuntimeState = metrics.colorRuntimeState;
    if (metrics.smartGuideSmoke) results.smartGuideSmoke = "passed";
  }
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
}

async function runSmokeFixture(params: {
  fixturePath: string;
  gpuEnabled: boolean;
  marker: string;
}) {
  const browser = await launchCompositionQaBrowser({
    gpuEnabled: params.gpuEnabled,
    profilePrefix: "courseforge-preview-smoke-",
  });
  try {
    await browser.client.send("Page.navigate", { url: pathToFileURL(params.fixturePath).href });
    const metrics = await waitForMarker(browser.client, params.marker, params.fixturePath);
    const smartGuideSmoke = params.marker.includes("runtime-patch-smoke")
      ? await runSmartGuideSmoke(browser.client)
      : false;
    const screenshot = params.marker.includes("caption-runtime-smoke")
      ? await captureCompositionQaScreenshot(browser.client)
      : null;
    return { ...metrics, browserPath: browser.browserPath, screenshot, smartGuideSmoke };
  } finally {
    await browser.close();
  }
}

async function runSmartGuideSmoke(client: CompositionQaCdpClient) {
  const target = await evaluateRuntimeValue<{ x: number; y: number } | null>(client, `(() => {
    const candidates = [...document.querySelectorAll("[data-hf-id]")]
      .filter((node) => node instanceof HTMLElement && getComputedStyle(node).visibility !== "hidden")
      .map((node) => ({ node, box: node.getBoundingClientRect() }))
      .filter(({ box }) => box.width > 20 && box.height > 20)
      .sort((left, right) => left.box.width * left.box.height - right.box.width * right.box.height);
    const box = candidates[0]?.box;
    return box ? { x: box.left + box.width / 2, y: box.top + box.height / 2 } : null;
  })()`);
  if (!target) throw new Error("El smoke de guías magnéticas no encontró un elemento visual activo.");
  await client.send("Input.dispatchMouseEvent", { button: "left", buttons: 1, clickCount: 1, type: "mousePressed", x: target.x, y: target.y });
  await client.send("Input.dispatchMouseEvent", { button: "left", buttons: 1, type: "mouseMoved", x: target.x + 3, y: target.y + 2 });
  const guideCount = await evaluateRuntimeValue<number>(client, `document.querySelectorAll(".composition-smart-guide").length`);
  await client.send("Input.dispatchMouseEvent", { button: "left", buttons: 0, clickCount: 1, type: "mouseReleased", x: target.x + 3, y: target.y + 2 });
  const remainingGuideCount = await evaluateRuntimeValue<number>(client, `document.querySelectorAll(".composition-smart-guide").length`);
  if (guideCount < 1) throw new Error("El movimiento no mostró ninguna guía magnética.");
  if (remainingGuideCount !== 0) throw new Error("Las guías magnéticas no se limpiaron al confirmar el movimiento.");
  return true;
}

async function evaluateRuntimeValue<T>(client: CompositionQaCdpClient, expression: string): Promise<T> {
  const evaluation = await client.send("Runtime.evaluate", { expression, returnByValue: true });
  const exceptionDetails = evaluation.exceptionDetails as { exception?: { description?: string }; text?: string } | undefined;
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description || exceptionDetails.text || "Error en smoke interactivo.");
  const result = evaluation.result as { description?: string; value?: T } | undefined;
  if (!result || !("value" in result)) throw new Error(result?.description || "El smoke interactivo no devolvió un valor.");
  return result.value as T;
}

async function waitForMarker(
  client: CompositionQaCdpClient,
  marker: string,
  fixturePath: string,
): Promise<{ colorPatchDurationMs: number | null; colorRuntimeState: string | null }> {
  const match = /^(data-[\w-]+)="([^"]+)"$/.exec(marker);
  if (!match) throw new Error(`Marcador QA inválido: ${marker}`);
  const [, attribute, expected] = match;
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const evaluation = await client.send("Runtime.evaluate", {
      expression: `({ value: document.documentElement?.getAttribute(${JSON.stringify(attribute)}), error: document.documentElement?.getAttribute(${JSON.stringify(`${attribute.replace(/-smoke$/, "")}-error`)}), colorPatchDurationMs: document.documentElement?.dataset?.colorPatchDurationMs || null, colorRuntimeState: document.documentElement?.dataset?.colorRuntimeState || null })`,
      returnByValue: true,
    });
    const runtimeResult = evaluation.result as {
      value?: {
        colorPatchDurationMs?: string | null;
        colorRuntimeState?: string | null;
        error?: string | null;
        value?: string | null;
      };
    } | undefined;
    const state = runtimeResult?.value;
    if (state?.value === expected) {
      const duration = Number(state.colorPatchDurationMs);
      return {
        colorPatchDurationMs: Number.isFinite(duration) ? duration : null,
        colorRuntimeState: state.colorRuntimeState ?? null,
      };
    }
    if (state?.value === "failed") {
      throw new Error(`El fixture ${fixturePath} falló: ${state.error ?? "sin detalle"}`);
    }
    await compositionQaDelay(100);
  }
  throw new Error(`El fixture ${fixturePath} no alcanzó ${marker} dentro del tiempo esperado.`);
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
