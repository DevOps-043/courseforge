import assert from "node:assert/strict";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { gsap } from "gsap";
import { scheduleCompositionMotion } from "../composition-motion-timeline";
import { compositionMotionRuntimeSchema } from "../composition-motion-runtime";
import { compositionMotionSchema } from "../composition-motion.types";

function runtime(ease = "none", loop = false) {
  return compositionMotionRuntimeSchema.parse([{id: "fade", targetId: "native-motion", start: 1, duration: loop ? 2.5 : 1,
    keyframes: loop ? [{offset: 0, values: {opacity: 1}}, {offset: 0.5, values: {opacity: 0}, ease}, {offset: 1, values: {opacity: 1}}]
      : [{offset: 0, values: {opacity: 0}}, {offset: 1, values: {opacity: 1}, ease}],
    ...(loop ? {loop: {mode: "FINITE", cycleDurationSeconds: 1}} : {})}]);
}

test("shared motion scheduler preserves exact fade boundaries and reverse seeks", () => {
  const pose = {opacity: 1};
  const timeline = gsap.timeline({paused: true});
  try {
    scheduleCompositionMotion(timeline, runtime(), () => pose);
    for (const [seconds, expected] of [[0, 1], [1, 0], [1.5, 0.5], [2, 1], [1.5, 0.5], [1, 0], [0, 1]]) {
      timeline.time(seconds!);
      assert.equal(pose.opacity, expected);
    }
  } finally { timeline.kill(); }
});

test("motion defaults allocate independent animation arrays per document", () => {
  const first = compositionMotionSchema.parse(undefined);
  const second = compositionMotionSchema.parse(undefined);
  assert.notEqual(first.animations, second.animations);
  first.animations.push({id: "hide", origin: "USER", propertyGroup: "OPACITY", target: {clipId: "native", part: "CONTENT"},
    timing: {anchor: "CLIP_START", offsetSeconds: 0, durationSeconds: 1},
    keyframes: [{offset: 0, values: {opacity: 0}}, {offset: 1, values: {opacity: 0}}]});
  assert.equal(second.animations.length, 0);
  assert.equal(compositionMotionSchema.parse(undefined).animations.length, 0);
});

test("finite full and partial loops return to neutral at the exact end", () => {
  const pose = {opacity: 1};
  const timeline = gsap.timeline({paused: true});
  try {
    scheduleCompositionMotion(timeline, runtime("none", true), () => pose);
    for (const [seconds, expected] of [[1, 1], [1.5, 0], [2, 1], [2.5, 0], [3, 1], [3.25, 0], [3.5, 1], [3.25, 0]]) {
      timeline.time(seconds!);
      assert.equal(pose.opacity, expected);
    }
  } finally { timeline.kill(); }
});

test("GSAP easing is used directly, including step and power curves", () => {
  for (const ease of ["steps(1)", "power2.in", "power3.out", "back.out(1.4)"]) {
    const pose = {opacity: 1}; const timeline = gsap.timeline({paused: true});
    try {
      scheduleCompositionMotion(timeline, runtime(ease), () => pose);
      timeline.time(1.25);
      assert.ok(Math.abs(pose.opacity - gsap.parseEase(ease)(0.25)) < 0.000001);
    } finally { timeline.kill(); }
  }
});

test("embedded function is self-contained and schedules identical browser/server operations", () => {
  const operations: unknown[] = [];
  const embeddedOperations: unknown[] = [];
  const adapter = (rows: unknown[]) => ({
    set(target: object, values: object, position: number) {rows.push(["set", target, values, position]);},
    to(target: object, values: object, position: number) {rows.push(["to", target, values, position]);},
  });
  const target = {opacity: 1}; const animations = runtime("power1.inOut", true);
  scheduleCompositionMotion(adapter(operations), animations, () => target);
  runInNewContext(`(${scheduleCompositionMotion.toString()})(timeline, animations, resolveTarget)`, {
    timeline: adapter(embeddedOperations), animations, resolveTarget: () => target});
  assert.equal(JSON.stringify(embeddedOperations), JSON.stringify(operations));
  scheduleCompositionMotion(adapter(operations), animations, () => null);
  assert.equal(operations.length, 3);
});
