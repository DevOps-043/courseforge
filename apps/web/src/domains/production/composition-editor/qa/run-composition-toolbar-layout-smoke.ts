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
        if (!layoutValid) throw new Error(`Toolbar overflow or overlap: ${width}, inspector=${inspectorOpen}; ${JSON.stringify(await evaluate(`(() => {
          const bounds = element => { const rect=element.getBoundingClientRect();return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}; };
          return {panel:bounds(document.querySelector('[data-preview]')),controls:[...document.querySelectorAll('[data-preview] button,[data-preview] select')].filter(el=>el.getClientRects().length).map(el=>({label:el.getAttribute('aria-label')||el.textContent,...bounds(el)}))};
        })()`))}`);
        const guidesVisible = await evaluate(`(() => {
          const button = document.querySelector('button[aria-label="Guías personalizables"]');
          const label = [...button.querySelectorAll('span')].find(node => node.textContent === 'Guías');
          return button.getClientRects().length > 0 && label.getClientRects().length > 0 && button.getAttribute('aria-expanded') === 'false';
        })()`);
        if (!guidesVisible) throw new Error(`Guías sin texto visible: ${width}, inspector=${inspectorOpen}`);
        await evaluate(`(() => {const button=document.querySelector('button[aria-label="Guías personalizables"]');button.focus();button.click();})()`);
        await compositionQaDelay(150);
        if (!await evaluate(`(() => {
          const button = document.querySelector('button[aria-label="Guías personalizables"]');
          const panel = document.getElementById(button.getAttribute('aria-controls'));
          return button.getAttribute('aria-expanded') === 'true' && panel?.contains(document.activeElement);
        })()`)) throw new Error("Guías no abrió el panel enlazado o no recibió foco");
        await evaluate(`[...document.querySelectorAll('button')].find(button=>button.textContent === 'Añadir vertical').click()`);
        await compositionQaDelay(100);
        if (!await evaluate(`document.querySelectorAll('input[type="color"]').length === 1`)) throw new Error("No se pudo crear una guía desde el acceso visible");
        await evaluate(`document.querySelector('[aria-label="Líneas de referencia"]').dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))`);
        await compositionQaDelay(100);
        if (!await evaluate(`!document.querySelector('[aria-label="Líneas de referencia"]') && document.activeElement?.getAttribute('aria-label') === 'Guías personalizables'`)) throw new Error("Escape no cerró guías o no devolvió foco");
        await click("Guías personalizables");
        if (!await evaluate(`document.querySelectorAll('input[type="color"]').length === 1`)) throw new Error("Cerrar guías perdió su configuración");
        await evaluate(`document.querySelector('[aria-label="Eliminar guía 1"]').click()`);
        await click("Guías personalizables");
        if (await evaluate(`Boolean(document.querySelector('[aria-label="Líneas de referencia"]'))`)) throw new Error("El botón Guías no cerró el panel");
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
    for (const viewport of [{ width: 1365, height: 768 }, { width: 390, height: 420 }]) {
      await browser.client.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => {
        const trigger = document.querySelector('[aria-haspopup="dialog"]');
        trigger.focus(); trigger.click();
      })()`);
      await compositionQaDelay(260);
      if (!await evaluate(`(() => {
        const dialog = document.querySelector("dialog:modal");
        if (!dialog) return false;
        const bounds = dialog.getBoundingClientRect();
        const close = dialog.querySelector('button').getBoundingClientRect();
        const list = dialog.querySelectorAll('button')[1].parentElement.parentElement;
        return bounds.left >= 0 && bounds.right <= innerWidth && bounds.top >= 0 && bounds.bottom <= innerHeight
          && list.scrollHeight > list.clientHeight
          && dialog.contains(document.activeElement)
          && dialog.contains(document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2));
      })()`)) throw new Error("El historial de Entrega quedó recortado o detrás del editor.");
      if (viewport.width === 1365) {
        await browser.client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await browser.client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      } else {
        await browser.client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: 4, y: 4, button: "left", clickCount: 1 });
        await browser.client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 4, y: 4, button: "left", clickCount: 1 });
      }
      await compositionQaDelay(100);
      if (!await evaluate("!document.querySelector('dialog:modal') && document.activeElement?.getAttribute('aria-haspopup') === 'dialog'")) {
        throw new Error(`Cerrar versiones no devolvió el foco a Entrega (${viewport.width}px). ${await evaluate("JSON.stringify({ open: Boolean(document.querySelector('dialog:modal')), focus: document.activeElement?.tagName })")}`);
      }
    }
    process.stdout.write("Historial de Entrega visible sobre el editor y cierre con foco restaurado en dos tamaños de viewport.\n");
    process.stdout.write("Barra sin solapes (<=52px), Guías con texto visible, apertura/creación/cierre sin pérdida, foco/Escape y menú/historial: aprobado en 6 anchos, con inspector abierto y cerrado.\n");
  } finally { await browser.close(); }
}

void main().catch((error) => { console.error(error); process.exitCode = 1; });
