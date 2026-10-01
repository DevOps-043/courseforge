import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT, compositionEditorDocumentSchema } from "../composition-document.types";
import { buildTextParityCheckpointPlan, captureTextParityCheckpoint, readTextParityDom } from "../qa/composition-text-checkpoint-capture";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";
import { NATIVE_TEXT_APPEARANCE_POLICY } from "../composition-text-parity-contract";
import { buildNativeTextPaintPose } from "../composition-text-paint-pose";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function fixture(kind: "TEXT" | "CAPTION" = "TEXT", id = "native") {
  const document = createTransitionDocument();
  const {clip, track} = createCompositionNativeOverlay({document, id, kind, playheadSeconds: 1});
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  if (track) document.tracks.push(track); document.clips.push(clip);
  return {document: compositionEditorDocumentSchema.parse(document), clipId: clip.id};
}
const client = (value: unknown, exception = false): CompositionQaCdpClient => ({close() {},
  async send() {return exception ? {exceptionDetails: {}} : {result: {value}};}});

test("canonical plan uses half-open clip/cue timing and excludes explicit hidden/zero layout opacity", () => {
  const {document, clipId} = fixture(); const clip = document.clips.find((candidate) => candidate.id === clipId)!;
  assert.equal(buildTextParityCheckpointPlan(document, 0).expectedTexts.length, 0);
  assert.equal(buildTextParityCheckpointPlan(document, 1).expectedTexts[0]!.elementId, "native-motion");
  assert.equal(buildTextParityCheckpointPlan(document, 6).expectedTexts.length, 0);
  clip.hidden = true; assert.equal(buildTextParityCheckpointPlan(document, 2).expectedTexts.length, 0);
  clip.hidden = false; clip.layout.opacity = 0; assert.equal(buildTextParityCheckpointPlan(document, 2).expectedTexts.length, 0);
  clip.layout.opacity = 1; document.tracks.find((track) => track.id === clip.trackId)!.hidden = true;
  assert.equal(buildTextParityCheckpointPlan(document, 2).expectedTexts.length, 0);
  assert.throws(() => buildTextParityCheckpointPlan(document, NaN), /CHECKPOINT_INVALID/);
});

test("caption projection matches exact karaoke span text, UTF8/RTL and absolute cue boundaries", () => {
  const {document, clipId} = fixture("CAPTION"); const source = document.clips.find((clip) => clip.id === clipId)!.source;
  if (source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions");
  source.cues = [{id: "cue", text: "Texto editorial distinto", startSeconds: 0.25, endSeconds: 0.75,
    words: [{id: "one", text: "مرحبا", startSeconds: 0.25, endSeconds: 0.5}, {id: "two", text: "世界", startSeconds: 0.5, endSeconds: 0.75}]}];
  assert.equal(buildTextParityCheckpointPlan(document, 1.24).expectedTexts.length, 0);
  assert.deepEqual(buildTextParityCheckpointPlan(document, 1.25).expectedTexts, [{elementId: "native-caption-cue", textSha256: hash("مرحبا 世界")}]);
  assert.equal(buildTextParityCheckpointPlan(document, 1.75).expectedTexts.length, 0);
});

test("opt-in motion visibility retains hidden expectations and exact fade boundaries", async () => {
  const {document} = fixture();
  document.motion.animations.push({id: "fade", origin: "USER", propertyGroup: "OPACITY", target: {clipId: "native", part: "CONTENT"},
    timing: {anchor: "CLIP_START", offsetSeconds: 0, durationSeconds: 1},
    keyframes: [{offset: 0, values: {opacity: 0}}, {offset: 1, values: {opacity: 1}, ease: "none"}]});
  const hidden = buildTextParityCheckpointPlan(document, 1, true);
  assert.equal(hidden.expectedTexts.length, 1);
  assert.equal(hidden.expectedTexts[0]!.visibility, "HIDDEN");
  assert.equal(buildTextParityCheckpointPlan(document, 1.01, true).expectedTexts[0]!.visibility, "VISIBLE");
  assert.equal(buildTextParityCheckpointPlan(document, 1).expectedTexts[0]!.visibility, undefined);
  const clip = document.clips.find((entry) => entry.id === "native")!;
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  const row = {elementId: "native-motion", text: clip.source.text, left: 10, top: 20, width: 30, height: 40, visibility: "HIDDEN"};
  const evidence = await captureTextParityCheckpoint(client([row]), document, 1, true);
  assert.equal(evidence.status, "CAPTURED");
  assert.equal(evidence.regions[0]!.visibility, "HIDDEN");
  await assert.rejects(captureTextParityCheckpoint(client([{...row, visibility: "VISIBLE"}]), document, 1, true), /VISIBILITY_MISMATCH/);
});

test("DOM reader measures zero-opacity geometry only when an explicit visibility plan exists", () => {
  const element = {parentElement: null, textContent: "Oculto"};
  const context = {limits: policy, document: {getElementById: () => element,
    createRange: () => ({selectNodeContents() {}, detach() {}, getBoundingClientRect: () => ({left: 5, top: 5, right: 20, bottom: 20})})},
    getComputedStyle: () => ({opacity: "0", display: "flex", visibility: "visible"})};
  const row = runInNewContext(`(${readTextParityDom.toString()})(["native-motion"],100,50,limits,{"native-motion":"HIDDEN"})`, context)[0];
  assert.equal(row.visibility, "HIDDEN"); assert.equal(row.width, 15);
  const legacy = runInNewContext(`(${readTextParityDom.toString()})(["native-motion"],100,50,limits)`, context)[0];
  assert.equal(legacy.unavailable, "ELEMENT_NOT_VISIBLE");
});

test("visibility projection honors CLIP_END anchors, finite loops and reverse checkpoint order", () => {
  const {document} = fixture();
  document.motion.animations.push({id: "loop", origin: "USER", propertyGroup: "OPACITY", target: {clipId: "native", part: "CONTENT"},
    timing: {anchor: "CLIP_END", offsetSeconds: 0, durationSeconds: 2.5}, loop: {mode: "FINITE", cycleDurationSeconds: 1},
    keyframes: [{offset: 0, values: {opacity: 1}}, {offset: 0.5, values: {opacity: 0}, ease: "none"}, {offset: 1, values: {opacity: 1}}]});
  for (const [seconds, visibility] of [[3.49, "VISIBLE"], [4, "HIDDEN"], [4.5, "VISIBLE"], [5, "HIDDEN"],
    [5.5, "VISIBLE"], [5.75, "HIDDEN"], [5.99, "VISIBLE"], [5.75, "HIDDEN"], [3.49, "VISIBLE"]] as const) {
    assert.equal(buildTextParityCheckpointPlan(document, seconds, true).expectedTexts[0]!.visibility, visibility);
  }
});

test("DOM appearance measurement multiplies ancestors and verifies opaque overlay nodes", () => {
  const parent = {parentElement: null, opacity: "0.5"}, element = {parentElement: parent, opacity: "0.5", textContent: "Texto"};
  const overlay = {parentElement: null, opacity: "1", right: 100,
    getBoundingClientRect() {return {left: 0, top: 0, right: this.right, bottom: 50};}};
  const context = {limits: policy, document: {getElementById: (id: string) => id === "transition-overlay" ? overlay : element,
    createRange: () => ({selectNodeContents() {}, detach() {}, getBoundingClientRect: () => ({left: 5, top: 5, right: 20, bottom: 20})})},
    getComputedStyle: (node: {opacity: string}) => ({opacity: node.opacity, display: "flex", visibility: "visible",
      transform: "none", clipPath: "none", maskImage: "none", filter: "none", mixBlendMode: "normal",
      borderTopLeftRadius: "0px", borderTopRightRadius: "0px", borderBottomLeftRadius: "0px", borderBottomRightRadius: "0px",
      backgroundColor: "rgb(0, 0, 0)"})};
  const expression = `(${readTextParityDom.toString()})(["native-motion"],100,50,limits,{"native-motion":"VISIBLE"},
    {"native-motion":{"effectiveOpacity":0.25,"opaqueOverlayIds":["transition-overlay"]}})`;
  const row = runInNewContext(expression, context)[0];
  assert.deepEqual(JSON.parse(JSON.stringify(row.presentation)), {effectiveOpacity: 0.25, opaqueOverlayIds: ["transition-overlay"]});
  overlay.opacity = "0.999";
  assert.equal(runInNewContext(expression, context)[0].presentation.opaqueOverlayIds.length, 0);
  overlay.opacity = "1"; overlay.right = 99;
  assert.equal(runInNewContext(expression, context)[0].presentation.opaqueOverlayIds.length, 0);
  overlay.right = 100;
  assert.throws(() => runInNewContext(expression, {...context, limits: {...policy, maximumOverlayAncestorChecksPerCheckpoint: 0}}), /PRESENTATION_LIMIT/);
});

test("appearance capture checks measured opacity and pins the frozen value within a bounded tolerance", async () => {
  const {document} = fixture(); const clip = document.clips.find((entry) => entry.id === "native")!;
  clip.layout.opacity = 0.25;
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  const row = {elementId: "native-motion", text: clip.source.text, left: 10, top: 20, width: 30, height: 40,
    visibility: "VISIBLE", presentation: {effectiveOpacity: 0.25005, opaqueOverlayIds: []}};
  const result = await captureTextParityCheckpoint(client([row]), document, 2, NATIVE_TEXT_APPEARANCE_POLICY);
  assert.equal(result.regions[0]!.presentation!.effectiveOpacity, 0.25);
  await assert.rejects(captureTextParityCheckpoint(client([{...row, presentation: {...row.presentation, effectiveOpacity: 0.5}}]),
    document, 2, NATIVE_TEXT_APPEARANCE_POLICY), /PRESENTATION_MISMATCH/);
  await assert.rejects(captureTextParityCheckpoint(client([{...row, presentation: {...row.presentation, opaqueOverlayIds: ["foreign-overlay"]}}]),
    document, 2, NATIVE_TEXT_APPEARANCE_POLICY), /PRESENTATION_MISMATCH/);
});

test("long valid clip/cue identifiers are not truncated to an invalid short geometry ID", () => {
  const {document, clipId} = fixture("CAPTION", "a".repeat(128));
  const source = document.clips.find((clip) => clip.id === clipId)!.source;
  if (source.type !== "NATIVE_CAPTIONS") throw new Error("Expected captions"); source.cues[0]!.id = "b".repeat(128);
  assert.equal(buildTextParityCheckpointPlan(document, 2).expectedTexts[0]!.elementId.length, 265);
});

test("browser DOM reader is self-contained and rounds/clips transformed text range to canvas", () => {
  const parent = {parentElement: null}, element = {parentElement: parent, textContent: "Árbol\n世界"};
  const rows = runInNewContext(`(${readTextParityDom.toString()})(["native-motion"],100,50,limits)`, {limits: policy,
    document: {getElementById: () => element, createRange: () => ({selectNodeContents() {}, detach() {},
      getBoundingClientRect: () => ({left: -0.2, top: 2.1, right: 101.3, bottom: 20.8})})},
    getComputedStyle: () => ({opacity: "1", display: "flex", visibility: "visible"})});
  assert.equal(rows[0].left, 0); assert.equal(rows[0].top, 2); assert.equal(rows[0].width, 100); assert.equal(rows[0].height, 19);
});

test("capture validates content/identity/geometry and returns hashes only", async () => {
  const {document} = fixture();
  const source = document.clips.find((clip) => clip.id === "native")!.source;
  if (source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  const row = {elementId: "native-motion", text: source.text, left: 10, top: 20, width: 30, height: 40};
  const result = await captureTextParityCheckpoint(client([row]), document, 2);
  assert.equal(result.status, "CAPTURED"); assert.equal(result.regions[0]!.textSha256, hash(source.text));
  assert.ok(!JSON.stringify(result).includes(source.text));
  await assert.rejects(captureTextParityCheckpoint(client([{...row, text: "Otro texto"}]), document, 2), /CONTENT_MISMATCH/);
  await assert.rejects(captureTextParityCheckpoint(client([{...row, elementId: "other"}]), document, 2), /IDENTITIES_INVALID/);
  await assert.rejects(captureTextParityCheckpoint(client([{...row, width: 100000}]), document, 2), /OUTSIDE_CANVAS/);
  await assert.rejects(captureTextParityCheckpoint(client([]), document, 2), /RUNTIME_FAILED/);
  await assert.rejects(captureTextParityCheckpoint(client([], true), document, 2), /RUNTIME_FAILED/);
});

test("DOM reader bounds text/ancestor work and never fabricates geometry for hidden or missing text", () => {
  const evaluate = (element: unknown, style: object, limits = policy) => runInNewContext(
    `(${readTextParityDom.toString()})(["native-motion"],100,50,limits)`, {limits,
      document: {getElementById: () => element, createRange: () => {throw new Error("Must not measure unavailable text");}},
      getComputedStyle: () => style});
  assert.equal(evaluate(null, {}).at(0).unavailable, "ELEMENT_MISSING");
  assert.equal(evaluate({parentElement: null}, {opacity: "0", display: "flex", visibility: "visible"}).at(0).unavailable, "ELEMENT_NOT_VISIBLE");
  assert.equal(evaluate({parentElement: null, textContent: "x".repeat(policy.maximumTextCharactersPerElement + 1)},
    {opacity: "1", display: "flex", visibility: "visible"}).at(0).unavailable, "TEXT_SIZE_INVALID");
});

test("missing/dynamically invisible text remains incomplete instead of disappearing from expected coverage", async () => {
  const {document} = fixture();
  for (const unavailable of ["ELEMENT_MISSING", "ELEMENT_NOT_VISIBLE", "TEXT_OUTSIDE_CANVAS"]) {
    const result = await captureTextParityCheckpoint(client([{elementId: "native-motion", unavailable}]), document, 2);
    assert.equal(result.status, "INCOMPLETE"); assert.equal(result.expectedTexts.length, 1); assert.equal(result.regions.length, 0);
  }
});

test("out-of-canvas DOM text gets an explicit absence probe only with frozen empty unfiltered support", () => {
  const paintPose = buildNativeTextPaintPose("native", {canvas: {width: 100, height: 50},
    layout: {x: -100, y: 0, width: 20, height: 20, rotation: 0}, motion: {x: 0, y: 0, scale: 1, rotation: 0},
    transition: {xPercent: 0, yPercent: 0, clipPath: "none"}}, "blur(0px)");
  const element = {parentElement: null, textContent: "Texto fuera"};
  const presentation = {effectiveOpacity: 1, opaqueOverlayIds: [], paintPose};
  const rectangle = {left: -90, top: 0, right: -80, bottom: 10};
  const context = {limits: policy, presentation, document: {getElementById: () => element,
    createRange: () => ({selectNodeContents() {}, detach() {}, getBoundingClientRect: () => rectangle})},
    getComputedStyle: () => ({opacity: "1", display: "flex", visibility: "visible"})};
  const expression = `(${readTextParityDom.toString()})(["native-motion"],100,50,limits,{"native-motion":"VISIBLE"},{"native-motion":presentation})`;
  const row = runInNewContext(expression, context)[0];
  assert.equal(row.regionKind, "CANVAS_ABSENCE_PROBE");
  assert.deepEqual([row.left, row.top, row.width, row.height], [0, 0, 100, 50]);
  assert.equal(runInNewContext(expression, {...context, presentation: {...presentation, paintPose: undefined}})[0].unavailable, "TEXT_OUTSIDE_CANVAS");
  assert.equal(runInNewContext(expression, {...context, presentation: {...presentation, paintPose: {...paintPose, filter: "blur(1px)"}}})[0].unavailable, "TEXT_OUTSIDE_CANVAS");
  rectangle.left = Number.NaN;
  assert.equal(runInNewContext(expression, context)[0].unavailable, "GEOMETRY_INVALID");
});
