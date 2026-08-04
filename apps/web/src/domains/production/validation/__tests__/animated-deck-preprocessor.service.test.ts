import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  collectAnimatedDeckRemoteAssetUrls,
  prepareAnimatedDeckForRemotion,
  rewriteAnimatedDeckRemoteAssetUrls,
} from "../animated-deck-preprocessor.service";

const MIXED_DECK = `<!doctype html>
<html>
<head>
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;700&display=swap">
  <style>
    :root { --accent: #00D4B3; }
    html, body { margin: 0; }
    .deck-shell { position: fixed; inset: 0; }
    .deck-stage { width: 1920px; height: 1080px; }
    .slide { width: 1920px; height: 1080px; font-family: 'Outfit', sans-serif; }
    .slide:not(.active) { display: none; }
    .slide.active .headline { animation: fade-up 0.8s ease 0.4s forwards; }
    .slide.active .static-copy { color: var(--accent); }
    .deck-counter { position: fixed; bottom: 10px; }
    @keyframes fade-up {
      from { opacity: 0; transform: translateY(20px); }
      to { opacity: 1; transform: translateY(0); }
    }
  </style>
  <script>window.addEventListener("keydown", function () {});</script>
</head>
<body>
  <div class="deck-shell"><div class="deck-stage">
    <section class="slide active s-center" data-screen-label="01 Animated">
      <h1 class="headline" onclick="alert('x')">Animated</h1>
      <div>[ B-ROLL: remove me ]</div>
    </section>
    <section class="slide s-center" data-screen-label="02 Static">
      <h1 class="static-copy">Static</h1>
    </section>
  </div></div>
  <nav class="deck-counter">counter</nav>
</body>
</html>`;

describe("prepareAnimatedDeckForRemotion", () => {
  it("prepares animated and static slides through the same HTML pipeline", () => {
    const result = prepareAnimatedDeckForRemotion(MIXED_DECK);

    assert.equal(result.deck.slides.length, 2);
    assert.equal(result.animatedSlideCount, 1);
    assert.equal(result.staticSlideCount, 1);
    assert.equal(result.deck.slides[0].label, "01 Animated");
    assert.equal(result.deck.slides[0].classes, "slide active s-center");
    assert.equal(result.deck.slides[1].classes, "slide s-center active");
    assert.ok(result.deck.slides[0].animationCount > 0);
    assert.equal(result.deck.slides[1].animationCount, 0);
    assert.doesNotMatch(result.deck.slides[0].html, /onclick|B-ROLL/);
    assert.match(result.css, /\.deck-scope \.slide/);
    assert.match(result.css, /animation-play-state: paused/);
    assert.match(result.css, /--deck-t/);
  });

  it("repairs common UTF-8 mojibake before storing slide HTML", () => {
    const html = MIXED_DECK.replace(
      "<h1 class=\"headline\" onclick=\"alert('x')\">Animated</h1>",
      "<h1 class=\"headline\">Pantalla de tÃ­tulo con transiciÃ³n</h1>",
    );
    const result = prepareAnimatedDeckForRemotion(html);

    assert.match(result.deck.slides[0].html, /título/);
    assert.match(result.deck.slides[0].html, /transición/);
    assert.doesNotMatch(result.deck.slides[0].html, /tÃ­tulo|transiciÃ³n/);
  });

  it("allows Google Fonts and records them as deck metadata", () => {
    const result = prepareAnimatedDeckForRemotion(MIXED_DECK);

    assert.deepEqual(
      result.fonts.map((font) => font.family),
      ["Outfit"],
    );
    assert.match(result.css, /fonts\.googleapis\.com/);
    assert.equal(result.validation.isValid, true);
  });

  it("rejects remote assets outside the Google Fonts allowlist", () => {
    const html = MIXED_DECK.replace(
      "<h1 class=\"static-copy\">Static</h1>",
      "<img src=\"https://example.com/unsafe.png\" alt=\"unsafe\">",
    );

    assert.throws(
      () => prepareAnimatedDeckForRemotion(html),
      /URL remota no permitida/,
    );
  });

  it("allows remote image assets after they are imported and rewritten", () => {
    const html = MIXED_DECK.replace(
      "<h1 class=\"static-copy\">Static</h1>",
      "<img src=\"https://images.unsplash.com/photo-1552581234-26160f608093?auto=format&amp;fit=crop&amp;w=1920&amp;q=80\" alt=\"team\">",
    );
    const sourceUrls = collectAnimatedDeckRemoteAssetUrls(html);

    assert.deepEqual(sourceUrls, [
      "https://images.unsplash.com/photo-1552581234-26160f608093?auto=format&amp;fit=crop&amp;w=1920&amp;q=80",
    ]);

    const publicUrl = "https://storage.example.com/production-assets/slides/component/asset-01.jpg";
    const rewrittenHtml = rewriteAnimatedDeckRemoteAssetUrls(html, {
      [sourceUrls[0]]: publicUrl,
    });
    const result = prepareAnimatedDeckForRemotion(rewrittenHtml, {
      allowedRemoteAssetUrls: [publicUrl],
      remoteAssets: [
        {
          bytes: 1024,
          content_type: "image/jpeg",
          public_url: publicUrl,
          source_url: sourceUrls[0],
          storage_path: "production-assets/slides/component/asset-01.jpg",
        },
      ],
    });

    assert.equal(result.validation.isValid, true);
    assert.equal(result.remoteAssets.length, 1);
    assert.match(result.deck.slides[1].html, /storage\.example\.com/);
  });

  it("rejects forbidden embedded tags", () => {
    const html = MIXED_DECK.replace(
      "<h1 class=\"static-copy\">Static</h1>",
      "<iframe src=\"https://example.com\"></iframe>",
    );

    assert.throws(
      () => prepareAnimatedDeckForRemotion(html),
      /etiquetas HTML no permitidas/,
    );
  });
});
