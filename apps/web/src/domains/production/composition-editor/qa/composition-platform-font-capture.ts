import { z } from "zod";
import { conformanceFontPath, type ConformanceFontManifest } from "../composition-conformance-font-bindings";
import type { CompositionEditorDocument } from "../composition-document.types";
import { captionCueElementId } from "../composition-native-overlay-renderer.service";
import type { CompositionQaCdpClient } from "./composition-qa-browser";
import type { TextParityEvidence } from "./composition-text-parity-evidence";
import { platformFontUsageSchema } from "./composition-font-usage-evidence";

const LIMITS = {events: 512, nameCharacters: 256, sourceCharacters: 2048} as const;
const familyKey = (family: string) => family.trim().replace(/^(["'])(.*)\1$/, "$2").normalize("NFC").toLowerCase();
const loadedFaceSchema = z.object({fontFamily: z.string().min(1).max(LIMITS.nameCharacters),
  platformFontFamily: z.string().min(1).max(LIMITS.nameCharacters), src: z.string().min(1).max(LIMITS.sourceCharacters)});

/** Event must identify one exact frozen file, not a family-name-only or local() fallback. */
export function resolveConformanceFontEvent(input: unknown, fonts: ConformanceFontManifest, origin: string) {
  const face = loadedFaceSchema.parse(input);
  const cssUrl = /^url\(["']?([^"'()]+)["']?\)(?:\s+format\(["'][a-z0-9]+["']\))?$/.exec(face.src);
  const source = cssUrl?.[1] ?? face.src;
  const url = new URL(source, `${origin}/conformance-preview.html`);
  if (url.origin !== origin || url.username || url.password || url.search || url.hash) throw new Error("CONFORMANCE_FONT_EVENT_SOURCE_INVALID");
  const font = fonts.find((candidate) => familyKey(candidate.family) === familyKey(face.fontFamily)
    && url.pathname === `/${conformanceFontPath(candidate)}`);
  if (!font) throw new Error("CONFORMANCE_FONT_EVENT_BINDING_MISMATCH");
  return {family: familyKey(font.family), platformFamily: face.platformFontFamily,
    contentIdentity: `${font.checksumSha256}:${font.mimeType}:${font.fileSizeBytes}`};
}

/** Start before navigation/load so successful FontFace events cannot be missed. */
export async function startConformancePlatformFontCapture(client: CompositionQaCdpClient, fonts: ConformanceFontManifest,
  document: CompositionEditorDocument, origin: string) {
  if (!fonts.length) return {bindings: [] as Array<{elementId: string; fontAssetId: string}>, verify: async (_checkpoint: TextParityEvidence["checkpoints"][number]) => [], close() {}};
  if (!client.onEvent) throw new Error("CONFORMANCE_FONT_EVENTS_UNAVAILABLE");
  const bindings = new Map<string, ReturnType<typeof resolveConformanceFontEvent>>();
  const platformIdentities = new Map<string, string>();
  let failed = false, events = 0;
  const unsubscribe = client.onEvent("CSS.fontsUpdated", (event) => {
    if (++events > LIMITS.events) {failed = true; return;}
    if (event.font === undefined) return;
    try {
      const binding = resolveConformanceFontEvent(event.font, fonts, origin);
      const existing = bindings.get(binding.family);
      const platformIdentity = platformIdentities.get(binding.platformFamily);
      if ((existing && (existing.platformFamily !== binding.platformFamily || existing.contentIdentity !== binding.contentIdentity))
        || (platformIdentity && platformIdentity !== binding.contentIdentity)) throw new Error("CONFORMANCE_FONT_PLATFORM_AMBIGUOUS");
      bindings.set(binding.family, binding); platformIdentities.set(binding.platformFamily, binding.contentIdentity);
    } catch {failed = true;}
  });
  try {await client.send("DOM.enable"); await client.send("CSS.enable");}
  catch (error) {unsubscribe(); throw error;}
  const owners = new Map<string, {family: string; fontAssetId: string}>();
  for (const clip of document.clips) {
    if (clip.source.type === "NATIVE_TEXT" && clip.source.style.fontAssetId) owners.set(`${clip.id}-motion`,
      {family: familyKey(clip.source.style.fontFamily), fontAssetId: clip.source.style.fontAssetId});
    if (clip.source.type === "NATIVE_CAPTIONS" && clip.source.style.fontAssetId) for (const cue of clip.source.cues) {
      owners.set(captionCueElementId(clip.id, cue.id), {family: familyKey(clip.source.style.fontFamily), fontAssetId: clip.source.style.fontAssetId});
    }
  }
  return {bindings: [...owners].map(([elementId, owner]) => ({elementId, fontAssetId: owner.fontAssetId})),
    close: unsubscribe, async verify(checkpoint: TextParityEvidence["checkpoints"][number]) {
    if (failed) throw new Error("CONFORMANCE_FONT_EVENT_INVALID");
    const expected = checkpoint.expectedTexts.filter((text) => owners.has(text.elementId));
    if (!expected.length) return [];
    await client.send("DOM.getDocument", {depth: 0});
    const witness: Array<{elementId: string; fontAssetId: string; platformFamily: string; fonts: z.infer<typeof platformFontUsageSchema>}> = [];
    for (const text of expected) {
      const owner = owners.get(text.elementId)!;
      const binding = bindings.get(owner.family);
      if (!binding) throw new Error("CONFORMANCE_FONT_LOADED_EVENT_MISSING");
      const reference = await client.send("Runtime.evaluate", {expression: `document.getElementById(${JSON.stringify(text.elementId)})`, returnByValue: false});
      const objectId = (reference.result as {objectId?: string} | undefined)?.objectId;
      if (reference.exceptionDetails || !objectId) throw new Error("CONFORMANCE_FONT_ELEMENT_MISSING");
      try {
        const node = await client.send("DOM.requestNode", {objectId});
        if (!Number.isSafeInteger(node.nodeId) || Number(node.nodeId) <= 0) throw new Error("CONFORMANCE_FONT_NODE_INVALID");
        const response = await client.send("CSS.getPlatformFontsForNode", {nodeId: node.nodeId});
        const used = platformFontUsageSchema.parse(response.fonts).filter((font) => font.glyphCount > 0);
        if (used.some((font) => !font.isCustomFont || font.familyName !== binding.platformFamily)) throw new Error("CONFORMANCE_FONT_GLYPH_FALLBACK");
        const verifiedRegion = checkpoint.regions.find((region) => region.elementId === text.elementId);
        const provenAbsence = verifiedRegion && (text.visibility === "HIDDEN"
          || (text.presentation?.paintPose?.support.empty && text.presentation.paintPose.filter === "blur(0px)"));
        if (!used.length && !provenAbsence) throw new Error("CONFORMANCE_FONT_GLYPH_USAGE_MISSING");
        witness.push({elementId: text.elementId, fontAssetId: owner.fontAssetId, platformFamily: binding.platformFamily,
          fonts: used.sort((left, right) => left.postScriptName.localeCompare(right.postScriptName))});
      } finally {await client.send("Runtime.releaseObject", {objectId});}
    }
    if (failed) throw new Error("CONFORMANCE_FONT_EVENT_INVALID");
    return witness;
  }};
}
