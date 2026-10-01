import { z } from "zod";
import { buildTextParityCheckpointPlan, hashTextParityContent as textHash } from "../composition-text-checkpoint-plan";
export { buildTextParityCheckpointPlan } from "../composition-text-checkpoint-plan";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { textParityRegionsSchema } from "./composition-text-region-comparison";
import { textPresentationSchema, type NativeTextVisibilityPolicy, type TextPresentation } from "../composition-text-parity-contract";
import type { CompositionQaCdpClient } from "./composition-qa-browser";
import { verifyNativeTextPaintPoses } from "./composition-text-paint-pose-capture";

/** Self-contained browser read: no mutations, CSS overrides, fonts injection, OCR or remote requests. */
export function readTextParityDom(elementIds: string[], width: number, height: number, limits: {
  maximumAncestorDepth: number; maximumTextCharactersPerElement: number; maximumTextCharactersPerCheckpoint: number;
  maximumOverlayAncestorChecksPerCheckpoint?: number;
}, visibilityPlan?: Record<string, "VISIBLE" | "HIDDEN">,
presentationPlan?: Record<string, TextPresentation>) {
  let totalTextCharacters = 0;
  let overlayAncestorChecks = 0;
  return elementIds.map((elementId) => {
    const element = document.getElementById(elementId);
    if (!element) return {elementId, unavailable: "ELEMENT_MISSING" as const};
    let ancestor: Element | null = element;
    let depth = 0;
    let invisible = false;
    let effectiveOpacity = 1;
    while (ancestor) {
      if (++depth > limits.maximumAncestorDepth) return {elementId, unavailable: "GEOMETRY_INVALID" as const};
      const style = getComputedStyle(ancestor);
      const opacity = Number(style.opacity);
      if (!Number.isFinite(opacity)) return {elementId, unavailable: "GEOMETRY_INVALID" as const};
      effectiveOpacity *= Math.min(1, Math.max(0, opacity));
      if (opacity <= 0 || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") {
        if (!visibilityPlan) return {elementId, unavailable: "ELEMENT_NOT_VISIBLE" as const};
        invisible = true;
      }
      ancestor = ancestor.parentElement;
    }
    const text = element.textContent ?? "";
    totalTextCharacters += text.length;
    if (text.length > limits.maximumTextCharactersPerElement || totalTextCharacters > limits.maximumTextCharactersPerCheckpoint) {
      return {elementId, unavailable: "TEXT_SIZE_INVALID" as const};
    }
    const range = document.createRange(); range.selectNodeContents(element);
    const rect = range.getBoundingClientRect(); range.detach();
    if (![rect.left, rect.top, rect.right, rect.bottom].every(Number.isFinite)) return {elementId, unavailable: "GEOMETRY_INVALID" as const};
    let left = Math.max(0, Math.floor(rect.left)), top = Math.max(0, Math.floor(rect.top));
    let right = Math.min(width, Math.ceil(rect.right)), bottom = Math.min(height, Math.ceil(rect.bottom));
    let regionKind: "CANVAS_ABSENCE_PROBE" | undefined;
    if (right <= left || bottom <= top) {
      const pose = presentationPlan?.[elementId]?.paintPose;
      if (!pose?.support.empty || pose.filter !== "blur(0px)") return {elementId, unavailable: "TEXT_OUTSIDE_CANVAS" as const};
      left = 0; top = 0; right = width; bottom = height;
      regionKind = "CANVAS_ABSENCE_PROBE";
    }
    let presentation;
    if (presentationPlan) {
      const opaqueOverlayIds = (presentationPlan[elementId]?.opaqueOverlayIds ?? []).filter((id) => {
        let overlay: Element | null = document.getElementById(id);
        let overlayOpacity = 1, overlayDepth = 0;
        if (!overlay) return false;
        const overlayStyle = getComputedStyle(overlay);
        const overlayRect = overlay.getBoundingClientRect();
        if (![overlayRect.left, overlayRect.top, overlayRect.right, overlayRect.bottom].every(Number.isFinite)
          || overlayRect.left > 0 || overlayRect.top > 0 || overlayRect.right < width || overlayRect.bottom < height
          || overlayStyle.clipPath !== "none" || overlayStyle.maskImage !== "none" || overlayStyle.filter !== "none"
          || overlayStyle.mixBlendMode !== "normal"
          || [overlayStyle.borderTopLeftRadius, overlayStyle.borderTopRightRadius, overlayStyle.borderBottomLeftRadius,
            overlayStyle.borderBottomRightRadius].some((radius) => radius !== "0px")
          || !/^rgb\(\s*[\d.]+[, ]+[\d.]+[, ]+[\d.]+\s*\)$/.test(overlayStyle.backgroundColor)) return false;
        while (overlay) {
          if (++overlayAncestorChecks > (limits.maximumOverlayAncestorChecksPerCheckpoint ?? 0)) throw new Error("CONFORMANCE_TEXT_PRESENTATION_LIMIT");
          if (++overlayDepth > limits.maximumAncestorDepth) return false;
          const style = getComputedStyle(overlay), opacity = Number(style.opacity);
          if (!Number.isFinite(opacity) || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse"
            || style.transform !== "none" || style.clipPath !== "none" || style.maskImage !== "none") return false;
          overlayOpacity *= Math.min(1, Math.max(0, opacity));
          overlay = overlay.parentElement;
        }
        return overlayOpacity >= 1;
      });
      presentation = {effectiveOpacity, opaqueOverlayIds};
    }
    return {elementId, text, left, top, width: right - left, height: bottom - top,
      ...(regionKind ? {regionKind} : {}),
      ...(visibilityPlan ? {visibility: invisible ? "HIDDEN" as const : "VISIBLE" as const} : {}),
      ...(presentation ? {presentation} : {})};
  });
}

const domRowSchema = z.union([
  z.object({elementId: z.string().min(1).max(280), unavailable: z.enum(["ELEMENT_MISSING", "ELEMENT_NOT_VISIBLE", "TEXT_SIZE_INVALID", "GEOMETRY_INVALID", "TEXT_OUTSIDE_CANVAS"])}).strict(),
  z.object({elementId: z.string().min(1).max(280), text: z.string().max(policy.maximumTextCharactersPerElement), left: z.number().int().nonnegative(),
    top: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive(),
    visibility: z.enum(["VISIBLE", "HIDDEN"]).optional(), presentation: textPresentationSchema.optional(),
    regionKind: z.literal("CANVAS_ABSENCE_PROBE").optional()}).strict(),
]);

/** Caller must supply the verified frozen document and an already settled checkpoint in its isolated browser. */
export async function captureTextParityCheckpoint(client: CompositionQaCdpClient, input: unknown, seconds: number, motionVisibility: boolean | NativeTextVisibilityPolicy = false) {
  const plan = buildTextParityCheckpointPlan(input, seconds, motionVisibility);
  const visibilityPlan = motionVisibility ? Object.fromEntries(plan.expectedTexts.map((text) => [text.elementId, text.visibility])) : undefined;
  const presentations = plan.expectedTexts.filter((text) => text.presentation !== undefined);
  const paintPoses = plan.expectedTexts.flatMap((text) => text.presentation?.paintPose
    ? [{elementId: text.elementId, pose: text.presentation.paintPose}] : []);
  await verifyNativeTextPaintPoses(client, paintPoses, plan.width, plan.height, policy.maximumPaintPoseDrift, policy.maximumAncestorDepth);
  const presentationPlan = presentations.length ? Object.fromEntries(presentations.map((text) => [text.elementId, text.presentation])) : undefined;
  const response = await client.send("Runtime.evaluate", {awaitPromise: true, returnByValue: true,
    expression: `(${readTextParityDom.toString()})(${JSON.stringify(plan.expectedTexts.map((text) => text.elementId))},${plan.width},${plan.height},${JSON.stringify({
      maximumAncestorDepth: policy.maximumAncestorDepth, maximumTextCharactersPerElement: policy.maximumTextCharactersPerElement,
      maximumTextCharactersPerCheckpoint: policy.maximumTextCharactersPerCheckpoint,
      maximumOverlayAncestorChecksPerCheckpoint: policy.maximumOverlayAncestorChecksPerCheckpoint})},${JSON.stringify(visibilityPlan) ?? "undefined"},${JSON.stringify(presentationPlan) ?? "undefined"})`});
  const raw = (response.result as {value?: unknown} | undefined)?.value;
  if (response.exceptionDetails || !Array.isArray(raw) || raw.length !== plan.expectedTexts.length) throw new Error("CONFORMANCE_TEXT_CAPTURE_RUNTIME_FAILED");
  const rows = z.array(domRowSchema).max(policy.maximumRegions).parse(raw);
  if (rows.reduce((characters, row) => characters + ("text" in row ? row.text.length : 0), 0) > policy.maximumTextCharactersPerCheckpoint) {
    throw new Error("CONFORMANCE_TEXT_CAPTURE_SIZE_LIMIT");
  }
  const expected = new Map(plan.expectedTexts.map((text) => [text.elementId, text.textSha256]));
  const expectedVisibility = new Map(plan.expectedTexts.map((text) => [text.elementId, text.visibility]));
  const expectedPresentation = new Map(plan.expectedTexts.map((text) => [text.elementId, text.presentation]));
  if (new Set(rows.map((row) => row.elementId)).size !== rows.length || rows.some((row) => !expected.has(row.elementId))) {
    throw new Error("CONFORMANCE_TEXT_CAPTURE_IDENTITIES_INVALID");
  }
  const regions = textParityRegionsSchema.parse(rows.flatMap((row) => {
    if ("unavailable" in row) return [];
    const textSha256 = textHash(row.text);
    if (textSha256 !== expected.get(row.elementId)) throw new Error("CONFORMANCE_TEXT_CONTENT_MISMATCH");
    if (row.visibility !== expectedVisibility.get(row.elementId)) throw new Error("CONFORMANCE_TEXT_VISIBILITY_MISMATCH");
    const presentation = expectedPresentation.get(row.elementId);
    if (Boolean(row.presentation) !== Boolean(presentation) || (presentation && row.presentation
      && (Math.abs(row.presentation.effectiveOpacity - presentation.effectiveOpacity) > policy.maximumOpacityDrift
        || JSON.stringify(row.presentation.opaqueOverlayIds) !== JSON.stringify(presentation.opaqueOverlayIds)))) {
      throw new Error("CONFORMANCE_TEXT_PRESENTATION_MISMATCH");
    }
    if (row.left + row.width > plan.width || row.top + row.height > plan.height) throw new Error("CONFORMANCE_TEXT_REGION_OUTSIDE_CANVAS");
    if (row.regionKind && (row.left !== 0 || row.top !== 0 || row.width !== plan.width || row.height !== plan.height
      || !presentation?.paintPose?.support.empty || presentation.paintPose.filter !== "blur(0px)")) {
      throw new Error("CONFORMANCE_TEXT_ABSENCE_PROBE_INVALID");
    }
    // Plain text is transient; only its hash is returned or persisted.
    return [{elementId: row.elementId, textSha256, left: row.left, top: row.top, width: row.width, height: row.height,
      ...(row.regionKind ? {regionKind: row.regionKind} : {}),
      ...(row.visibility ? {visibility: row.visibility} : {}), ...(presentation ? {presentation} : {})}];
  }));
  const unavailable = rows.flatMap((row) => "unavailable" in row ? [{elementId: row.elementId, reason: row.unavailable}] : []);
  return {policy: policy.id, status: unavailable.length ? "INCOMPLETE" as const : "CAPTURED" as const,
    expectedTexts: plan.expectedTexts, regions, unavailable};
}
