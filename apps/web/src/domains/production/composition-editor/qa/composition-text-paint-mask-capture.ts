import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import { captureCompositionQaScreenshot, type CompositionQaCdpClient } from "./composition-qa-browser";
import { deriveTextPaintMasks } from "./composition-text-paint-mask-derivation";
import { textCheckpointEvidenceSchema } from "./composition-text-parity-evidence";
import { NATIVE_TEXT_PAINT_MASK_POLICY } from "../composition-text-parity-contract";
import { TEXT_PAINT_REGION_EXPANSION_POLICY } from "../composition-text-parity-policy";

const MAX_PNG_BYTES = policy.maximumPaintCapturePngBytes;
const MAX_SUPPRESSION_NODES = 4096;
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Self-contained CDP function. Color/currentColor surfaces must not change with text fill. */
export function setNativeTextPaintSuppression(elementIds: string[], token: string, maximumNodes: number) {
  if (document.getElementById(token)) throw new Error("CONFORMANCE_TEXT_PAINT_TOKEN_COLLISION");
  const elements = elementIds.map((id) => {
    const matches = document.querySelectorAll(`[id="${CSS.escape(id)}"]`);
    return matches.length === 1 ? matches[0]! : null;
  });
  if (elements.some((element) => !element || !element.matches(".composition-native-text,.composition-caption-cue,.composition-caption-word")))
    throw new Error("CONFORMANCE_TEXT_PAINT_TARGET_INVALID");
  const nodes = new Set<Element>();
  for (const element of elements) {
    nodes.add(element!);
    if (nodes.size > maximumNodes) throw new Error("CONFORMANCE_TEXT_PAINT_TARGET_LIMIT");
    for (const descendant of element!.querySelectorAll("*")) {
      nodes.add(descendant);
      if (nodes.size > maximumNodes) throw new Error("CONFORMANCE_TEXT_PAINT_TARGET_LIMIT");
    }
  }
  if ([...nodes].some(node => node.namespaceURI !== "http://www.w3.org/1999/xhtml"))
    throw new Error("CONFORMANCE_TEXT_PAINT_TARGET_UNSUPPORTED");
  // Browser-side snapshots are deliberately bounded and never retained as evidence.
  const changedProperties = new Set(["-webkit-text-fill-color", "-webkit-text-stroke-color", "text-shadow", "caret-color"]);
  const maximumPropertiesPerNode = 1024, maximumPropertyCharacters = 8192, maximumSnapshotCharacters = 1024 * 1024;
  let retainedCharacters = 0;
  const originals = new Map([...nodes].map(node => {
    const computed = getComputedStyle(node), bounds = node.getBoundingClientRect();
    const propertyNames = Array.from(computed).filter(name => !changedProperties.has(name));
    if (propertyNames.length > maximumPropertiesPerNode) throw new Error("CONFORMANCE_TEXT_PAINT_STYLE_LIMIT");
    const properties = propertyNames.map(name => {
      const value = computed.getPropertyValue(name);
      retainedCharacters += name.length + value.length;
      if (value.length > maximumPropertyCharacters || retainedCharacters > maximumSnapshotCharacters)
        throw new Error("CONFORMANCE_TEXT_PAINT_STYLE_LIMIT");
      return [name, value] as const;
    });
    retainedCharacters += node.textContent?.length ?? 0;
    if (retainedCharacters > maximumSnapshotCharacters) throw new Error("CONFORMANCE_TEXT_PAINT_STYLE_LIMIT");
    return [node, {properties, text: node.textContent, children: Array.from(node.childNodes),
      bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom]}] as const;
  }));
  const style = document.createElement("style"); style.id = token;
  style.dataset.conformancePaintSuppression = token;
  style.textContent = elementIds.flatMap((id) => [`#${CSS.escape(id)}`, `#${CSS.escape(id)} *`]).join(",")
    + "{-webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;}";
  document.head.appendChild(style);
  const transparent = (value: string) => /^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*0\s*\)$/.test(value);
  for (const node of nodes) {
    const computed = getComputedStyle(node);
    if (!transparent(computed.webkitTextFillColor)
      || !transparent(computed.webkitTextStrokeColor) || computed.textShadow !== "none")
      throw new Error("CONFORMANCE_TEXT_PAINT_SUPPRESSION_NOT_EFFECTIVE");
    const before = originals.get(node)!, bounds = node.getBoundingClientRect();
    if (node.textContent !== before.text || node.childNodes.length !== before.children.length
      || before.children.some((child, position) => node.childNodes[position] !== child)
      || [bounds.left, bounds.top, bounds.right, bounds.bottom].some((value, position) => value !== before.bounds[position])
      || before.properties.some(([name, value]) => computed.getPropertyValue(name) !== value))
      throw new Error("CONFORMANCE_TEXT_PAINT_NON_TEXT_CHANGE");
  }
  return true;
}

export function removeNativeTextPaintSuppression(token: string) {
  const style = document.getElementById(token);
  if (!style) return true;
  if (style.tagName !== "STYLE" || (style as HTMLElement).dataset.conformancePaintSuppression !== token)
    throw new Error("CONFORMANCE_TEXT_PAINT_RESTORE_INVALID");
  style.remove(); return true;
}

async function evaluateMutation(client: CompositionQaCdpClient, expression: string) {
  const response = await client.send("Runtime.evaluate", {expression, returnByValue: true, awaitPromise: true});
  if (response.exceptionDetails || (response.result as {value?: unknown} | undefined)?.value !== true)
    throw new Error("CONFORMANCE_TEXT_PAINT_SUPPRESSION_FAILED");
}

/** Caller owns a settled, isolated preview. Even a failed suppression must attempt removal and verify restoration. */
export async function captureNativeTextSuppressedFrame(client: CompositionQaCdpClient,
  elementIds: string[], paintedPng: Uint8Array, screenshot = captureCompositionQaScreenshot,
  suppress: typeof setNativeTextPaintSuppression = setNativeTextPaintSuppression) {
  const ids = z.array(z.string().min(1).max(280)).min(1).max(policy.maximumRegions).parse(elementIds);
  if (new Set(ids).size !== ids.length || paintedPng.length === 0 || paintedPng.length > MAX_PNG_BYTES)
    throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_INVALID");
  const originalHash = hash(paintedPng), token = `conformance-paint-${randomUUID()}`;
  try {
    await evaluateMutation(client, `(${suppress.toString()})(${JSON.stringify(ids)},${JSON.stringify(token)},${MAX_SUPPRESSION_NODES})`);
    const suppressed = await screenshot(client);
    if (!suppressed.length || suppressed.length > MAX_PNG_BYTES) throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
    return {suppressedPng: suppressed, paintedPngSha256: originalHash, suppressedPngSha256: hash(suppressed)};
  } catch {
    throw new Error("CONFORMANCE_TEXT_PAINT_SUPPRESSION_FAILED");
  } finally {
    try {
      await evaluateMutation(client, `(${removeNativeTextPaintSuppression.toString()})(${JSON.stringify(token)})`);
      const restored = await screenshot(client);
      if (!restored.length || restored.length > MAX_PNG_BYTES || hash(restored) !== originalHash)
        throw new Error("CONFORMANCE_TEXT_PAINT_RESTORE_FAILED");
    } catch { throw new Error("CONFORMANCE_TEXT_PAINT_RESTORE_FAILED"); }
  }
}

/** Attaches supplemental masks to the same checkpoint witness; full-ROI parity remains mandatory. */
export async function captureTextPaintMasks(client: CompositionQaCdpClient, input: {
  checkpoint: z.infer<typeof textCheckpointEvidenceSchema>; paintedPng: Uint8Array; width: number; height: number;
}, screenshot = captureCompositionQaScreenshot, retainSuppressed?: (png: Uint8Array) => Promise<void>) {
  const checkpoint = textCheckpointEvidenceSchema.parse(input.checkpoint);
  if (!input.paintedPng.length || input.paintedPng.length > MAX_PNG_BYTES)
    throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
  const paintedPng = Buffer.from(input.paintedPng);
  const regions = checkpoint.regions.filter((region) => !region.regionKind);
  if (!regions.length || checkpoint.status !== "CAPTURED") return checkpoint;
  if (!Number.isSafeInteger(input.width) || input.width <= 0 || !Number.isSafeInteger(input.height) || input.height <= 0
    || input.width * input.height > policy.maximumFramePixels
    || regions.reduce((pixels, region) => pixels + region.width * region.height, 0) > policy.maximumComparedPixels
    || regions.some((region) => region.left + region.width > input.width || region.top + region.height > input.height))
    throw new Error("CONFORMANCE_TEXT_PAINT_CAPTURE_LIMIT");
  const captured = await captureNativeTextSuppressedFrame(client, regions.map((region) => region.elementId), paintedPng, screenshot);
  const masks = new Map((await deriveTextPaintMasks({checkpoint, paintedPng, suppressedPng: captured.suppressedPng,
    width: input.width, height: input.height, expandRegions: true})).map((derived) => [derived.elementId, derived]));
  if (retainSuppressed) await retainSuppressed(captured.suppressedPng);
  return textCheckpointEvidenceSchema.parse({...checkpoint,
    paintMaskCapture: {policy: NATIVE_TEXT_PAINT_MASK_POLICY, scope: "ALL_NATIVE_TEXT_SUPPRESSED_NOT_PER_GLYPH_CAUSALITY",
      regionExpansionPolicy: TEXT_PAINT_REGION_EXPANSION_POLICY,
      sourceRegions: regions.map(({elementId, left, top, width, height}) => ({elementId, left, top, width, height})),
      paintedPngSha256: captured.paintedPngSha256, suppressedPngSha256: captured.suppressedPngSha256},
    regions: checkpoint.regions.map((region) => {
      const derived = masks.get(region.elementId);
      return {...region, ...(derived ? {...derived.region, paintMask: derived.mask} : {})};
    })});
}
