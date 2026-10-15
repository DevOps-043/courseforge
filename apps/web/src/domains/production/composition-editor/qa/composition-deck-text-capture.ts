import { createHash } from "node:crypto";
import { z } from "zod";
import { selectDeckTextCheckpointClips, DECK_TEXT_PLAN_LIMITS, type DeckTextPlan } from "../composition-deck-text-plan";
import { COMPOSITION_TEXT_PARITY_POLICY as policy } from "../composition-text-parity-policy";
import type { CompositionQaCdpClient } from "./composition-qa-browser";
import { textPaintMaskSchema } from "./composition-text-paint-mask";
import { deckTextPaintCaptureSchema } from "./composition-deck-text-paint-contract";
import { deckTextNodeMetricId } from "../composition-deck-text-plan";

const addressSchema = z.object({clipId: z.string().min(1).max(280),
  nodePath: z.array(z.number().int().nonnegative()).min(1).max(policy.maximumAncestorDepth)}).strict();
export const deckTextCapturedRegionSchema = addressSchema.extend({textSha256: z.string().regex(/^[a-f0-9]{64}$/),
  left: z.number().int().nonnegative(), top: z.number().int().nonnegative(),
  width: z.number().int().positive(), height: z.number().int().positive(), paintMask: textPaintMaskSchema.optional()}).strict()
  .refine((region) => !region.paintMask || region.paintMask.width === region.width && region.paintMask.height === region.height);
export const deckTextCheckpointCaptureSchema = z.object({status: z.enum(["CAPTURED", "INCOMPLETE"]),
  regions: z.array(deckTextCapturedRegionSchema).max(policy.maximumRegions),
  unavailable: z.array(addressSchema.extend({reason: z.enum([
    "ROOT_MISSING", "NODE_MISSING", "NODE_NOT_TEXT", "ELEMENT_NOT_VISIBLE", "GEOMETRY_INVALID", "TEXT_OUTSIDE_CANVAS",
  ])}).strict()).max(policy.maximumRegions),
  limitedClipIds: z.array(z.string().min(1).max(280)).max(500),
  paintCapture: deckTextPaintCaptureSchema.optional(),
}).strict().refine((capture) => (capture.status === "CAPTURED") === (!capture.unavailable.length && !capture.limitedClipIds.length))
  .refine((capture) => capture.paintCapture
    ? capture.status === "CAPTURED" && capture.regions.length > 0 && capture.regions.every((region) => Boolean(region.paintMask))
      && JSON.stringify(capture.paintCapture.sourceRegions.map((region) => region.elementId))
        === JSON.stringify(capture.regions.map(deckTextNodeMetricId))
    : capture.regions.every((region) => !region.paintMask), "CONFORMANCE_DECK_PAINT_CAPTURE_INVALID");

/** Read-only, no authored script execution, node insertion, style overrides or remote requests. */
export function readDeckTextDom(clips: DeckTextPlan["clips"], width: number, height: number,
  limits: {maximumAncestorDepth: number; maximumParsedNodes: number; maximumTextCharacters: number}) {
  let nodesRead = 0, charactersRead = 0;
  const rows: Array<Record<string, unknown>> = [];
  for (const clip of clips) {
    const owners = document.querySelectorAll(`[id="${CSS.escape(clip.clipId)}"]`);
    const owner = owners.length === 1 ? owners[0] : null;
    const roots = owner?.querySelectorAll(".deck-shell > .deck-stage > .slide");
    const root = roots?.length === 1 ? roots[0] : null;
    if (root) {
      const actualPaths: string[] = [];
      const scan = (nodes: Node[], path: number[]) => {
        nodes.forEach((node, index) => {
          if (++nodesRead > limits.maximumParsedNodes) throw new Error("CONFORMANCE_DECK_TEXT_NODE_LIMIT");
          const childPath = [...path, index];
          if (childPath.length > limits.maximumAncestorDepth) throw new Error("CONFORMANCE_DECK_TEXT_DEPTH_LIMIT");
          const tag = node.nodeName?.toLowerCase();
          if (tag === "script" || tag === "template" || tag === "noscript" || tag === "style") return;
          if (node.nodeType === 3 && (node.textContent ?? "").trim()) actualPaths.push(JSON.stringify(childPath));
          scan(Array.from(node.childNodes ?? []), childPath);
        });
      };
      scan(Array.from(root.childNodes), []);
      const expectedPaths = clip.entries.map((entry) => JSON.stringify(entry.nodePath));
      if (JSON.stringify(actualPaths) !== JSON.stringify(expectedPaths)) throw new Error("CONFORMANCE_DECK_TEXT_DOM_COVERAGE_MISMATCH");
    }
    for (const entry of clip.entries) {
      const address = {clipId: clip.clipId, nodePath: entry.nodePath};
      if (!root) {rows.push({...address, unavailable: "ROOT_MISSING"}); continue;}
      let node: Node | undefined = root;
      for (const index of entry.nodePath) {
        if (++nodesRead > limits.maximumParsedNodes) throw new Error("CONFORMANCE_DECK_TEXT_NODE_LIMIT");
        node = node?.childNodes[index];
      }
      if (!node) {rows.push({...address, unavailable: "NODE_MISSING"}); continue;}
      if (node.nodeType !== 3) {rows.push({...address, unavailable: "NODE_NOT_TEXT"}); continue;}
      const text = node.textContent ?? ""; charactersRead += text.length;
      if (charactersRead > limits.maximumTextCharacters) throw new Error("CONFORMANCE_DECK_TEXT_SIZE_LIMIT");
      let ancestor = node.parentElement, depth = 0, visible = true;
      while (ancestor) {
        if (++depth > limits.maximumAncestorDepth) throw new Error("CONFORMANCE_DECK_TEXT_DEPTH_LIMIT");
        const style = getComputedStyle(ancestor), opacity = Number(style.opacity);
        if (!Number.isFinite(opacity)) throw new Error("CONFORMANCE_DECK_TEXT_OPACITY_INVALID");
        if (opacity <= 0 || style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") visible = false;
        ancestor = ancestor.parentElement;
      }
      if (!visible) {rows.push({...address, text, unavailable: "ELEMENT_NOT_VISIBLE"}); continue;}
      const range = document.createRange(); range.selectNode(node);
      const bounds = range.getBoundingClientRect(); range.detach();
      if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) {
        rows.push({...address, text, unavailable: "GEOMETRY_INVALID"}); continue;
      }
      const left = Math.max(0, Math.floor(bounds.left)), top = Math.max(0, Math.floor(bounds.top));
      const right = Math.min(width, Math.ceil(bounds.right)), bottom = Math.min(height, Math.ceil(bounds.bottom));
      if (right <= left || bottom <= top) {rows.push({...address, text, unavailable: "TEXT_OUTSIDE_CANVAS"}); continue;}
      rows.push({...address, text, left, top, width: right - left, height: bottom - top});
    }
  }
  return rows;
}

const rawRowSchema = addressSchema.extend({text: z.string().max(policy.maximumTextCharactersPerElement).optional(),
  unavailable: deckTextCheckpointCaptureSchema.shape.unavailable.element.shape.reason.optional(),
  left: z.number().int().nonnegative().optional(), top: z.number().int().nonnegative().optional(),
  width: z.number().int().positive().optional(), height: z.number().int().positive().optional()}).strict();
const addressKey = (entry: {clipId: string; nodePath: number[]}) => JSON.stringify([entry.clipId, entry.nodePath]);

export async function captureDeckTextCheckpoint(client: CompositionQaCdpClient, plan: DeckTextPlan,
  seconds: number, width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0
    || width * height > policy.maximumFramePixels) throw new Error("CONFORMANCE_DECK_TEXT_FRAME_LIMIT");
  const clips = selectDeckTextCheckpointClips(plan, seconds);
  const expected = new Map(clips.flatMap((clip) => clip.entries.map((entry) => [addressKey({...entry, clipId: clip.clipId}), entry.textSha256])));
  const response = await client.send("Runtime.evaluate", {returnByValue: true, awaitPromise: true,
    expression: `(${readDeckTextDom.toString()})(${JSON.stringify(clips)},${width},${height},${JSON.stringify({
      maximumAncestorDepth: policy.maximumAncestorDepth, maximumParsedNodes: DECK_TEXT_PLAN_LIMITS.maximumParsedNodes,
      maximumTextCharacters: policy.maximumTextCharactersPerCheckpoint})})`});
  if (response.exceptionDetails) throw new Error("CONFORMANCE_DECK_TEXT_CAPTURE_RUNTIME_FAILED");
  const rows = z.array(rawRowSchema).max(policy.maximumRegions).parse((response.result as {value?: unknown})?.value);
  if (rows.length !== expected.size || new Set(rows.map(addressKey)).size !== rows.length
    || rows.some((row) => !expected.has(addressKey(row)))) throw new Error("CONFORMANCE_DECK_TEXT_CAPTURE_IDENTITIES_INVALID");
  if (rows.reduce((total, row) => total + (row.text?.length ?? 0), 0) > policy.maximumTextCharactersPerCheckpoint)
    throw new Error("CONFORMANCE_DECK_TEXT_SIZE_LIMIT");
  const regions = rows.flatMap((row) => {
    if (row.text !== undefined && createHash("sha256").update(row.text).digest("hex") !== expected.get(addressKey(row)))
      throw new Error("CONFORMANCE_DECK_TEXT_CONTENT_MISMATCH");
    if (row.unavailable) return [];
    const region = deckTextCapturedRegionSchema.parse({clipId: row.clipId, nodePath: row.nodePath,
      textSha256: expected.get(addressKey(row)), left: row.left, top: row.top, width: row.width, height: row.height});
    if (row.text === undefined || region.left + region.width > width || region.top + region.height > height)
      throw new Error("CONFORMANCE_DECK_TEXT_REGION_INVALID");
    return [region];
  });
  if (regions.reduce((total, region) => total + region.width * region.height, 0) > policy.maximumComparedPixels)
    throw new Error("CONFORMANCE_DECK_TEXT_REGION_LIMIT");
  const unavailable = rows.flatMap((row) => row.unavailable ? [{clipId: row.clipId, nodePath: row.nodePath, reason: row.unavailable}] : []);
  const limitedClipIds = clips.filter((clip) => clip.limitations.length).map((clip) => clip.clipId);
  return deckTextCheckpointCaptureSchema.parse({status: unavailable.length || limitedClipIds.length ? "INCOMPLETE" : "CAPTURED",
    regions, unavailable, limitedClipIds});
}
