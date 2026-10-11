import assert from "node:assert/strict";
import test from "node:test";
import { buildCompositionPreviewCsp } from "../composition-preview-csp.server";
import type { CompositionCompiledFont } from "../../fonts/organization-font.types";

const origin = "https://storage.example.test";
const font: CompositionCompiledFont = { assetId: "00000000-0000-4000-8000-000000000026", family: "Workshop Font", format: "woff2",
  sourceUrl: `${origin}/storage/v1/object/sign/organization-fonts/fonts/workshop.woff2?token=private-test-token` };

test("native preview CSP permits only the host-resolved signed font path, not the entire origin or tokens", () => {
  const policy = buildCompositionPreviewCsp(new Map([[font.assetId, font]]), origin);
  assert.ok(policy.includes(`font-src https://fonts.gstatic.com data: ${origin}/storage/v1/object/sign/organization-fonts/fonts/workshop.woff2;`));
  assert.ok(!policy.includes("private-test-token")); assert.doesNotMatch(policy, /font-src[^;]*\shttps:(?:\s|;)/);
  assert.ok(policy.includes("connect-src 'none'"));
});

test("native preview font CSP fails closed for foreign origins, wrong bucket, unsigned URLs and invalid config", () => {
  for (const sourceUrl of [
    "https://foreign.example/storage/v1/object/sign/organization-fonts/font.woff2?token=x",
    `${origin}/storage/v1/object/sign/private-secrets/font.woff2?token=x`,
    `${origin}/storage/v1/object/public/organization-fonts/font.woff2`,
    `${origin}/storage/v1/object/sign/organization-fonts/font.woff2`,
    `${font.sourceUrl}#fragment`, `${font.sourceUrl}&token=other`,
  ]) assert.throws(() => buildCompositionPreviewCsp(new Map([[font.assetId, { ...font, sourceUrl }]]), origin));
  assert.throws(() => buildCompositionPreviewCsp(new Map([[font.assetId, font]]), "http://storage.example.test"));
  assert.throws(() => buildCompositionPreviewCsp(new Map([[font.assetId, font]])));
  assert.throws(() => buildCompositionPreviewCsp(new Map([[font.assetId, { ...font,
    sourceUrl: `${origin}/storage/v1/object/sign/organization-fonts/${"a".repeat(13 * 1024)}.woff2?token=x` }]]), origin));
  assert.doesNotThrow(() => buildCompositionPreviewCsp(new Map()));
});
