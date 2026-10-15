import assert from "node:assert/strict";
import test from "node:test";
import type { CompositionSceneSummary } from "../composition-scene.service";
import { buildNarrativeSearchIndex, NARRATIVE_SEARCH_LIMITS, searchNarrativeIndex } from "../composition-narrative-search.service";

function scene(scriptText: string, id = "scene-1"): CompositionSceneSummary {
  return { id, scriptText, label: "Introducción", startSeconds: 3, durationSeconds: 10,
    primaryHfId: "voice-1", clipHfIds: ["voice-1"], roles: ["VOICE"] };
}

test("searches title and script without changing scene or inferring word timing", () => {
  const scenes = [scene("Explicación clara")];
  const before = structuredClone(scenes);
  const result = searchNarrativeIndex(buildNarrativeSearchIndex(scenes), "EXPLICACION");
  assert.equal(result.matches[0]?.matched, "Explicación");
  assert.equal(result.matches[0]?.sceneStartSeconds, 3);
  assert.equal(searchNarrativeIndex(buildNarrativeSearchIndex(scenes), "introduccion").matches[0]?.field, "TITLE");
  assert.deepEqual(scenes, before);
});
test("maps combined accents and emoji to original UTF-16 spans", () => {
  const result = searchNarrativeIndex(buildNarrativeSearchIndex([scene("👩🏽‍💻 cafe\u0301 listo")]), "café");
  assert.equal(result.matches[0]?.matched, "cafe\u0301");
  assert.equal(result.matches[0]?.before, "👩🏽‍💻 ");
});
test("keeps ñ distinct and can require vowel accents", () => {
  const scenes = [scene("año café")];
  assert.equal(searchNarrativeIndex(buildNarrativeSearchIndex(scenes), "ano").matches.length, 0);
  const index = buildNarrativeSearchIndex(scenes, { ignoreAccents: false });
  assert.equal(searchNarrativeIndex(index, "cafe").matches.length, 0);
});
test("literal metacharacters and markup remain text", () => {
  const result = searchNarrativeIndex(buildNarrativeSearchIndex([scene("<script> [a.*] שלום")]), "[a.*]");
  assert.equal(result.matches[0]?.matched, "[a.*]");
  assert.equal(searchNarrativeIndex(buildNarrativeSearchIndex([scene("שלום")]), "שלום").matches.length, 1);
});
test("repeated phrases and scenes have distinct result identities", () => {
  const result = searchNarrativeIndex(buildNarrativeSearchIndex([scene("voz voz"), scene("voz", "scene-2")]), "voz");
  assert.equal(result.matches.length, 3);
  assert.equal(new Set(result.matches.map((match) => match.id)).size, 3);
});
test("empty and overbudget queries are bounded", () => {
  const index = buildNarrativeSearchIndex([scene("voz")]);
  assert.equal(searchNarrativeIndex(index, "  ").matches.length, 0);
  assert.equal(searchNarrativeIndex(index, "a".repeat(NARRATIVE_SEARCH_LIMITS.queryCharacters + 1)).queryTooLong, true);
});
test("result and indexing limits are explicit, and scene scope can recover omitted text", () => {
  assert.equal(searchNarrativeIndex(buildNarrativeSearchIndex([scene("voz ".repeat(51))]), "voz").limited, true);
  const scenes = [scene("a".repeat(150_000)), scene("b".repeat(60_000), "scene-2")];
  assert.equal(buildNarrativeSearchIndex(scenes).incomplete, true);
  const scoped = buildNarrativeSearchIndex(scenes, { sceneId: "scene-2" });
  assert.equal(scoped.incomplete, false);
  assert.equal(searchNarrativeIndex(scoped, "bbb").matches[0]?.sceneId, "scene-2");
});
test("unknown scope and missing script return no invented matches", () => {
  assert.equal(searchNarrativeIndex(buildNarrativeSearchIndex([scene("voz")], { sceneId: "deleted" }), "voz").matches.length, 0);
  assert.equal(searchNarrativeIndex(buildNarrativeSearchIndex([{ ...scene(""), scriptText: undefined }]), "voz").matches.length, 0);
});
