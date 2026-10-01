import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompositionEditorDocument } from "./composition-document.types";
import type { CompositionCompiledFont } from "../fonts/organization-font.types";
import { compositionTextLayerStyleSchema } from "./composition-text-layer.types";
import { captionCueElementId } from "./composition-native-overlay-renderer.service";
import { declaredNativeFontUsageContractSchema, DECLARED_NATIVE_FONT_USAGE_POLICY } from "./composition-font-usage-contract";

export const CONFORMANCE_FONT_BINDING_LIMITS = {maximumFonts: 32, maximumFontBytes: 50 * 1024 * 1024} as const;
export const conformanceFontManifestSchema = z.array(z.object({
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  family: compositionTextLayerStyleSchema.shape.fontFamily.removeDefault(),
  fileSizeBytes: z.number().int().positive().max(CONFORMANCE_FONT_BINDING_LIMITS.maximumFontBytes),
  fontAssetId: z.string().uuid(), mimeType: z.enum(["font/woff", "font/woff2", "font/ttf", "font/otf"]),
}).strict()).max(CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts)
  .refine((fonts) => new Set(fonts.map((font) => font.fontAssetId)).size === fonts.length, "CONFORMANCE_FONT_BINDING_DUPLICATE");
export type ConformanceFontManifest = z.infer<typeof conformanceFontManifestSchema>;

export function normalizeConformanceFontManifest(input: unknown): ConformanceFontManifest {
  return conformanceFontManifestSchema.parse(input).sort((first, second) => first.fontAssetId.localeCompare(second.fontAssetId));
}
export function conformanceFontManifestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(normalizeConformanceFontManifest(input))).digest("hex");
}
export function conformanceFontPath(font: ConformanceFontManifest[number]) {
  return `assets/fonts/${font.checksumSha256}.${font.mimeType.slice("font/".length)}`;
}

/** Freeze ownership from the saved document, not from the captured witness. */
export function buildDeclaredNativeFontUsageContract(document: CompositionEditorDocument, input: unknown) {
  const fonts = assertDocumentConformanceFontBindings(document, input);
  const bindings = document.clips.flatMap((clip) => {
    if (clip.source.type === "NATIVE_TEXT" && clip.source.style.fontAssetId) return [{elementId: `${clip.id}-motion`, fontAssetId: clip.source.style.fontAssetId}];
    if (clip.source.type === "NATIVE_CAPTIONS" && clip.source.style.fontAssetId) {
      const fontAssetId = clip.source.style.fontAssetId;
      return clip.source.cues.map((cue) => ({elementId: captionCueElementId(clip.id, cue.id), fontAssetId}));
    }
    return [];
  });
  return declaredNativeFontUsageContractSchema.parse({policy: DECLARED_NATIVE_FONT_USAGE_POLICY,
    manifestSha256: conformanceFontManifestHash(fonts), bindings});
}

/** Asset identity alone is insufficient: CSS resolves faces by family, not by our UUID. */
export function assertDocumentConformanceFontBindings(document: CompositionEditorDocument, input: unknown) {
  const fonts = normalizeConformanceFontManifest(input);
  const byId = new Map(fonts.map((font) => [font.fontAssetId, font]));
  const families = new Map<string, string>();
  for (const font of fonts) {
    const familyKey = font.family.normalize("NFC").toLowerCase();
    const contentIdentity = `${font.checksumSha256}:${font.mimeType}:${font.fileSizeBytes}`;
    const previous = families.get(familyKey);
    if (previous && previous !== contentIdentity) throw new Error("CONFORMANCE_FONT_FAMILY_AMBIGUOUS");
    families.set(familyKey, contentIdentity);
  }
  for (const clip of document.clips) {
    if (clip.source.type !== "NATIVE_TEXT" && clip.source.type !== "NATIVE_CAPTIONS") continue;
    const {fontAssetId, fontFamily} = clip.source.style;
    if (!fontAssetId) continue;
    const font = byId.get(fontAssetId);
    if (!font || font.family !== fontFamily) throw new Error("CONFORMANCE_FONT_DOCUMENT_BINDING_MISMATCH");
  }
  return fonts;
}

/** Prevent a byte-correct manifest from declaring a different font than the compiled CSS URL. */
export function assertCompiledConformanceFontBindings(document: CompositionEditorDocument, manifest: unknown,
  compiled: Map<string, CompositionCompiledFont> | undefined) {
  const fonts = assertDocumentConformanceFontBindings(document, manifest);
  for (const font of fonts) {
    const face = compiled?.get(font.fontAssetId);
    const extension = font.mimeType.slice("font/".length);
    const format = extension === "otf" ? "opentype" : extension === "ttf" ? "truetype" : extension;
    if (!face || face.assetId !== font.fontAssetId || face.family !== font.family || face.format !== format
      || face.sourceUrl !== conformanceFontPath(font)) throw new Error("CONFORMANCE_FONT_COMPILED_BINDING_MISMATCH");
  }
  return fonts;
}

export function assertSnapshotFontManifestReuse(manifest: unknown, requested: unknown) {
  const stored = manifest && typeof manifest === "object" && "font_manifest" in manifest ? manifest.font_manifest : [];
  if (conformanceFontManifestHash(stored) !== conformanceFontManifestHash(requested)) {
    throw new Error("CONFORMANCE_SNAPSHOT_FONT_BINDING_MISMATCH");
  }
}

export function assertConformanceFontManifestPin(document: CompositionEditorDocument, input: unknown, expectedHash?: string) {
  const fonts = assertDocumentConformanceFontBindings(document, input);
  if (expectedHash !== undefined && conformanceFontManifestHash(fonts) !== expectedHash) {
    throw new Error("CONFORMANCE_FONT_MANIFEST_PIN_MISMATCH");
  }
  return fonts;
}
