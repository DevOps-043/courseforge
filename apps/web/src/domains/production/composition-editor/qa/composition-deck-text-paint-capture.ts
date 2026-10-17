import { z } from "zod";
import { captureNativeTextSuppressedFrame } from "./composition-text-paint-mask-capture";
import { captureCompositionQaScreenshot, type CompositionQaCdpClient } from "./composition-qa-browser";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";

import { DECK_TEXT_PAINT_PAIR_POLICY } from "./composition-deck-text-paint-contract";
export { DECK_TEXT_PAINT_PAIR_POLICY } from "./composition-deck-text-paint-contract";

/** Color is deliberately untouched: changing it can change currentColor backgrounds/borders. */
export function setDeckTextPaintSuppression(clipIds: string[], token: string, maximumNodes: number) {
  if (document.getElementById(token)) throw new Error("CONFORMANCE_DECK_PAINT_TOKEN_COLLISION");
  const targets: Element[] = [];
  for (const id of clipIds) {
    const owners = document.querySelectorAll(`[id="${CSS.escape(id)}"]`);
    const roots = owners.length === 1 ? owners[0]!.querySelectorAll(".deck-shell > .deck-stage > .slide") : [];
    if (roots.length !== 1) throw new Error("CONFORMANCE_DECK_PAINT_TARGET_INVALID");
    targets.push(roots[0]!, ...roots[0]!.querySelectorAll("*"));
    if (targets.length > maximumNodes) throw new Error("CONFORMANCE_DECK_PAINT_TARGET_LIMIT");
  }
  if (new Set(targets).size !== targets.length || targets.some((target) => target.namespaceURI !== "http://www.w3.org/1999/xhtml"))
    throw new Error("CONFORMANCE_DECK_PAINT_TARGET_UNSUPPORTED");
  const changedProperties = new Set(["-webkit-text-fill-color", "-webkit-text-stroke-color", "text-shadow", "caret-color"]);
  // Self-contained browser quotas: keep retained CSS/text snapshots bounded before screenshots.
  const maximumPropertiesPerNode = 1024, maximumPropertyCharacters = 8192, maximumSnapshotCharacters = 1024 * 1024;
  let retainedCharacters = 0;
  const original = targets.map((target) => {
    const computed = getComputedStyle(target), bounds = target.getBoundingClientRect();
    const propertyNames = Array.from(computed).filter((name) => !changedProperties.has(name));
    if (propertyNames.length > maximumPropertiesPerNode) throw new Error("CONFORMANCE_DECK_PAINT_STYLE_LIMIT");
    const properties = propertyNames.map((name) => {
      const value = computed.getPropertyValue(name);
      retainedCharacters += name.length + value.length;
      if (value.length > maximumPropertyCharacters || retainedCharacters > maximumSnapshotCharacters)
        throw new Error("CONFORMANCE_DECK_PAINT_STYLE_LIMIT");
      return [name, value];
    });
    retainedCharacters += target.textContent?.length ?? 0;
    if (retainedCharacters > maximumSnapshotCharacters) throw new Error("CONFORMANCE_DECK_PAINT_STYLE_LIMIT");
    return {text: target.textContent, children: Array.from(target.childNodes),
      properties,
      bounds: [bounds.left, bounds.top, bounds.right, bounds.bottom]};
  });
  const style = document.createElement("style"); style.id = token; style.dataset.conformancePaintSuppression = token;
  style.textContent = clipIds.flatMap((id) => [`#${CSS.escape(id)} .deck-shell > .deck-stage > .slide`,
    `#${CSS.escape(id)} .deck-shell > .deck-stage > .slide *`]).join(",")
    + "{-webkit-text-fill-color:transparent!important;-webkit-text-stroke-color:transparent!important;text-shadow:none!important;caret-color:transparent!important;}";
  document.head.appendChild(style);
  const transparent = (value: string) => /^rgba\(\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*0\s*\)$/.test(value);
  targets.forEach((target, index) => {
    const computed = getComputedStyle(target), bounds = target.getBoundingClientRect(), before = original[index]!;
    if (!transparent(computed.webkitTextFillColor) || !transparent(computed.webkitTextStrokeColor) || computed.textShadow !== "none")
      throw new Error("CONFORMANCE_DECK_PAINT_SUPPRESSION_NOT_EFFECTIVE");
    if (target.textContent !== before.text || target.childNodes.length !== before.children.length
      || before.children.some((child, position) => target.childNodes[position] !== child)
      || [bounds.left, bounds.top, bounds.right, bounds.bottom].some((value, position) => value !== before.bounds[position])
      || before.properties.some(([name, value]) => computed.getPropertyValue(name!) !== value))
      throw new Error("CONFORMANCE_DECK_PAINT_NON_TEXT_CHANGE");
  });
  return true;
}

/** Produces a restored pair, not masks or a renderer/font attestation. */
export async function captureDeckTextPaintPair(client: CompositionQaCdpClient, clipIds: string[], paintedPng: Uint8Array,
  screenshot = captureCompositionQaScreenshot) {
  const ids = z.array(z.string().min(1).max(280)).min(1).max(policy.maximumRegions).parse(clipIds);
  const pair = await captureNativeTextSuppressedFrame(client, ids, paintedPng, screenshot, setDeckTextPaintSuppression);
  return {...pair, policy: DECK_TEXT_PAINT_PAIR_POLICY, scope: "JOINT_DECK_TEXT_FILL_DELTA_NOT_PER_NODE_CAUSALITY" as const};
}
