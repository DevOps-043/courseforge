import assert from "node:assert/strict";
import test from "node:test";
import { extractYouTubeMetadataFromHtml } from "../video-metadata.service";

test("extracts bounded YouTube metadata from supported duration fields", () => {
  assert.deepEqual(
    extractYouTubeMetadataFromHtml('<title>Curso práctico - YouTube</title> "lengthSeconds":"125"'),
    { duration: 125, title: "Curso práctico" },
  );
  assert.deepEqual(
    extractYouTubeMetadataFromHtml('<title>Demo - YouTube</title> "approxDurationMs":"2500"'),
    { duration: 3, title: "Demo" },
  );
});

test("falls back safely when YouTube omits duration metadata", () => {
  assert.deepEqual(
    extractYouTubeMetadataFromHtml("<html><title>Sin duración</title></html>"),
    { duration: 0, title: "Sin duración" },
  );
});
