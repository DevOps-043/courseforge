import assert from "node:assert/strict";
import test from "node:test";
import { resolveCompositionCaptionWordGaps, resolveCompositionTextLanguage } from "../composition-text-presentation";
import { formatCompositionUiNumber, formatCompositionUiTimecode } from "../composition-ui-presentation";
import { formatCompositionTimecode, parseCompositionTimecode } from "../composition-timecode";

test("caption gaps preserve adjacent CJK words and Arabic punctuation without inserting spaces", () => {
  for (const [text, tokens, prefixes, suffix] of [
    ["你好，世界！", ["你好", "世界"], ["", "，"], "！"],
    ["مرحباً، بالعالم!", ["مرحباً", "بالعالم"], ["", "، "], "!"],
    ["👩🏽‍💻 e\u0301\nשלום", ["👩🏽‍💻", "e\u0301", "שלום"], ["", " ", "\n"], ""],
  ] as const) {
    const words = tokens.map((word, index) => ({ id: `word-${index}`, text: word, startSeconds: index / 4, endSeconds: (index + 1) / 4 }));
    const cue = { id: "cue", text, startSeconds: 0, endSeconds: 2, words };
    assert.deepEqual(resolveCompositionCaptionWordGaps(cue), { prefixes, suffix });
    assert.equal(cue.text, text);
  }
});
test("legacy mismatching words fail alignment explicitly and language metadata cannot inject attributes", () => {
  assert.equal(resolveCompositionCaptionWordGaps({ id: "cue", text: "Original", startSeconds: 0, endSeconds: 2,
    words: [{ id: "word", text: "Different", startSeconds: 0, endSeconds: 1 }] }), null);
  assert.equal(resolveCompositionTextLanguage("AR-eg"), "ar-EG");
  assert.equal(resolveCompositionTextLanguage('ar" onload="alert(1)'), null);
  assert.equal(resolveCompositionTextLanguage(undefined), null);
});
test("UI presents locale digits and decimal mark without modifying canonical timecodes", () => {
  assert.equal(formatCompositionUiTimecode(1.234, "es-ES"), "00:01,234");
  assert.equal(formatCompositionUiTimecode(1.234, "ar-EG"), "٠٠:٠١٫٢٣٤");
  assert.equal(formatCompositionUiTimecode(3661), "01:01:01");
  assert.equal(formatCompositionTimecode(1.234), "00:01.234");
  assert.equal(parseCompositionTimecode("00:01.234"), 1.234);
  assert.equal(formatCompositionUiNumber(1.25, 2, "es-ES"), "1,25");
});
test("presentation rejects nonfinite time/number and invalid locale falls back safely", () => {
  assert.equal(formatCompositionUiNumber(NaN), "—");
  assert.equal(formatCompositionUiTimecode(Infinity), "—");
  assert.equal(formatCompositionUiTimecode(-1), "—");
  assert.equal(formatCompositionUiNumber(1.25, 2, "invalid_locale"), "1.25");
  assert.equal(formatCompositionUiTimecode(1.25, "invalid_locale"), "00:01.250");
});
