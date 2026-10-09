import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ORGANIZATION_FONT_STORAGE_BUCKET, type OrganizationFontRecord } from "../fonts/organization-font.types";
import { compositionEditorDocumentSchema, type CompositionEditorDocument } from "./composition-document.types";
import { readReferencedCompositionFonts, compositionFontArchivePath, compiledCompositionFont } from "./composition-font-assets.service";
import { assertDocumentConformanceFontBindings, CONFORMANCE_FONT_BINDING_LIMITS } from "./composition-conformance-font-bindings";
import { htmlEditingPreviewStorageIdentitySchema, readHtmlEditingPreviewStorageBytes } from "./composition-html-editing-preview-storage.server";

export const HTML_EDITING_PREVIEW_FONT_POLICY = Object.freeze({ totalBytes: 128 * 1024 * 1024 });
export class HtmlEditingPreviewFontError extends Error {
  constructor() {
    super("HTML_EDITING_PREVIEW_FONTS_UNAVAILABLE");
    this.name = "HtmlEditingPreviewFontError";
  }
}

function storageIdentity(font: OrganizationFontRecord) {
  if (font.status !== "READY" || font.storageBucket !== ORGANIZATION_FONT_STORAGE_BUCKET) throw new Error();
  return htmlEditingPreviewStorageIdentitySchema.parse({
    checksum: font.checksumSha256, fileSizeBytes: font.fileSizeBytes, mimeType: font.mimeType,
    storageBucket: font.storageBucket, storagePath: font.storagePath,
  });
}

function assertFontBindings(document: CompositionEditorDocument, fonts: OrganizationFontRecord[]) {
  assertDocumentConformanceFontBindings(document, fonts.map(font => ({
    fontAssetId: font.id, family: font.family, checksumSha256: font.checksumSha256,
    fileSizeBytes: font.fileSizeBytes, mimeType: font.mimeType,
  })));
  for (const font of fonts) storageIdentity(font);
  if (fonts.reduce((total, font) => total + font.fileSizeBytes, 0) > HTML_EDITING_PREVIEW_FONT_POLICY.totalBytes) throw new Error();
}

function identityKey(font: OrganizationFontRecord) {
  return JSON.stringify([font.id, font.family, font.checksumSha256, font.fileSizeBytes,
    font.mimeType, font.status, font.storageBucket, font.storagePath]);
}

/** Host-only native font acquisition. The caller must first authorize the exact
 * saved document. Local paths are compiler aliases, not browser URLs or grants.
 * This proves byte integrity, not font decoding, glyph usage or render parity. */
export async function prepareCompositionHtmlEditingPreviewFonts(input: {
  document: CompositionEditorDocument; organizationId: string; supabase: SupabaseClient;
  storageOrigin: string; signal?: AbortSignal; fetchResource?: typeof fetch;
}) {
  try {
    const organizationId = z.string().uuid().parse(input.organizationId);
    const document = compositionEditorDocumentSchema.parse(input.document);
    const referencedIds = new Set(document.clips.flatMap(clip =>
      (clip.source.type === "NATIVE_TEXT" || clip.source.type === "NATIVE_CAPTIONS") && clip.source.style.fontAssetId
        ? [clip.source.style.fontAssetId] : []));
    if (referencedIds.size > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts) throw new Error();
    input.signal?.throwIfAborted();
    const readerInput = { document, organizationId, supabase: input.supabase };
    const fonts = await readReferencedCompositionFonts(readerInput);
    assertFontBindings(document, fonts);
    const resources = new Map<string, { bytes: Uint8Array; mimeType: string }>();
    for (const font of fonts) {
      const path = compositionFontArchivePath(font);
      if (!resources.has(path)) resources.set(path, {
        bytes: await readHtmlEditingPreviewStorageBytes({ ...input, identity: storageIdentity(font) }),
        mimeType: font.mimeType,
      });
    }
    input.signal?.throwIfAborted();
    const refreshed = await readReferencedCompositionFonts(readerInput);
    assertFontBindings(document, refreshed);
    const currentById = new Map(refreshed.map(font => [font.id, identityKey(font)]));
    if (refreshed.length !== fonts.length || fonts.some(font => currentById.get(font.id) !== identityKey(font))) throw new Error();
    input.signal?.throwIfAborted();
    return {
      resources,
      fonts: new Map(refreshed.map(font => [font.id, compiledCompositionFont(font, compositionFontArchivePath(font))])),
      scope: "AUTHORIZED_NATIVE_FONT_BYTES_NOT_GLYPH_OR_RENDER_EVIDENCE" as const,
    };
  } catch {
    throw new HtmlEditingPreviewFontError();
  }
}
