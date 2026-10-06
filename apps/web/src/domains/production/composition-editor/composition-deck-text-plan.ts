import { createHash } from "node:crypto";
import { load } from "cheerio";
import { z } from "zod";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { COMPOSITION_TEXT_PARITY_POLICY as textPolicy } from "./composition-text-parity-policy";
import { buildCompositionTransitionRuntime } from "./composition-transition-runtime";
import { verifyCompositionHtmlEditingSnapshotContent, type HtmlEditingFrozenSnapshotBundle } from "./composition-html-editing-snapshot-bundle.server";

export const DECK_TEXT_PLAN_POLICY = "SOURCE_HTML_TEXT_NODE_PATHS_V1" as const;
export const DECK_TEXT_PLAN_LIMITS = Object.freeze({maximumHtmlBytes: 1024 ** 2, maximumParsedNodes: 16_384});
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const deckTextEntrySchema = z.object({
  nodePath: z.array(z.number().int().nonnegative().max(DECK_TEXT_PLAN_LIMITS.maximumParsedNodes)).min(1).max(textPolicy.maximumAncestorDepth),
  textSha256: hashSchema,
}).strict();
export const deckTextPlanSchema = z.object({
  policy: z.literal(DECK_TEXT_PLAN_POLICY),
  scope: z.literal("SOURCE_DECK_TEXT_NOT_DOM_OR_PAINT_EVIDENCE"),
  documentHash: hashSchema,
  clips: z.array(z.object({
    clipId: z.string().min(1).max(280), sourceHtmlSha256: hashSchema,
    window: z.object({startSeconds: z.number().finite().nonnegative(), endSeconds: z.number().finite().nonnegative(),
      excluded: z.boolean()}).strict().refine((window) => window.endSeconds > window.startSeconds),
    entries: z.array(deckTextEntrySchema).max(textPolicy.maximumRegions),
    limitations: z.array(z.enum(["SCRIPTED_CONTENT", "TEMPLATE_CONTENT", "NOSCRIPT_CONTENT"])).max(3),
  }).strict()).max(500),
}).strict().superRefine((plan, context) => {
  if (new Set(plan.clips.map((clip) => clip.clipId)).size !== plan.clips.length
    || plan.clips.reduce((total, clip) => total + clip.entries.length, 0) > textPolicy.maximumRegionsPerCapture
    || plan.clips.some((clip) => new Set(clip.entries.map((entry) => JSON.stringify(entry.nodePath))).size !== clip.entries.length
      || new Set(clip.limitations).size !== clip.limitations.length))
    context.addIssue({code: "custom", message: "CONFORMANCE_DECK_TEXT_PLAN_INVALID"});
});
export type DeckTextPlan = z.infer<typeof deckTextPlanSchema>;

/** Derives expectations from immutable source, never from a potentially divergent captured DOM. */
export function buildDeckTextPlan(input: unknown, htmlEditingBundle?: HtmlEditingFrozenSnapshotBundle): DeckTextPlan {
  const document = compositionEditorDocumentSchema.parse(input);
  if (document.htmlEditing?.items.length && !htmlEditingBundle) throw new Error("CONFORMANCE_DECK_TEXT_HTML_BUNDLE_REQUIRED");
  const frozenFragments = htmlEditingBundle ? verifyCompositionHtmlEditingSnapshotContent({ ...htmlEditingBundle,
    document, documentHash: hashCompositionDocument(document) }).fragments : new Map<string, string>();
  const deckClips = document.clips.filter((clip) => clip.source.type === "DECK_SLIDE");
  if (deckClips.reduce((total, clip) => total + (clip.source.type === "DECK_SLIDE"
    ? Buffer.byteLength(frozenFragments.get(clip.id) ?? clip.source.html, "utf8") : 0), 0)
    > DECK_TEXT_PLAN_LIMITS.maximumHtmlBytes) throw new Error("CONFORMANCE_DECK_TEXT_HTML_LIMIT");
  let parsedNodes = 0, textCharacters = 0, totalEntries = 0;
  const windows = buildCompositionTransitionRuntime(document).clipWindowsById;
  const tracks = new Map(document.tracks.map((track) => [track.id, track]));
  const clips = deckClips.map((clip) => {
    if (clip.source.type !== "DECK_SLIDE") throw new Error("CONFORMANCE_DECK_TEXT_SOURCE_INVALID");
    const sourceHtml = frozenFragments.get(clip.id) ?? clip.source.html;
    const fragment = load(sourceHtml, {}, false);
    const entries: z.infer<typeof deckTextEntrySchema>[] = [];
    const limitations = new Set<DeckTextPlan["clips"][number]["limitations"][number]>();
    type SourceNode = ReturnType<typeof fragment.root>[0]["children"][number];
    // Use the parser's inferred node type; paths index childNodes, including comments/whitespace.
    const visit = (nodes: SourceNode[], path: number[]) => {
      nodes.forEach((node, index) => {
        if (++parsedNodes > DECK_TEXT_PLAN_LIMITS.maximumParsedNodes) throw new Error("CONFORMANCE_DECK_TEXT_NODE_LIMIT");
        const nodePath = [...path, index];
        if (nodePath.length > textPolicy.maximumAncestorDepth) throw new Error("CONFORMANCE_DECK_TEXT_DEPTH_LIMIT");
        if (node.type === "script") {limitations.add("SCRIPTED_CONTENT"); return;}
        if ("name" in node && node.name === "template") {limitations.add("TEMPLATE_CONTENT"); return;}
        if ("name" in node && node.name === "noscript") {limitations.add("NOSCRIPT_CONTENT"); return;}
        if (node.type === "style") return;
        if (node.type === "text" && node.data.trim()) {
          textCharacters += node.data.length;
          if (node.data.length > textPolicy.maximumTextCharactersPerElement || textCharacters > textPolicy.maximumTextCharactersPerCheckpoint)
            throw new Error("CONFORMANCE_DECK_TEXT_SIZE_LIMIT");
          if (++totalEntries > textPolicy.maximumRegionsPerCapture || entries.length >= textPolicy.maximumRegions)
            throw new Error("CONFORMANCE_DECK_TEXT_REGION_LIMIT");
          entries.push({nodePath, textSha256: sha256(node.data)});
        }
        if ("children" in node) visit(node.children, nodePath);
      });
    };
    visit(fragment.root()[0]!.children, []);
    const window = windows.get(clip.id)!;
    return {clipId: clip.id, sourceHtmlSha256: sha256(sourceHtml), entries, limitations: [...limitations].sort(),
      window: {startSeconds: window.startSeconds, endSeconds: window.endSeconds,
        excluded: clip.hidden || Boolean(tracks.get(clip.trackId)?.hidden) || clip.layout.opacity === 0}};
  });
  return deckTextPlanSchema.parse({policy: DECK_TEXT_PLAN_POLICY, scope: "SOURCE_DECK_TEXT_NOT_DOM_OR_PAINT_EVIDENCE",
    documentHash: hashCompositionDocument(document), clips});
}

export function hashDeckTextPlan(input: unknown) {
  return sha256(JSON.stringify(deckTextPlanSchema.parse(input)));
}

/** Stable metric key, not a DOM id or a causal glyph identity. */
export function deckTextNodeMetricId(entry: {clipId: string; nodePath: number[]}) {
  return `deck-node-${sha256(JSON.stringify([entry.clipId, entry.nodePath]))}`;
}

/** A self-consistent hash is insufficient: recompute paths/text from the authorized document. */
export function validateDeckTextPlan(document: unknown, input: unknown, htmlEditingBundle?: HtmlEditingFrozenSnapshotBundle): DeckTextPlan {
  const plan = deckTextPlanSchema.parse(input);
  if (hashDeckTextPlan(plan) !== hashDeckTextPlan(buildDeckTextPlan(document, htmlEditingBundle)))
    throw new Error("CONFORMANCE_DECK_TEXT_SOURCE_MISMATCH");
  return plan;
}

export function selectDeckTextCheckpointClips(input: unknown, seconds: number) {
  const plan = deckTextPlanSchema.parse(input);
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error("CONFORMANCE_DECK_TEXT_TIME_INVALID");
  const clips = plan.clips.filter(({window}) => !window.excluded && seconds >= window.startSeconds && seconds < window.endSeconds);
  if (clips.reduce((count, clip) => count + clip.entries.length, 0) > textPolicy.maximumRegions)
    throw new Error("CONFORMANCE_DECK_TEXT_CHECKPOINT_LIMIT");
  return clips;
}
