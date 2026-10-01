import { parseTextPaintInset } from "../composition-text-paint-geometry";
import type { NativeTextPaintPose } from "../composition-text-paint-pose";
import type { CompositionQaCdpClient } from "./composition-qa-browser";

/** Self-contained read-only browser verifier. The inset parser is embedded unchanged. */
export function readNativeTextPaintPoses(expected: Array<{elementId: string; pose: NativeTextPaintPose}>, width: number, height: number,
  insetParser: typeof parseTextPaintInset, tolerance: number, maximumAncestorDepth: number) {
  const near = (first: number, second: number) => Number.isFinite(first) && Math.abs(first - second) <= tolerance;
  const pixels = (value: string) => /^-?(?:\d+(?:\.\d+)?|\.\d+)px$/.test(value) ? Number(value.slice(0, -2)) : Number.NaN;
  const matrix = (transform: string) => {
    const result = new DOMMatrixReadOnly(transform === "none" ? undefined : transform);
    // GSAP may serialize an affine 2D pose as matrix3d; reject actual depth/perspective, not its encoding.
    if (!result.is2D && (![result.m13, result.m14, result.m23, result.m24, result.m31, result.m32, result.m34, result.m43]
      .every((value) => value === 0) || result.m33 !== 1 || result.m44 !== 1)) {
      throw new Error("CONFORMANCE_TEXT_PAINT_POSE_UNSUPPORTED");
    }
    return [result.a, result.b, result.c, result.d, result.e, result.f];
  };
  const origins = (value: string, x: number, y: number) => {
    const components = value.split(/\s+/);
    return components.length >= 2 && near(pixels(components[0]!), x) && near(pixels(components[1]!), y)
      && (components.length === 2 || (components.length === 3 && near(pixels(components[2]!), 0)));
  };
  const ordinaryTransform = (style: CSSStyleDeclaration) => style.perspective === "none" && style.translate === "none"
    && style.rotate === "none" && style.scale === "none";
  const ordinaryMask = (style: CSSStyleDeclaration) => style.maskImage === "none" && style.mixBlendMode === "normal";
  const zeroBorder = (style: CSSStyleDeclaration) => [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth,
    style.borderLeftWidth].every((value) => near(pixels(value), 0));
  const zeroPadding = (style: CSSStyleDeclaration) => [style.paddingTop, style.paddingRight, style.paddingBottom,
    style.paddingLeft].every((value) => near(pixels(value), 0));
  const root = document.getElementById("composition-root");
  if (!root) throw new Error("CONFORMANCE_TEXT_PAINT_ROOT_INVALID");
  const rootStyle = getComputedStyle(root), rootRect = root.getBoundingClientRect(), rootMatrix = matrix(rootStyle.transform);
  if (!near(rootRect.left, 0) || !near(rootRect.top, 0) || !near(rootRect.width, width) || !near(rootRect.height, height)
    || !ordinaryTransform(rootStyle) || !ordinaryMask(rootStyle) || !zeroBorder(rootStyle) || !zeroPadding(rootStyle)
    || rootStyle.filter !== "none" || rootStyle.clipPath !== "none"
    || !rootMatrix.slice(0, 4).every((value, index) => Math.abs(value - [1, 0, 0, 1][index]!) <= tolerance / Math.max(width, height))) {
    throw new Error("CONFORMANCE_TEXT_PAINT_ROOT_INVALID");
  }
  let rootAncestor = root.parentElement, rootDepth = 0;
  while (rootAncestor) {
    if (++rootDepth > maximumAncestorDepth) throw new Error("CONFORMANCE_TEXT_PAINT_ROOT_INVALID");
    const style = getComputedStyle(rootAncestor), rect = rootAncestor.getBoundingClientRect();
    if (!ordinaryTransform(style) || !ordinaryMask(style) || style.transform !== "none" || style.filter !== "none" || style.clipPath !== "none"
      || ((style.overflowX !== "visible" || style.overflowY !== "visible")
        && (rect.left > tolerance || rect.top > tolerance || rect.right < width - tolerance || rect.bottom < height - tolerance))) {
      throw new Error("CONFORMANCE_TEXT_PAINT_ROOT_INVALID");
    }
    rootAncestor = rootAncestor.parentElement;
  }
  return expected.map(({elementId, pose}) => {
    const parent = document.getElementById(pose.clipId), motion = document.getElementById(`${pose.clipId}-motion`);
    const element = document.getElementById(elementId);
    if (!parent || !motion || !element || motion.parentElement !== parent || (element !== motion && element.parentElement !== motion)) {
      throw new Error("CONFORMANCE_TEXT_PAINT_STRUCTURE_INVALID");
    }
    const parentStyle = getComputedStyle(parent), motionStyle = getComputedStyle(motion);
    const parentMatrix = matrix(parentStyle.transform), motionMatrix = matrix(motionStyle.transform);
    const inset = insetParser(parentStyle.clipPath);
    const filter = /^blur\((\d+(?:\.\d+)?|\.\d+)px\)$/.exec(parentStyle.filter);
    const expectedFilter = /^blur\((\d+(?:\.\d+)?|\.\d+)px\)$/.exec(pose.filter)!;
    const coefficientTolerance = tolerance / Math.max(pose.width, pose.height);
    const actualBlur = parentStyle.filter === "none" ? 0 : filter ? Number(filter[1]) : Number.NaN;
    if (![parentStyle, motionStyle].every((style) => ordinaryTransform(style) && ordinaryMask(style))
      || parentStyle.position !== "absolute" || parentStyle.overflowX !== "hidden" || parentStyle.overflowY !== "hidden"
      || !zeroBorder(parentStyle) || !zeroPadding(parentStyle) || !zeroBorder(motionStyle)
      || (motionStyle.boxSizing !== "border-box" && !zeroPadding(motionStyle))
      || !near(pixels(parentStyle.left), pose.left) || !near(pixels(parentStyle.top), pose.top)
      || !near(pixels(parentStyle.width), pose.width) || !near(pixels(parentStyle.height), pose.height)
      || !origins(parentStyle.transformOrigin, 0, 0)
      || !near(pixels(motionStyle.width), pose.width) || !near(pixels(motionStyle.height), pose.height)
      || !near(pixels(motionStyle.left), 0) || !near(pixels(motionStyle.top), 0)
      || !origins(motionStyle.transformOrigin, pose.width / 2, pose.height / 2)
      || motionStyle.filter !== "none" || motionStyle.clipPath !== "none"
      || !near(actualBlur, Number(expectedFilter[1]))
      || !parentMatrix.every((value, index) => Number.isFinite(value) && Math.abs(value - pose.parentMatrix[index]!) <= (index < 4 ? coefficientTolerance : tolerance))
      || !motionMatrix.every((value, index) => Number.isFinite(value) && Math.abs(value - pose.motionMatrix[index]!) <= (index < 4 ? coefficientTolerance : tolerance))
      || !inset.every((value, index) => Number.isFinite(value) && Math.abs(value - pose.inset[index]!) <= coefficientTolerance)) {
      throw new Error("CONFORMANCE_TEXT_PAINT_POSE_MISMATCH");
    }
    if (element !== motion) {
      const cueStyle = getComputedStyle(element);
      if (!ordinaryTransform(cueStyle) || !ordinaryMask(cueStyle) || cueStyle.transform !== "none"
        || cueStyle.filter !== "none" || cueStyle.clipPath !== "none" || !zeroBorder(cueStyle) || cueStyle.boxSizing !== "border-box"
        || cueStyle.overflowX !== "hidden" || cueStyle.overflowY !== "hidden"
        || !near(pixels(cueStyle.left), 0) || !near(pixels(cueStyle.top), 0)
        || !near(pixels(cueStyle.width), pose.width) || !near(pixels(cueStyle.height), pose.height)) {
        throw new Error("CONFORMANCE_TEXT_PAINT_POSE_MISMATCH");
      }
    }
    let ancestor = parent.parentElement, depth = 0;
    while (ancestor && ancestor !== root) {
      if (++depth > maximumAncestorDepth) throw new Error("CONFORMANCE_TEXT_PAINT_STRUCTURE_INVALID");
      const style = getComputedStyle(ancestor);
      if (!ordinaryTransform(style) || !ordinaryMask(style) || style.transform !== "none" || style.filter !== "none"
        || style.clipPath !== "none" || style.overflowX !== "visible" || style.overflowY !== "visible") {
        throw new Error("CONFORMANCE_TEXT_PAINT_STRUCTURE_INVALID");
      }
      ancestor = ancestor.parentElement;
    }
    if (ancestor !== root) throw new Error("CONFORMANCE_TEXT_PAINT_STRUCTURE_INVALID");
    return {elementId, verified: true as const};
  });
}

export async function verifyNativeTextPaintPoses(client: CompositionQaCdpClient,
  expected: Array<{elementId: string; pose: NativeTextPaintPose}>, width: number, height: number, tolerance: number, maximumAncestorDepth: number) {
  if (!expected.length) return;
  const response = await client.send("Runtime.evaluate", {awaitPromise: true, returnByValue: true,
    expression: `(${readNativeTextPaintPoses.toString()})(${JSON.stringify(expected)},${width},${height},(${parseTextPaintInset.toString()}),${tolerance},${maximumAncestorDepth})`});
  const actual = (response.result as {value?: unknown} | undefined)?.value;
  if (response.exceptionDetails || JSON.stringify(actual) !== JSON.stringify(expected.map(({elementId}) => ({elementId, verified: true})))) {
    throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_FAILED");
  }
}
