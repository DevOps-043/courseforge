import assert from "node:assert/strict";
import test from "node:test";
import { buildProductionIdempotencyKey } from "../../jobs/production-jobs.service";
import { HYPERFRAMES_RENDER_REVISION_SELECT } from "../hyperframes-render-submission.service";

test("selecciona la composición de la revisión mediante la FK no ambigua", () => {
  assert.match(
    HYPERFRAMES_RENDER_REVISION_SELECT,
    /video_compositions!video_composition_revisions_composition_id_fkey\(/,
  );
  assert.doesNotMatch(HYPERFRAMES_RENDER_REVISION_SELECT, /video_compositions!inner\(/);
});

test("diferencia cada reintento del mismo snapshot en la clave de idempotencia", () => {
  const baseInput = {
    aspect_ratio: "16:9",
    format: "mp4",
    fps: 30,
    project_hash: "project-hash",
    quality: "high",
    resolution: "1080p",
    revision_id: "revision-id",
    variables: {},
  };
  const keyFor = (input: unknown) => buildProductionIdempotencyKey({
    componentId: "component-id",
    input,
    jobType: "HYPERFRAMES_RENDER",
    provider: "HYPERFRAMES",
  });

  assert.equal(keyFor(baseInput), keyFor(baseInput));
  assert.notEqual(
    keyFor(baseInput),
    keyFor({ ...baseInput, attempt_id: "0b894a51-ef63-42e9-8709-0739a4e3805c" }),
  );
});
