import assert from "node:assert/strict";
import test from "node:test";
import { fragmentSourceText } from "../course-source-extraction";

test("fragmentación preserva todo el texto y localizadores posteriores al extracto histórico", () => {
  const text = "Contenido con acentos y ejemplos. ".repeat(1000);
  const fragments = fragmentSourceText(text);
  assert.equal(fragments.map(fragment => fragment.text).join(""), text);
  assert.ok(fragments.some(fragment => fragment.locator.characterStart > 12000));
  for (const fragment of fragments) {
    assert.equal(text.slice(fragment.locator.characterStart, fragment.locator.characterEnd), fragment.text);
    assert.match(fragment.sha256, /^[a-f0-9]{64}$/);
  }
});
