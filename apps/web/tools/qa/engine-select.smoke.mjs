import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const webRoot = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(webRoot, "package.json"));
const runtimeModules = process.argv[2];
const { chromium } = await import(runtimeModules
  ? pathToFileURL(path.join(runtimeModules, "playwright/index.mjs")).href
  : "playwright");
const output = path.join(webRoot, ".tmp/engine-select-qa");
await mkdir(output, { recursive: true });
const bundle = await build({
  stdin: {
    contents: `
      import { useState } from "react";
      import { createRoot } from "react-dom/client";
      import { Film } from "lucide-react";
      import { EngineDialog } from "./src/components/ui/EngineDialog";
      import { EngineSelect } from "./src/components/ui/EngineSelect";
      import { VideoDurationPolicyFields, createDefaultVideoDurationPolicy } from "./src/domains/artifacts/components/VideoDurationPolicyFields";

      const options = [
        { value: "espera", label: "Pendiente", disabled: true, group: "Incluidas" },
        { value: "basica", label: "Básica", group: "Incluidas" },
        ...Array.from({ length: 15 }, (_, index) => ({
          value: String(index), label: "Opción " + index, group: "Organización",
        })),
      ];

      function Fixture() {
        const [policy, setPolicy] = useState(createDefaultVideoDurationPolicy);
        const [value, setValue] = useState("basica");
        const [isOpen, setOpen] = useState(false);
        return <div className="soflia-engine-shell">
          <span data-theme-probe aria-hidden="true" className="hidden bg-white dark:bg-black" />
          <main className="engine-content mx-auto mt-8 max-w-2xl px-4">
            <form className="space-y-5 rounded-2xl bg-[var(--engine-surface)] p-5 shadow-sm" onSubmit={event => event.preventDefault()}>
              <VideoDurationPolicyFields value={policy} onChange={setPolicy} />
              <button type="button" className="engine-button engine-button--secondary" onClick={() => setOpen(true)}>Abrir ajustes</button>
            </form>
            <EngineDialog title="Ajustes de prueba" icon={<Film />} isOpen={isOpen} onClose={() => setOpen(false)}>
              <div style={{ maxHeight: 72, overflow: "hidden" }}>
                <label>Opciones agrupadas
                  <EngineSelect size="compact" aria-label="Opciones agrupadas" value={value} options={options} onValueChange={setValue} />
                </label>
              </div>
              <button type="button">Siguiente campo</button>
            </EngineDialog>
          </main>
          <div className="fixed right-3 bottom-2 w-44">
            <EngineSelect aria-label="Campo inferior" size="compact" value={value} options={options} onValueChange={setValue} />
          </div>
        </div>;
      }

      createRoot(document.getElementById("root")).render(<Fixture />);
    `,
    resolveDir: webRoot,
    loader: "tsx",
  },
  tsconfig: path.join(webRoot, "tsconfig.json"),
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
  jsx: "automatic",
  outfile: path.join(output, "fixture.js"),
});
const globalsPath = path.join(webRoot, "src/app/globals.css");
const globals = await readFile(globalsPath, "utf8");
const tailwind = await require("postcss")([require("@tailwindcss/postcss")()]).process(
  globals.replace('@import "tailwindcss";', '@import "tailwindcss" source(none);') +
    '\n@source "../domains/artifacts/components/VideoDurationPolicyFields.tsx";' +
    '\n@source "../../tools/qa/engine-select.smoke.mjs";' +
    '\n:root{--font-newsreader:Georgia;--font-inter-tight:Arial;--font-ibm-plex:Arial}',
  { from: globalsPath },
);
const stylesheet = tailwind.css + bundle.outputFiles.find(file => file.path.endsWith(".css")).text;
const javascript = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const browser = await chromium.launch({ channel: "chrome", headless: true });

try {
  for (const theme of ["light", "dark"]) {
    for (const viewport of [{ width: 1365, height: 768 }, { width: 390, height: 650 }]) {
      const touch = viewport.width < 400;
      const page = await browser.newPage({
        viewport,
        hasTouch: touch,
        reducedMotion: "reduce",
        colorScheme: theme === "light" ? "dark" : "light",
      });
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.route("http://courseforge.test/", route => route.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html lang="es" class="${theme === "dark" ? "dark" : ""}">
          <meta charset="utf-8"><style>${stylesheet}</style><body><div id="root"></div></body></html>`,
      }));
      await page.goto("http://courseforge.test/");
      await page.addScriptTag({ content: javascript });
      const duration = page.getByRole("combobox", { name: "Perfil de duración por video" });
      const listbox = page.getByRole("listbox");
      const choose = locator => touch ? locator.tap() : locator.click();

      assert.equal(
        await page.locator("[data-theme-probe]").evaluate(element => getComputedStyle(element).backgroundColor),
        theme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)",
      );
      assert.match(await duration.innerText(), /Taller/);
      await choose(duration);
      await listbox.waitFor();
      await assertListboxBounds(listbox, viewport);
      assert.equal(await listbox.getByRole("option", { selected: true }).innerText(), "Taller (6–8 min)");
      await page.locator("main").screenshot({ path: path.join(output, `duracion-${theme}-${viewport.width}.png`) });
      await choose(listbox.getByRole("option", { name: "Profundo (8–10 min)" }));
      assert.match(await duration.innerText(), /Profundo/);
      const target = page.getByRole("spinbutton", { name: "Objetivo" });
      assert.equal(await target.inputValue(), "9");
      await target.fill("9.5");
      assert.match(await duration.innerText(), /Personalizado/);

      await duration.press("End");
      assert.equal(await listbox.getByRole("option", { selected: true }).innerText(), "Personalizado");
      await page.keyboard.press("Home");
      await page.keyboard.press("Enter");
      assert.equal(await target.inputValue(), "4");

      await page.getByRole("button", { name: "Abrir ajustes" }).click();
      const dialog = page.getByRole("dialog");
      const grouped = dialog.getByRole("combobox", { name: "Opciones agrupadas" });
      await grouped.press("Enter");
      await assertListboxBounds(listbox, viewport);
      assert.equal(await listbox.evaluate(element => element.matches(":popover-open")), true);
      assert.equal(await listbox.getByRole("group", { name: "Incluidas" }).getByRole("option", { name: "Pendiente" }).getAttribute("aria-disabled"), "true");
      await page.keyboard.press("Home");
      assert.equal(await activeOption(grouped), "Básica");
      await page.keyboard.press("O");
      await page.keyboard.press("p");
      assert.equal(await activeOption(grouped), "Opción 0");
      await page.keyboard.press("End");
      assert.equal(await activeOption(grouped), "Opción 14");
      assert.equal(await listbox.evaluate(element => element.scrollTop > 0), true);
      await page.keyboard.press("Escape");
      assert.equal(await listbox.count(), 0);
      assert.equal(await dialog.count(), 1);
      assert.match(await grouped.innerText(), /Básica/);
      await grouped.press("Enter");
      await page.keyboard.press("Tab");
      assert.equal(await listbox.count(), 0);
      assert.equal(await page.getByRole("button", { name: "Siguiente campo" }).evaluate(element => element === document.activeElement), true);
      await grouped.press("Enter");
      await choose(listbox.getByRole("option", { name: "Opción 1", exact: true }));
      assert.equal(await grouped.innerText(), "Opción 1");
      await grouped.press("Enter");
      await page.getByRole("heading", { name: "Ajustes de prueba" }).click();
      assert.equal(await listbox.count(), 0);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      const bottomSelect = page.getByRole("combobox", { name: "Campo inferior" });
      await choose(bottomSelect);
      await assertListboxBounds(listbox, viewport);
      const menuBounds = await listbox.boundingBox();
      const anchorBounds = await bottomSelect.boundingBox();
      assert.ok(menuBounds.y + menuBounds.height < anchorBounds.y);
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Space");
      assert.equal(await bottomSelect.innerText(), "Opción 2");
      assert.deepEqual(errors, []);
      console.log(`Selector validado en tema ${theme === "light" ? "claro" : "oscuro"} a ${viewport.width} px.`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}

async function assertListboxBounds(listbox, viewport) {
  const bounds = await listbox.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.y >= 0);
  assert.ok(bounds.x + bounds.width <= viewport.width && bounds.y + bounds.height <= viewport.height);
  const visible = await listbox.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + 10));
  });
  assert.equal(visible, true);
}

async function activeOption(trigger) {
  return trigger.evaluate(element => document.getElementById(element.getAttribute("aria-activedescendant")).textContent.trim());
}
