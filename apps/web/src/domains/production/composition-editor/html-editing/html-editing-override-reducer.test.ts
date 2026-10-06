import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HTML_EDITING_LIMITS, type HtmlEditableManifest, type HtmlEditingOverrideState, type HtmlEditingSetOverride,
} from "./html-editing.contract";
import { computeHtmlEditableManifestSha256 } from "./html-editing-manifest-digest.server";
import { reduceHtmlEditingOverrides } from "./html-editing-override-reducer.server";
import { HtmlEditingValidationError } from "./html-editing-validation";

const uuid = "11111111-1111-4111-8111-111111111111";
function fixture(elements?: HtmlEditableManifest["elements"]) {
  const manifest: HtmlEditableManifest = {
    format: "courseforge-html-editable-manifest-v1",
    binding: { organizationId: uuid, documentId: uuid, revisionId: uuid, documentSha256: "a".repeat(64),
      clipId: "intro", templateId: "intro", templateVersion: 1, sourceSha256: "b".repeat(64), manifestSha256: "0".repeat(64) },
    elements: elements ?? [
      { kind: "TEXT", elementId: "title", label: "Title", maxCharacters: 20, multiline: false },
      { kind: "IMAGE", elementId: "photo", label: "Photo", allowedAssetIds: [uuid], allowedFits: ["COVER"] },
      { kind: "THEME", elementId: "theme", label: "Theme", tokenId: "palette", allowedChoiceIds: ["light", "dark"] },
    ],
  };
  manifest.binding.manifestSha256 = computeHtmlEditableManifestSha256(JSON.stringify(manifest), manifest.binding);
  const state: HtmlEditingOverrideState = { format: "courseforge-html-editable-override-state-v1", binding: { ...manifest.binding }, overrides: [] };
  return { manifest, state };
}
const text = (value: string): HtmlEditingSetOverride => ({ operation: "SET_TEXT", elementId: "title", value });
const image: HtmlEditingSetOverride = { operation: "SET_IMAGE", elementId: "photo", assetId: uuid, fit: "COVER" };
const theme: HtmlEditingSetOverride = { operation: "SET_THEME", elementId: "theme", tokenId: "palette", choiceId: "dark" };
function apply(sample: ReturnType<typeof fixture>, overrides: unknown[], grants = [uuid]) {
  return reduceHtmlEditingOverrides({ encodedManifest: JSON.stringify(sample.manifest), encodedState: JSON.stringify(sample.state),
    encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: sample.manifest.binding, overrides }),
    authoritativeBinding: sample.manifest.binding, grantedAssetIds: grants });
}
function rejects(run: () => unknown, code: HtmlEditingValidationError["code"]) {
  assert.throws(run, (error: unknown) => error instanceof HtmlEditingValidationError && error.code === code);
}

test("atomically creates independent before/after snapshots in manifest element order", () => {
  const sample = fixture();
  sample.state.overrides = [text("Old")];
  const before = JSON.stringify(sample);
  const result = apply(sample, [theme, image, text("New")]);
  assert.deepEqual(result.nextState.overrides, [text("New"), image, theme]);
  assert.deepEqual(result.changedElementIds, ["title", "photo", "theme"]);
  assert.equal(JSON.stringify(sample), before);
  assert.deepEqual(result.previousState, sample.state);
  result.nextState.binding.clipId = "changed";
  const nextText = result.nextState.overrides[0]!;
  assert.ok(nextText.operation === "SET_TEXT");
  nextText.value = "Changed outside reducer";
  assert.equal(result.previousState.binding.clipId, "intro");
  assert.deepEqual(result.previousState.overrides, [text("Old")]);
  assert.equal(JSON.stringify(sample), before);
});

test("late invalid operation rejects the entire batch without publishing partial results", () => {
  const sample = fixture();
  sample.state.overrides = [text("Old")];
  const before = JSON.stringify(sample);
  rejects(() => apply(sample, [text("New"), { ...theme, choiceId: "unknown" }]), "VALUE_NOT_DECLARED");
  assert.equal(JSON.stringify(sample), before);
});

test("reset removes only its declared override, leaving immutable source defaults untouched", () => {
  const sample = fixture();
  sample.state.overrides = [text("Old"), image, theme];
  const result = apply(sample, [{ operation: "RESET", elementId: "title", property: "TEXT" }]);
  assert.deepEqual(result.nextState.overrides, [image, theme]);
  assert.deepEqual(result.changedElementIds, ["title"]);
  assert.deepEqual(result.previousState.overrides, [text("Old"), image, theme]);
});

test("same-value set and already-reset element are semantic no-ops", () => {
  const sample = fixture();
  sample.state.overrides = [text("Old")];
  const result = apply(sample, [text("Old"), { operation: "RESET", elementId: "theme", property: "THEME" }]);
  assert.deepEqual(result.changedElementIds, []);
  assert.deepEqual(result.nextState, result.previousState);
  assert.notEqual(result.nextState.overrides[0], result.previousState.overrides[0]);
});

test("rejects stale empty snapshots and stale command identities", () => {
  const sample = fixture();
  sample.state.binding.revisionId = "22222222-2222-4222-8222-222222222222";
  rejects(() => apply(sample, [text("New")]), "STALE_BINDING");
  const fresh = fixture();
  rejects(() => reduceHtmlEditingOverrides({ encodedManifest: JSON.stringify(fresh.manifest), encodedState: JSON.stringify(fresh.state),
    encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: { ...fresh.manifest.binding, templateVersion: 2 }, overrides: [text("New")] }),
    authoritativeBinding: fresh.manifest.binding, grantedAssetIds: [uuid] }), "STALE_BINDING");
});

test("revalidates existing snapshot fields against the manifest, not just state shape", () => {
  for (const override of [text("too long for the template limit"), { ...text("Old"), elementId: "missing" }]) {
    const sample = fixture();
    sample.state.overrides = [override];
    rejects(() => apply(sample, [theme]), override.elementId === "missing" ? "UNKNOWN_ELEMENT" : "VALUE_NOT_DECLARED");
  }
});

test("permits removing revoked image overrides but rejects retaining them", () => {
  const sample = fixture();
  sample.state.overrides = [image];
  rejects(() => apply(sample, [text("New")], []), "ASSET_NOT_AUTHORIZED");
  const result = apply(sample, [{ operation: "RESET", elementId: "photo", property: "IMAGE" }], []);
  assert.deepEqual(result.nextState.overrides, []);
  rejects(() => apply(fixture(), [image], []), "ASSET_NOT_AUTHORIZED");
});

test("rejects duplicate/reset/unknown records in stored snapshots", () => {
  for (const overrides of [[text("First"), text("Second")],
    [{ operation: "RESET", elementId: "title", property: "TEXT" }], [{ ...text("Old"), html: "unsafe" }]]) {
    const sample = fixture();
    const malformed = { ...sample.state, overrides };
    rejects(() => reduceHtmlEditingOverrides({ encodedManifest: JSON.stringify(sample.manifest), encodedState: JSON.stringify(malformed),
      encodedCommand: JSON.stringify({ format: "courseforge-html-editable-command-v1", binding: sample.manifest.binding, overrides: [theme] }),
      authoritativeBinding: sample.manifest.binding, grantedAssetIds: [uuid] }), "INVALID_OVERRIDE_STATE");
  }
});

test("validates snapshots exceeding command count and byte budgets without weakening command limits", () => {
  const sample = fixture(Array.from({ length: 60 }, (_, index) => ({ kind: "TEXT" as const,
    elementId: `title_${index}`, label: `Title ${index}`, maxCharacters: 4096, multiline: true })));
  sample.state.overrides = sample.manifest.elements.map((element) => ({ operation: "SET_TEXT", elementId: element.elementId, value: "x".repeat(2000) }));
  assert.ok(new TextEncoder().encode(JSON.stringify(sample.state)).byteLength > HTML_EDITING_LIMITS.commandBytes);
  const result = apply(sample, [{ operation: "SET_TEXT", elementId: "title_0", value: "New" }]);
  assert.equal(result.nextState.overrides.length, 60);
  assert.deepEqual(result.changedElementIds, ["title_0"]);
});

test("rejects oversized prior and resulting snapshots and verifies manifest content first", () => {
  const sample = fixture(Array.from({ length: 64 }, (_, index) => ({ kind: "TEXT" as const,
    elementId: `title_${index}`, label: `Title ${index}`, maxCharacters: 4096, multiline: true })));
  sample.state.overrides = sample.manifest.elements.map((element, index) => ({ operation: "SET_TEXT", elementId: element.elementId, value: "x".repeat(index === 0 ? 0 : 4050) }));
  assert.ok(new TextEncoder().encode(JSON.stringify(sample.state)).byteLength < HTML_EDITING_LIMITS.stateBytes);
  rejects(() => apply(sample, [{ operation: "SET_TEXT", elementId: "title_0", value: "x".repeat(4096) }]), "PAYLOAD_LIMIT");
  const oversizedPrior = fixture(sample.manifest.elements);
  oversizedPrior.state.overrides = oversizedPrior.manifest.elements.map((element) => ({
    operation: "SET_TEXT", elementId: element.elementId, value: "x".repeat(4096),
  }));
  assert.ok(new TextEncoder().encode(JSON.stringify(oversizedPrior.state)).byteLength > HTML_EDITING_LIMITS.stateBytes);
  rejects(() => apply(oversizedPrior, [{ operation: "RESET", elementId: "title_0", property: "TEXT" }]), "PAYLOAD_LIMIT");
  const fresh = fixture();
  fresh.manifest.elements[0]!.label = "Altered";
  rejects(() => apply(fresh, [text("New")]), "MANIFEST_DIGEST_MISMATCH");
});
