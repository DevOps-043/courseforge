import assert from "node:assert/strict";
import {
  hasPaywallContent,
  isBlockedSourceDomain,
  isSoft404Content,
  normalizeSourceUrl,
  validatePdfBuffer,
  validateUrlSource,
} from "../validation";

async function run() {
  assert.equal(
    normalizeSourceUrl(
      "http://WWW.Example.com/guide/?utm_source=newsletter&b=2&a=1#intro",
    ),
    "https://example.com/guide?a=1&b=2",
  );
  assert.equal(isBlockedSourceDomain("https://subdomain.reddit.com/r/test"), true);
  assert.equal(isBlockedSourceDomain("https://docs.example.edu/guide"), false);
  assert.equal(isSoft404Content("404 - Page not found"), true);
  assert.equal(
    hasPaywallContent("Subscribe now to continue reading this article"),
    true,
  );

  let fetchCalled = false;
  const duplicate = await validateUrlSource("https://example.com/guide", {
    existingNormalizedUrls: ["https://example.com/guide"],
    fetchImpl: async () => {
      fetchCalled = true;
      throw new Error("Unexpected fetch");
    },
  });
  assert.equal(duplicate.isValid, false);
  assert.equal(duplicate.report.checks.duplicate, true);
  assert.equal(fetchCalled, false);

  const validHtml = `<html><head><title>Educational guide</title></head><body>${"Useful educational content. ".repeat(30)}</body></html>`;
  const valid = await validateUrlSource("https://example.edu/guide", {
    fetchImpl: async () =>
      new Response(validHtml, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
  });
  assert.equal(valid.isValid, true);
  assert.equal(valid.report.detected_title, "Educational guide");

  const short = await validateUrlSource("https://example.edu/short", {
    fetchImpl: async () =>
      new Response("<html><body>Too short</body></html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  });
  assert.equal(short.isValid, false);
  assert.equal(short.report.checks.minimum_content, false);

  const paywall = await validateUrlSource("https://example.edu/paywall", {
    fetchImpl: async () =>
      new Response(
        `<html><body>Subscribe now to continue reading. ${"content ".repeat(100)}</body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
  });
  assert.equal(paywall.isValid, false);
  assert.equal(paywall.report.checks.paywall, true);

  const pdfText = "This is educational PDF content. ".repeat(30);
  const validPdf = await validatePdfBuffer(
    Buffer.from(`%PDF-1.4\nBT\n(${pdfText}) Tj\nET\n%%EOF`, "latin1"),
    "application/pdf",
  );
  assert.equal(validPdf.isValid, true);
  assert.equal(validPdf.sha256.length, 64);

  const emptyPdf = await validatePdfBuffer(
    Buffer.from("%PDF-1.4\n%%EOF", "latin1"),
    "application/pdf",
  );
  assert.equal(emptyPdf.isValid, false);
  assert.equal(emptyPdf.report.checks.minimum_content, false);

  const invalidMime = await validatePdfBuffer(
    Buffer.from(`%PDF-1.4\n(${pdfText}) Tj`, "latin1"),
    "text/plain",
  );
  assert.equal(invalidMime.isValid, false);
  assert.equal(invalidMime.report.checks.valid_mime, false);
}

void run().then(() => {
  console.log("curation-v2 validation tests passed");
});
