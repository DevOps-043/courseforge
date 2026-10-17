import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { buildNativeTextPaintPose } from "../composition-text-paint-pose";
import { parseTextPaintInset } from "../composition-text-paint-geometry";
import { readNativeTextPaintPoses } from "../qa/composition-text-paint-pose-capture";
import { captureTextParityCheckpoint } from "../qa/composition-text-checkpoint-capture";
import { buildTextParityCheckpointPlan } from "../composition-text-checkpoint-plan";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";
import { compositionConformanceContractSchema } from "../composition-preview-render-conformance";
import { NATIVE_TEXT_GEOMETRY_POLICY, NATIVE_TEXT_APPEARANCE_POLICY } from "../composition-text-parity-contract";
import { createTransitionDocument } from "./composition-transition-test-fixtures";
import { createCompositionNativeOverlay } from "../composition-native-overlay.factory";
import { NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT } from "../composition-document.types";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { resolveSnapshotTextVisibilityPolicy } from "../composition-snapshot-conformance-policy";
import { buildConformanceReferenceSource } from "../composition-conformance-reference.service";
import { hashCompositionDocument } from "../composition-document.service";

function browserFixture() {
  const pose = buildNativeTextPaintPose("native", {canvas: {width: 100, height: 50},
    layout: {x: 10, y: 10, width: 40, height: 20, rotation: 0}, motion: {x: 0, y: 0, scale: 1, rotation: 0},
    transition: {xPercent: 0, yPercent: 0, clipPath: "none"}}, "blur(0px)");
  const style = {perspective: "none", translate: "none", rotate: "none", scale: "none", maskImage: "none", mixBlendMode: "normal",
    transform: "none", filter: "none", clipPath: "none", position: "absolute", overflowX: "hidden", overflowY: "hidden",
    left: "0px", top: "0px", width: "40px", height: "20px", transformOrigin: "0px 0px", boxSizing: "border-box",
    borderTopWidth: "0px", borderRightWidth: "0px", borderBottomWidth: "0px", borderLeftWidth: "0px",
    paddingTop: "0px", paddingRight: "0px", paddingBottom: "0px", paddingLeft: "0px"};
  const root = {parentElement: null, style: {...style, transform: "matrix(1,0,0,1,-50,-25)"},
    getBoundingClientRect: () => ({left: 0, top: 0, width: 100, height: 50, right: 100, bottom: 50})};
  const parent = {parentElement: root, style: {...style, left: "10px", top: "10px"}};
  const motion = {parentElement: parent, style: {...style, transformOrigin: "20px 10px"}};
  const nodes = new Map<string, unknown>([["composition-root", root], ["native", parent], ["native-motion", motion]]);
  class Matrix {
    is2D = true; a: number; b: number; c: number; d: number; e: number; f: number;
    m13 = 0; m14 = 0; m23 = 0; m24 = 0; m31 = 0; m32 = 0; m33 = 1; m34 = 0; m43 = 0; m44 = 1;
    constructor(value?: string) {
      const numbers = value ? value.replace(/^matrix(?:3d)?\(|\)$/g, "").split(",").map(Number) : [1, 0, 0, 1, 0, 0];
      if (numbers.length === 16) {
        this.is2D = false;
        [this.a, this.b, this.c, this.d, this.e, this.f] = [numbers[0]!, numbers[1]!, numbers[4]!, numbers[5]!, numbers[12]!, numbers[13]!];
        [this.m13, this.m14, this.m23, this.m24, this.m31, this.m32, this.m33, this.m34, this.m43, this.m44]
          = [numbers[2]!, numbers[3]!, numbers[6]!, numbers[7]!, numbers[8]!, numbers[9]!, numbers[10]!, numbers[11]!, numbers[14]!, numbers[15]!];
      } else [this.a, this.b, this.c, this.d, this.e, this.f] = numbers as [number, number, number, number, number, number];
    }
  }
  const run = () => runInNewContext(`(${readNativeTextPaintPoses.toString()})(expected,100,50,(${parseTextPaintInset.toString()}),tolerance,64)`, {
    expected: [{elementId: "native-motion", pose}], tolerance: policy.maximumPaintPoseDrift, DOMMatrixReadOnly: Matrix,
    document: {getElementById: (id: string) => nodes.get(id)}, getComputedStyle: (node: {style: object}) => node.style,
  });
  return {pose, root, parent, motion, nodes, run};
}

test("browser pose reader is self-contained and verifies matrices, origins, inset and rooted structure", () => {
  const fixture = browserFixture();
  assert.deepEqual(JSON.parse(JSON.stringify(fixture.run())), [{elementId: "native-motion", verified: true}]);
  fixture.parent.style.clipPath = "inset(0px 0px 0px 0px)";
  assert.equal(fixture.run().length, 1);
  fixture.motion.style.transform = "matrix3d(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1)";
  assert.equal(fixture.run().length, 1);
  fixture.parent.style.left = "10.015px";
  assert.equal(fixture.run().length, 1);
  fixture.parent.style.left = "10.03px";
  assert.throws(fixture.run, /POSE_MISMATCH/);
});

test("changed rotation, inset, origins, independent transforms and filters cannot attest a frozen pose", () => {
  for (const change of [
    {transform: "matrix(0,1,-1,0,0,0)"}, {clipPath: "inset(0 50% 0 0)"}, {transformOrigin: "20px 10px"},
    {translate: "1px"}, {maskImage: "url(mask.png)"}, {filter: "blur(1px)"}, {overflowX: "visible"},
    {paddingLeft: "1px"}, {borderTopWidth: "1px"},
  ]) {
    const fixture = browserFixture(); Object.assign(fixture.parent.style, change);
    assert.throws(fixture.run, /POSE_MISMATCH/);
  }
  const fixture = browserFixture(); fixture.motion.style.transform = "matrix(1.001,0,0,1.001,0,0)";
  assert.throws(fixture.run, /POSE_MISMATCH/);
  fixture.motion.style.transform = "matrix3d(1,0,0.1,0,0,1,0,0,0,0,1,0,0,0,0,1)";
  assert.throws(fixture.run, /POSE_UNSUPPORTED/);
});

test("different viewport scale, missing nodes and unrooted text cannot attest geometry", () => {
  const scaled = browserFixture(); scaled.root.style.transform = "matrix(0.5,0,0,0.5,-50,-25)";
  assert.throws(scaled.run, /ROOT_INVALID/);
  const missing = browserFixture(); missing.nodes.delete("native-motion");
  assert.throws(missing.run, /STRUCTURE_INVALID/);
  const detached = browserFixture(); detached.nodes.set("native", {...detached.parent, parentElement: null});
  assert.throws(detached.run, /STRUCTURE_INVALID/);
});

function documentFixture() {
  const document = createTransitionDocument();
  const {clip, track} = createCompositionNativeOverlay({document, id: "native", kind: "TEXT", playheadSeconds: 1});
  if (track) document.tracks.push(track); document.clips.push(clip);
  document.format = NATIVE_TEXT_COMPOSITION_DOCUMENT_FORMAT;
  return {document, clip};
}

test("geometry is opt-in, frozen from document and cannot appear in an older policy", () => {
  for (const version of [1, 2, 3]) assert.equal(resolveSnapshotTextVisibilityPolicy(version, "true", "true", "true", "true"), undefined);
  for (const flag of [undefined, "false", "TRUE", "1", " true "]) {
    assert.equal(resolveSnapshotTextVisibilityPolicy(4, undefined, undefined, undefined, flag), undefined);
  }
  assert.equal(resolveSnapshotTextVisibilityPolicy(4, "true", "true", "true", "true"), NATIVE_TEXT_GEOMETRY_POLICY);
  const {document} = documentFixture();
  const input = {document, documentHash: "a".repeat(64), assets: [], contractVersion: 4 as const,
    renderProfile: {format: "mp4" as const, fps: 25 as const, quality: "high" as const, resolution: "1080p" as const}};
  const contract = buildSnapshotConformanceContract({...input, visibilityPolicy: NATIVE_TEXT_GEOMETRY_POLICY});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const expected = contract.textParity.checkpoints.flatMap((checkpoint) => checkpoint.expectedTexts)[0]!;
  assert.equal(expected.presentation?.paintPose?.clipId, "native");
  assert.ok(expected.presentation?.paintPose?.support.polygon.length);
  const older = structuredClone(contract); older.textParity.visibilityPolicy = NATIVE_TEXT_APPEARANCE_POLICY;
  assert.equal(compositionConformanceContractSchema.safeParse(older).success, false);
  const missing = structuredClone(contract);
  for (const checkpoint of missing.textParity.checkpoints) for (const text of checkpoint.expectedTexts) delete text.presentation!.paintPose;
  assert.equal(compositionConformanceContractSchema.safeParse(missing).success, false);
  assert.equal(buildTextParityCheckpointPlan(document, 2, NATIVE_TEXT_APPEARANCE_POLICY).expectedTexts[0]!.presentation?.paintPose, undefined);
});

test("capture requires a separate exact pose verification receipt and then pins the frozen pose", async () => {
  const {document, clip} = documentFixture();
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  const expected = buildTextParityCheckpointPlan(document, 2, NATIVE_TEXT_GEOMETRY_POLICY).expectedTexts[0]!;
  const row = {elementId: expected.elementId, text: clip.source.text, left: 10, top: 20, width: 30, height: 40,
    visibility: expected.visibility, presentation: {effectiveOpacity: expected.presentation!.effectiveOpacity, opaqueOverlayIds: []}};
  let count = 0;
  const client = {close() {}, async send(_method: string, params?: Record<string, unknown>) {
    count++;
    return {result: {value: String(params?.expression).includes("readNativeTextPaintPoses")
      ? [{elementId: expected.elementId, verified: true}] : [row]}};
  }};
  const capture = await captureTextParityCheckpoint(client, document, 2, NATIVE_TEXT_GEOMETRY_POLICY);
  assert.equal(count, 2);
  assert.deepEqual(capture.regions[0]!.presentation?.paintPose, expected.presentation!.paintPose);
  await assert.rejects(captureTextParityCheckpoint({close() {}, async send() {return {result: {value: []}};}},
    document, 2, NATIVE_TEXT_GEOMETRY_POLICY), /PAINT_CAPTURE_FAILED/);
});

test("source producer independently rejects a geometrically altered plan despite a correct document hash", async () => {
  const {document} = documentFixture();
  const contract = buildSnapshotConformanceContract({document, documentHash: hashCompositionDocument(document), assets: [], contractVersion: 4,
    visibilityPolicy: NATIVE_TEXT_GEOMETRY_POLICY, renderProfile: {format: "mp4", fps: 25, quality: "high", resolution: "1080p"}});
  if (contract.schemaVersion !== 4) throw new Error("Expected v4");
  const text = contract.textParity.checkpoints.flatMap((checkpoint) => checkpoint.expectedTexts)[0]!;
  text.presentation!.paintPose!.left += 1;
  await assert.rejects(buildConformanceReferenceSource({document, contract, assets: []}), /TEXT_PLAN_MISMATCH/);
});

test("capture pins an offcanvas absence probe and rejects partial or legacy probes", async () => {
  const {document, clip} = documentFixture();
  clip.layout.x = -clip.layout.width - 100;
  if (clip.source.type !== "NATIVE_TEXT") throw new Error("Expected text");
  const expected = buildTextParityCheckpointPlan(document, 2, NATIVE_TEXT_GEOMETRY_POLICY).expectedTexts[0]!;
  assert.equal(expected.presentation!.paintPose!.support.empty, true);
  const row = {elementId: expected.elementId, text: clip.source.text, left: 0, top: 0,
    width: document.canvas.width, height: document.canvas.height, visibility: expected.visibility,
    regionKind: "CANVAS_ABSENCE_PROBE", presentation: {effectiveOpacity: 1, opaqueOverlayIds: []}};
  const client = (capturedRow: unknown) => ({close() {}, async send(_method: string, params?: Record<string, unknown>) {
    return {result: {value: String(params?.expression).includes("readNativeTextPaintPoses")
      ? [{elementId: expected.elementId, verified: true}] : [capturedRow]}};
  }});
  const captured = await captureTextParityCheckpoint(client(row), document, 2, NATIVE_TEXT_GEOMETRY_POLICY);
  assert.equal(captured.status, "CAPTURED");
  assert.equal(captured.regions[0]!.regionKind, "CANVAS_ABSENCE_PROBE");
  await assert.rejects(captureTextParityCheckpoint(client({...row, width: row.width - 1}), document, 2, NATIVE_TEXT_GEOMETRY_POLICY), /ABSENCE_PROBE_INVALID/);
  await assert.rejects(captureTextParityCheckpoint(client(row), document, 2, NATIVE_TEXT_APPEARANCE_POLICY), /ABSENCE_PROBE_INVALID/);
});
