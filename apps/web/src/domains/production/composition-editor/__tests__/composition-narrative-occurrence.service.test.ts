import assert from "node:assert/strict";
import test from "node:test";
import { createNarrativeDocumentFixture as documentFixture } from "./fixtures/composition-narrative.fixture";
import { deriveNarrativeNavigationOccurrences, NARRATIVE_OCCURRENCE_MAX_TOKENS } from "../composition-narrative-occurrence.service";
import { buildNarrativeSearchIndex, searchNarrativeIndex } from "../composition-narrative-search.service";
import { deriveCompositionScenes } from "../composition-scene.service";

test("maps source offsets to moved clip times and marks partially trimmed words", () => {
  const document = documentFixture();
  const before = structuredClone(document);
  const occurrence = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  assert.equal(occurrence.text, "café listo final");
  assert.deepEqual(occurrence.tokens.map((token) => [token.sourceIndex, token.timelineStartSeconds, token.timelineEndSeconds, token.partial]),
    [[1, 10, 10.5, true], [2, 10.5, 11.5, false], [3, 11.5, 12, true]]);
  assert.equal(occurrence.provenance, "SCENE_TIMESTAMPS_UNVERIFIED_ASSET_BINDING");
  assert.deepEqual(document, before);
});

test("duplicate clips retain distinct occurrence and search identities", () => {
  const document = documentFixture();
  document.clips.push({ ...structuredClone(document.clips[0]!), id: "voice-2", hfId: "hf-voice-2", startSeconds: 20 });
  const report = deriveNarrativeNavigationOccurrences(document);
  const result = searchNarrativeIndex(buildNarrativeSearchIndex(deriveCompositionScenes(document), { occurrences: report.occurrences }), "listo");
  assert.deepEqual(result.matches.map((match) => match.navigationSeconds), [10.5, 20.5]);
  assert.equal(new Set(result.matches.map((match) => match.id)).size, 2);
  assert.deepEqual(result.matches.map((match) => match.primaryHfId), ["hf-voice-1", "hf-voice-2"]);
});

test("adjacent split windows cannot manufacture a phrase across their boundary", () => {
  const document = documentFixture();
  document.clips[0]!.durationSeconds = 0.5;
  document.clips.push({ ...structuredClone(document.clips[0]!), id: "voice-right", hfId: "hf-voice-right",
    sourceOffsetSeconds: 1.5, startSeconds: 10.5, durationSeconds: 1.5 });
  const report = deriveNarrativeNavigationOccurrences(document);
  assert.deepEqual(report.occurrences.map((occurrence) => occurrence.text), ["café", "listo final"]);
  const index = buildNarrativeSearchIndex(deriveCompositionScenes(document), { occurrences: report.occurrences });
  assert.equal(searchNarrativeIndex(index, "café listo").matches.length, 0);
  assert.equal(searchNarrativeIndex(index, "listo").matches[0]?.navigationSeconds, 10.5);
});

test("matches phrases only inside an occurrence and exposes source token bounds", () => {
  const document = documentFixture();
  const report = deriveNarrativeNavigationOccurrences(document);
  const index = buildNarrativeSearchIndex(deriveCompositionScenes(document), { occurrences: report.occurrences });
  const match = searchNarrativeIndex(index, "cafe listo").matches[0]!;
  assert.equal(match.field, "TIMED_WORDS");
  assert.deepEqual(match.tokenRange, { firstSourceIndex: 1, lastSourceIndex: 2, partial: true });
  assert.equal(searchNarrativeIndex(index, "antes café").matches.length, 0);
});

test("rejects malformed sequences as a whole rather than bridging invalid words", () => {
  for (const invalidWord of [{ word: "mal", start: NaN, end: 2 }, { word: "mal", start: 2, end: 1 },
    { word: "", start: 1, end: 2 }, { word: "overlap", start: 0.4, end: 2 }]) {
    const document = documentFixture();
    document.narrativeScenes![0]!.wordTimestamps![1] = invalidWord;
    const report = deriveNarrativeNavigationOccurrences(document);
    assert.deepEqual(report.invalidSceneIds, ["scene-1"]);
    assert.equal(report.occurrences.length, 0);
  }
});

test("hidden clips/tracks and absent timestamps are excluded without fabricating words", () => {
  for (const hideTrack of [true, false]) {
    const document = documentFixture();
    if (hideTrack) document.tracks[0]!.hidden = true;
    else document.clips[0]!.hidden = true;
    assert.equal(deriveNarrativeNavigationOccurrences(document).occurrences.length, 0);
  }
  const document = documentFixture();
  delete document.narrativeScenes![0]!.wordTimestamps;
  assert.equal(deriveNarrativeNavigationOccurrences(document).occurrences.length, 0);
});

test("rate, freeze and invalid source windows cannot enter linear navigation", () => {
  for (const patch of [{ playbackRate: 2 }, { freezeTailSeconds: 1 }, { sourceDurationSeconds: 2 }, { sourceOffsetSeconds: -1 }]) {
    const document = documentFixture();
    Object.assign(document.clips[0]!, patch);
    assert.deepEqual(deriveNarrativeNavigationOccurrences(document).unsupportedClipIds, ["voice-1"]);
  }
});

test("replacing the asset invalidates occurrence identity, without upgrading provenance", () => {
  const document = documentFixture();
  const original = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  if (document.clips[0]!.source.type === "PRODUCTION_ASSET") document.clips[0]!.source.productionAssetId = "22222222-2222-4222-8222-222222222222";
  const replaced = deriveNarrativeNavigationOccurrences(document).occurrences[0]!;
  assert.notEqual(replaced.id, original.id);
  assert.equal(replaced.provenance, original.provenance);
});

test("bounds projection work and reports omitted occurrences", () => {
  const document = documentFixture();
  document.narrativeScenes![0]!.wordTimestamps = Array.from({ length: NARRATIVE_OCCURRENCE_MAX_TOKENS + 1 },
    (_, index) => ({ word: "voz", start: index, end: index + 0.5 }));
  const report = deriveNarrativeNavigationOccurrences(document);
  assert.equal(report.limited, true);
  assert.equal(report.occurrences.length, 0);
});
