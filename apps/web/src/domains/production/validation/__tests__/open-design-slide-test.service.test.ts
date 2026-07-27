import assert from "node:assert/strict";
import { describe, it } from "node:test";
import fs from "node:fs";
import path from "node:path";
import {
  prepareOpenDesignDeckForHtmlToPng,
  runOpenDesignHtmlToPngTestModule,
  type HtmlSlideRasterizeInput,
} from "../open-design-slide-test.service";

const PNG_BUFFER = Uint8Array.from([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13,
]);

const FALLBACK_OPEN_DESIGN_FIXTURE = `<!doctype html>
<html><head>
  <style>
    html, body { width: 100%; height: 100%; overflow: hidden; }
    .deck-shell { position: fixed; inset: 0; display: grid; place-items: center; }
    .deck-stage { width: 1920px; height: 1080px; transform-origin: top left; }
    .slide { position: absolute; inset: 0; }
    .slide:not(.active) { display: none !important; }
    :where(.slide.active) { display: flex; flex-direction: column; }
    .deck-counter { position: fixed; bottom: 22px; }
    .deck-counter button { width: 36px; height: 36px; }
    .deck-hint { position: fixed; bottom: 26px; right: 28px; }
  </style>
  <script data-od-sandbox-shim="">localStorage.setItem("x", "1");</script>
</head><body>
  <div class="deck-shell"><div class="deck-stage" id="deck-stage">
    <section class="slide active" data-screen-label="01 Cover"><h1>Cover</h1></section>
    <section class="slide" data-screen-label="02 Detail"><h1>Detail</h1></section>
  </div></div>
  <nav class="deck-counter"><button id="deck-prev"></button><button id="deck-next"></button></nav>
  <div class="deck-hint">arrows</div>
  <script>window.addEventListener("keydown", function () {});</script>
  <script data-od-snapshot-bridge="">window.parent.postMessage({ type: "od:snapshot" }, "*");</script>
</body></html>`;

function readFixture() {
  const candidates = [
    path.resolve(process.cwd(), "hermes-challenger-sale.html"),
    path.resolve(process.cwd(), "../../hermes-challenger-sale.html"),
  ];
  const fixturePath = candidates.find((candidate) => fs.existsSync(candidate));
  if (!fixturePath) {
    return FALLBACK_OPEN_DESIGN_FIXTURE;
  }
  return fs.readFileSync(fixturePath, "utf8");
}

describe("Open Design slide cleanup and HTML to PNG test module", () => {
  it("splits the Hermes fixture into static slide HTML documents", () => {
    const source = readFixture();
    const prepared = prepareOpenDesignDeckForHtmlToPng(source);
    const expectedSlideCount = source.includes("CHALLENGER_SALE_01") ? 10 : 2;

    assert.equal(prepared.cleanup.slideCount, expectedSlideCount);
    assert.equal(prepared.slides.length, expectedSlideCount);
    assert.equal(prepared.cleanup.removedScripts, 3);
    assert.equal(prepared.cleanup.removedOpenDesignScripts, 2);
    assert.equal(prepared.cleanup.removedControllerNodes, 2);
    assert.equal(prepared.cleanup.hasSceneControllerResidue, false);
    assert.equal(prepared.slides[0].label, "01 Cover");
    assert.equal(
      prepared.slides[prepared.slides.length - 1].label,
      expectedSlideCount === 10 ? "10 Terminal Prompt" : "02 Detail",
    );
  });

  it("removes scene controller code and locks each slide to the Remotion canvas", () => {
    const prepared = prepareOpenDesignDeckForHtmlToPng(readFixture());

    for (const slide of prepared.slides) {
      assert.equal(slide.width, 1920);
      assert.equal(slide.height, 1080);
      assert.match(slide.html, /data-courseforge-open-design-test-cleanup/);
      assert.match(slide.html, /transform: none !important/);
      assert.match(slide.html, /flex-direction: column !important/);
      assert.match(slide.html, /:where\(\.slide\.active\)\s*\{\s*display: flex; flex-direction: column; \}/);
      assert.doesNotMatch(slide.html, /<script\b/i);
      assert.doesNotMatch(slide.html, /deck-prev|deck-next|deck-counter|deck-hint/);
      assert.doesNotMatch(slide.html, /localStorage|sessionStorage|addEventListener\(['"]keydown/);
      assert.equal((slide.html.match(/<section\b/gi) ?? []).length, 1);
      assert.match(slide.html, /\bclass=(["'])[^"']*\bslide\b[^"']*\bactive\b[^"']*\1/i);
    }
  });

  it("runs the HTML to PNG contract for every cleaned slide", async () => {
    const calls: HtmlSlideRasterizeInput[] = [];
    const result = await runOpenDesignHtmlToPngTestModule(readFixture(), async (input) => {
      calls.push(input);
      assert.equal(input.width, 1920);
      assert.equal(input.height, 1080);
      assert.doesNotMatch(input.html, /<script\b|deck-counter|localStorage/);
      return {
        buffer: PNG_BUFFER,
        width: input.width,
        height: input.height,
        contentType: "image/png",
      };
    });

    assert.equal(calls.length, result.cleanup.slideCount);
    assert.equal(result.slides.length, result.cleanup.slideCount);
    assert.deepEqual(
      result.slides.map((slide) => slide.index),
      Array.from({ length: result.cleanup.slideCount }, (_value, index) => index + 1),
    );
    assert.equal(result.slides[0].contentType, "image/png");
    assert.equal(result.slides[0].byteLength, PNG_BUFFER.byteLength);
  });

  it("fails loudly when the rasterizer does not return PNG output", async () => {
    await assert.rejects(
      () =>
        runOpenDesignHtmlToPngTestModule(readFixture(), async () => ({
          buffer: Uint8Array.from([1, 2, 3, 4]),
          width: 1920,
          height: 1080,
          contentType: "image/jpeg",
        })),
      /OPEN_DESIGN_HTML_TO_PNG_INVALID/,
    );
  });

  it("fails loudly when the PNG dimensions are not Remotion-ready", async () => {
    await assert.rejects(
      () =>
        runOpenDesignHtmlToPngTestModule(readFixture(), async () => ({
          buffer: PNG_BUFFER,
          width: 1280,
          height: 720,
          contentType: "image/png",
        })),
      /OPEN_DESIGN_HTML_TO_PNG_SIZE_MISMATCH/,
    );
  });
});
