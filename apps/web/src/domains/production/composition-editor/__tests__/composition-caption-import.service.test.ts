import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_CAPTION_IMPORT_BYTES,
  parseCompositionCaptionImport,
} from "../composition-caption-import.service";

test("imports ordered multiline SRT captions with relative timing", () => {
  const result = parseCompositionCaptionImport({
    content: "1\r\n00:00:00,500 --> 00:00:02,000\r\nPrimera línea\r\nSegunda línea\r\n\r\n2\r\n00:00:02,000 --> 00:00:04,250\r\nFinal",
    fileName: "lesson.srt",
    maxDurationSeconds: 5,
  });

  assert.equal(result.format, "SRT");
  assert.deepEqual(result.cues, [
    { endSeconds: 2, id: "cue-1", startSeconds: 0.5, text: "Primera línea\nSegunda línea" },
    { endSeconds: 4.25, id: "cue-2", startSeconds: 2, text: "Final" },
  ]);
});

test("imports WebVTT identifiers and settings while removing caption markup", () => {
  const result = parseCompositionCaptionImport({
    content: "WEBVTT - Español\n\nNOTE generado automáticamente\nNo importar\n\nintro\n00:00.000 --> 00:02.500 align:center position:50%\n<v Lia><b>Hola &amp; bienvenidos</b></v>",
    fileName: "lesson.vtt",
    maxDurationSeconds: 3,
  });

  assert.equal(result.format, "VTT");
  assert.deepEqual(result.cues, [
    { endSeconds: 2.5, id: "cue-1", startSeconds: 0, text: "Hola & bienvenidos" },
  ]);
});

test("rejects mismatched formats, overlaps and cues outside the layer", () => {
  assert.throws(() => parseCompositionCaptionImport({
    content: "WEBVTT\n\n00:00.000 --> 00:01.000\nHola",
    fileName: "lesson.srt",
    maxDurationSeconds: 2,
  }), /no coincide/);
  assert.throws(() => parseCompositionCaptionImport({
    content: "1\n00:00:00,000 --> 00:00:02,000\nUno\n\n2\n00:00:01,500 --> 00:00:03,000\nDos",
    fileName: "lesson.srt",
    maxDurationSeconds: 4,
  }), /solapa/);
  assert.throws(() => parseCompositionCaptionImport({
    content: "1\n00:00:00,000 --> 00:00:03,000\nFuera",
    fileName: "lesson.srt",
    maxDurationSeconds: 2,
  }), /fuera de la capa/);
});

test("rejects caption payloads beyond the bounded import size", () => {
  assert.throws(() => parseCompositionCaptionImport({
    content: "x".repeat(MAX_CAPTION_IMPORT_BYTES + 1),
    fileName: "large.srt",
    maxDurationSeconds: 2,
  }), /excede el límite/);
});
