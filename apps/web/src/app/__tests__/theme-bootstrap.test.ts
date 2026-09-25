import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { THEME_BOOTSTRAP_SCRIPT } from "../theme-bootstrap";

function bootstrap(stored: string | null, systemDark: boolean, blockedStorage = false) {
  const classes = new Set(["font-ready", "light"]);
  const style = { colorScheme: "" };
  runInNewContext(THEME_BOOTSTRAP_SCRIPT, {
    document: { documentElement: { style, classList: {
      remove: (...names: string[]) => names.forEach((name) => classes.delete(name)),
      add: (name: string) => classes.add(name),
    } } },
    localStorage: { getItem: () => {
      if (blockedStorage) throw new Error("Storage unavailable");
      return stored;
    } },
    window: { matchMedia: () => ({ matches: systemDark }) },
  });
  return { classes, style };
}

test("honors saved appearance without removing unrelated root classes", () => {
  const { classes, style } = bootstrap("dark", false);
  assert.deepEqual([...classes], ["font-ready", "dark"]);
  assert.equal(style.colorScheme, "dark");
  assert.equal(bootstrap("light", true).style.colorScheme, "light");
});

test("uses the system preference for unset and system themes", () => {
  assert.equal(bootstrap(null, true).style.colorScheme, "dark");
  assert.equal(bootstrap("system", false).style.colorScheme, "light");
});

test("initializes appearance when browser storage is unavailable", () => {
  assert.equal(bootstrap(null, true, true).style.colorScheme, "dark");
});
