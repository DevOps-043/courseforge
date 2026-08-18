import assert from "node:assert/strict";
import test from "node:test";
import { HYPERFRAMES_RENDER_REVISION_SELECT } from "../hyperframes-render-submission.service";

test("selecciona la composición de la revisión mediante la FK no ambigua", () => {
  assert.match(
    HYPERFRAMES_RENDER_REVISION_SELECT,
    /video_compositions!video_composition_revisions_composition_id_fkey\(/,
  );
  assert.doesNotMatch(HYPERFRAMES_RENDER_REVISION_SELECT, /video_compositions!inner\(/);
});
