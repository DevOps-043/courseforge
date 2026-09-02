import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import {
  validateHyperframesArchiveHtmlContract,
  validateHyperframesHtmlContract,
} from "../hyperframes-html-contract.service";
import { HYPERFRAMES_ASSET_DELIVERY_MODES } from "../hyperframes.types";

test("accepts the official HyperFrames remote media binding", () => {
  const result = validateHyperframesHtmlContract({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    html: '<video class="clip" data-var-src="cf_asset_video" data-start="0" data-duration="5"></video><audio class="clip" data-var-src="cf_asset_audio" data-start="0" data-duration="5"></audio>',
  });
  assert.deepEqual(result, { errors: [], valid: true });
});

test("rejects the legacy binding that leaves cloud media without a source", () => {
  const result = validateHyperframesHtmlContract({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    html: '<video class="clip" data-hf-src="cf_asset_video" data-start="0" data-duration="5"></video>',
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /data-hf-src/);
  assert.match(result.errors.join(" "), /data-var-src ni src/);
});

test("accepts embedded media with a packaged src", () => {
  const result = validateHyperframesHtmlContract({
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.EMBEDDED,
    html: '<video class="clip" src="assets/video.mp4" data-start="0" data-duration="5"></video>',
  });
  assert.equal(result.valid, true);
});

test("validates the actual HTML entry point inside the immutable archive", async () => {
  const zip = new JSZip();
  zip.file("index.html", '<audio class="clip" data-hf-src="cf_asset_audio"></audio>');
  const archive = await zip.generateAsync({ type: "uint8array" });
  const result = await validateHyperframesArchiveHtmlContract({
    archive,
    deliveryMode: HYPERFRAMES_ASSET_DELIVERY_MODES.REMOTE_VARIABLES,
    entryPoint: "index.html",
  });
  assert.equal(result.valid, false);
  assert.match(result.errors.join(" "), /data-hf-src/);
});
