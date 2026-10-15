import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildDeckTextPlan, deckTextPlanSchema, hashDeckTextPlan, validateDeckTextPlan } from "../composition-deck-text-plan";
import { buildDeckConformanceCorpusCase, DECK_CONFORMANCE_CORPUS_RECIPES } from "../qa/composition-deck-conformance-corpus";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function documentWithHtml(html: string) {
  const document = buildDeckConformanceCorpusCase("deck-basic", 25).document;
  const source = document.clips[0]!.source;
  if (source.type !== "DECK_SLIDE") throw new Error("Expected deck");
  source.html = html;
  return document;
}

test("source paths preserve mixed text, entities, whitespace offsets and exact Unicode without relying on IDs", () => {
  const document = documentWithHtml('<!--offset--><p> A &amp; <span>Áé</span> B </p>');
  const plan = buildDeckTextPlan(document);
  assert.deepEqual(plan.clips[0]!.entries, [
    {nodePath: [1, 0], textSha256: hash(" A & ")},
    {nodePath: [1, 1, 0], textSha256: hash("Áé")},
    {nodePath: [1, 2], textSha256: hash(" B ")},
  ]);
  assert.equal(plan.scope, "SOURCE_DECK_TEXT_NOT_DOM_OR_PAINT_EVIDENCE");
  assert.ok(!JSON.stringify(plan).includes("Áé"));
  assert.equal(hashDeckTextPlan(plan), hashDeckTextPlan(buildDeckTextPlan(document)));
});

test("inert and scripted content cannot be mistaken for a complete static-text proof", () => {
  const plan = buildDeckTextPlan(documentWithHtml('<script>throw Error("secret")</script><style>p{color:red}</style><template><p>future</p></template><noscript>alternate</noscript><p>Visible</p>'));
  assert.deepEqual(plan.clips[0]!.limitations, ["NOSCRIPT_CONTENT", "SCRIPTED_CONTENT", "TEMPLATE_CONTENT"]);
  assert.deepEqual(plan.clips[0]!.entries.map((entry) => entry.textSha256), [hash("Visible")]);
  assert.ok(!JSON.stringify(plan).includes("secret"));
});

test("all authored corpus ledgers agree independently with source-derived expectations", () => {
  for (const recipe of DECK_CONFORMANCE_CORPUS_RECIPES) {
    const fixture = buildDeckConformanceCorpusCase(recipe, 25);
    assert.equal(fixture.sourceTextPlanSha256, hashDeckTextPlan(fixture.sourceTextPlan));
    assert.equal(fixture.sourceTextPlan.documentHash, fixture.documentHash);
    for (const expected of fixture.expectationLedger.entries) {
      const source = fixture.sourceTextPlan.clips.find((clip) => clip.clipId === expected.clipId)!;
      assert.deepEqual(source.entries.map((entry) => entry.textSha256), [hash(expected.expectedText)]);
      assert.deepEqual(source.limitations, []);
    }
  }
});

test("depth, text and region budgets reject oversized sources explicitly", () => {
  assert.throws(() => buildDeckTextPlan(documentWithHtml("<span>".repeat(65) + "text" + "</span>".repeat(65))), /DEPTH_LIMIT/);
  assert.throws(() => buildDeckTextPlan(documentWithHtml(`<p>${"a".repeat(20_001)}</p>`)), /SIZE_LIMIT/);
  assert.throws(() => buildDeckTextPlan(documentWithHtml("<p>a</p>".repeat(257))), /REGION_LIMIT/);
});

test("source changes alter both document and source binding; duplicate paths are rejected", () => {
  const first = buildDeckTextPlan(documentWithHtml("<p>A</p>"));
  const second = buildDeckTextPlan(documentWithHtml("<p>B</p>"));
  assert.notEqual(first.documentHash, second.documentHash);
  assert.notEqual(first.clips[0]!.sourceHtmlSha256, second.clips[0]!.sourceHtmlSha256);
  assert.notEqual(hashDeckTextPlan(first), hashDeckTextPlan(second));
  first.clips[0]!.entries.push({...first.clips[0]!.entries[0]!});
  assert.equal(deckTextPlanSchema.safeParse(first).success, false);
});

test("a schema-valid ledger with forged paths, text or omitted clips is rejected against its authorized source", () => {
  const document = documentWithHtml("<p>A</p>");
  const original = buildDeckTextPlan(document);
  assert.deepEqual(validateDeckTextPlan(document, original), original);
  for (const mutate of [
    (plan: typeof original) => {plan.clips[0]!.entries[0]!.nodePath = [1, 0];},
    (plan: typeof original) => {plan.clips[0]!.entries[0]!.textSha256 = hash("forged");},
    (plan: typeof original) => {plan.clips = [];},
  ]) {
    const forged = structuredClone(original); mutate(forged);
    assert.equal(deckTextPlanSchema.safeParse(forged).success, true);
    assert.throws(() => validateDeckTextPlan(document, forged), /SOURCE_MISMATCH/);
  }
});
