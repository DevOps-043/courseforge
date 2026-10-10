import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { compositionQaDelay, launchCompositionQaBrowser } from "./composition-qa-browser";

async function main() {
  const directory = resolve(".tmp/composition-toolbar-layout-qa");
  await mkdir(directory, { recursive: true });
  await build({ bundle: true, entryPoints: [resolve("src/domains/production/composition-editor/qa/composition-toolbar-layout.fixture.tsx")],
    outfile: resolve(directory, "fixture.js"), format: "iife", platform: "browser", jsx: "automatic",
    tsconfig: resolve("tsconfig.json"), target: "chrome120", logLevel: "silent" });
  const htmlPath = resolve(directory, "index.html");
  await writeFile(htmlPath, '<!doctype html><html><head><link rel="stylesheet" href="fixture.css"><style>*{box-sizing:border-box}body{margin:0}button,select{font:inherit}</style></head><body><div id="root"></div><script src="fixture.js"></script></body></html>');
  const browser = await launchCompositionQaBrowser({ profilePrefix: "courseforge-toolbar-qa-" });
  const evaluate = async (expression: string) => {
    const result = await browser.client.send("Runtime.evaluate", { expression, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return (result.result as { value: unknown }).value;
  };
  const click = async (label: string) => {
    await evaluate(`[...document.querySelectorAll('[aria-label="${label}"]')].find(element => element.getClientRects().length)?.click()`);
    await compositionQaDelay(150);
  };
  try {
    await browser.client.send("Page.navigate", { url: pathToFileURL(htmlPath).href });
    for (let attempt = 0; attempt < 50 && !await evaluate("Boolean(document.querySelector('[data-preview]'))"); attempt++) await compositionQaDelay(100);
    for (const width of [1365, 1280, 1100, 1024, 768, 390]) {
      await browser.client.send("Emulation.setDeviceMetricsOverride", { width, height: 768, deviceScaleFactor: 1, mobile: false });
      for (const inspectorOpen of [false, true]) {
        if (inspectorOpen) await click("Abrir inspector");
        await compositionQaDelay(150);
        const layoutValid = await evaluate(`(() => {
          const panel = document.querySelector('[data-preview]').getBoundingClientRect();
          const controls = [...document.querySelectorAll('[data-preview] button, [data-preview] select')]
            .filter(el => el.getClientRects().length).map(el => el.getBoundingClientRect());
          const toolbar = document.querySelector('[data-preview]').firstElementChild.getBoundingClientRect();
          return toolbar.height <= 52 && controls.length >= 7 && controls.every(rect => rect.left >= panel.left && rect.right <= panel.right)
            && controls.every((rect, i) => controls.slice(i + 1).every(other =>
              Math.min(rect.right, other.right) - Math.max(rect.left, other.left) <= 1 ||
              Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) <= 1));
        })()`);
        if (!layoutValid) throw new Error(`Toolbar overflow or overlap: ${width}, inspector=${inspectorOpen}`);
        await evaluate("document.querySelector('[aria-haspopup=menu]').focus(); document.querySelector('[aria-haspopup=menu]').click()");
        await compositionQaDelay(150);
        const menuValid = await evaluate(`(() => {
          const menu = document.querySelector('[role=menu]'); const bounds = menu?.getBoundingClientRect();
          return menu?.matches(':popover-open') && bounds.left >= 0 && bounds.right <= innerWidth
            && bounds.top >= 0 && bounds.bottom <= innerHeight
            && menu.contains(document.activeElement)
            && [...menu.querySelectorAll('button')].filter(button => button.getClientRects().length).every(button => {
              button.scrollIntoView({block: 'nearest'});
              const rect = button.getBoundingClientRect();
              return menu.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
            });
        })()`);
        if (!menuValid) throw new Error(`Menu clipped or inaccessible: ${width}, inspector=${inspectorOpen}`);
        await browser.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape" });
        await compositionQaDelay(100);
        if (await evaluate("Boolean(document.querySelector('[role=menu]'))")) throw new Error("Escape failed to close tools");
        if (!await evaluate("document.activeElement?.getAttribute('aria-haspopup') === 'menu'")) throw new Error("Tools trigger did not recover focus");
        if (!await evaluate("[...document.querySelectorAll('[aria-label=\"Abrir historial de edición\"]')].some(element => element.getClientRects().length)")) {
          await evaluate("document.querySelector('[aria-haspopup=menu]').click()");
          await compositionQaDelay(100);
        }
        await click("Abrir historial de edición");
        if (!await evaluate("document.querySelector('[aria-label=\"Historial de edición\"]')?.matches(':popover-open')")) throw new Error("History not in top layer");
        await click("Cerrar historial");
        if (inspectorOpen) await click("Cerrar inspector");
      }
    }
    await browser.client.send("Emulation.setDeviceMetricsOverride", { width: 1365, height: 768, deviceScaleFactor: 1, mobile: false });
    await compositionQaDelay(150);
    await evaluate("document.querySelector('[aria-haspopup=menu]').click()");
    await compositionQaDelay(100);
    await browser.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ArrowDown", code: "ArrowDown" });
    if (!await evaluate("document.activeElement === document.querySelectorAll('[role=menu] button')[1]")) throw new Error("Tools arrow navigation failed");
    await click("Abrir inspector");
    if (!await evaluate("!document.querySelector('[role=menu]')")) {
      // Programmatic clicks bypass pointerdown; verify reanchoring during layout changes.
      const anchored = await evaluate(`(() => {
        const trigger = document.querySelector('[aria-haspopup=menu]').getBoundingClientRect();
        const menu = document.querySelector('[role=menu]').getBoundingClientRect();
        return Math.abs(menu.top - trigger.bottom - 8) < 2;
      })()`);
      if (!anchored) throw new Error("Tools did not reanchor when inspector opened");
    }
    await browser.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 20, y: 20, button: "left", clickCount: 1 });
    await browser.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 20, y: 20, button: "left", clickCount: 1 });
    await compositionQaDelay(100);
    if (await evaluate("Boolean(document.querySelector('[role=menu]'))")) throw new Error("Outside pointer failed to close tools");
    process.stdout.write("Single-row toolbar (<=52px), tools visibility, keyboard dismissal and history: passed at 6 widths, with inspector open and closed.\n");
  } finally { await browser.close(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
