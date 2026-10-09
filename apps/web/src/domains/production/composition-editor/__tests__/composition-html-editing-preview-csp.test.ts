import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { buildCompositionHtmlEditingPreviewCsp, HTML_EDITING_PREVIEW_CSP_POLICY } from "../composition-html-editing-preview-csp.server";

const script = 'window.seek = (time) => { document.body.style.opacity = String(time); };';
const css = 'p { color: #123456; }';
const style = 'font-size:24px;color:red';
const hash = (value: string) => `'sha256-${createHash("sha256").update(value).digest("base64")}'`;
const page = `<html><head><style>${css}</style></head><body><p style="${style}">Text</p><script>${script}</script></body></html>`;

test("editable preview policy pins exact runtime and styles without broad inline or remote authority", () => {
  const policy = buildCompositionHtmlEditingPreviewCsp(page);
  assert.ok(policy.includes(`script-src ${hash(script)}`));
  assert.ok(policy.includes(`style-src-elem ${hash(css)}`));
  assert.ok(policy.includes(`style-src-attr 'unsafe-hashes' ${hash(style)}`));
  for (const directive of ["default-src 'none'", "script-src-attr 'none'", "connect-src 'none'", "sandbox allow-scripts", "frame-ancestors 'self'"])
    assert.ok(policy.includes(directive));
  for (const forbidden of ["unsafe-inline", "unsafe-eval", "allow-same-origin", "https:", "data:", "allow-popups", "allow-forms"])
    assert.equal(policy.includes(forbidden), false);
});

test("hashes preserve raw script whitespace and decoded style attributes; duplicate values coalesce", () => {
  const encoded = '<p style="font-family:&quot;Inter&quot;">One</p><p style="font-family:&quot;Inter&quot;">Two</p><script>\nlet v = 1;\n</script>';
  const policy = buildCompositionHtmlEditingPreviewCsp(encoded);
  assert.ok(policy.includes(hash('\nlet v = 1;\n'))); assert.ok(policy.includes(hash('font-family:"Inter"')));
  assert.equal(policy, buildCompositionHtmlEditingPreviewCsp(encoded));
  assert.notEqual(buildCompositionHtmlEditingPreviewCsp(page.replace(script, `${script}\n`)), buildCompositionHtmlEditingPreviewCsp(page));
});

test("external scripts, inline handlers and excessive work fail safely without broad fallback", () => {
  for (const html of ['<script src="assets/gsap.min.js"></script>', '<p onclick="bad()">Text</p>',
    'x'.repeat(HTML_EDITING_PREVIEW_CSP_POLICY.pageBytes + 1),
    '<i></i>'.repeat(HTML_EDITING_PREVIEW_CSP_POLICY.nodes + 1),
    Array.from({ length: 300 }, (_, index) => `<p style="opacity:${index / 300}"></p>`).join('') ]) {
    assert.throws(() => buildCompositionHtmlEditingPreviewCsp(html), /^HtmlEditingPreviewCspError: HTML_EDITING_PREVIEW_CSP_REJECTED$/);
  }
});
