import { z } from "zod";
import { HTML_RECONSTRUCTION_LIBRARY_POLICY as policy, htmlReconstructionLibraryAssetSchema,
  htmlReconstructionLibraryPageSchema, type HtmlReconstructionLibraryPage } from "./composition-html-editing-reconstruction-library.contract";

const collectionSchema = z.object({page: htmlReconstructionLibraryPageSchema,
  assets: z.array(htmlReconstructionLibraryAssetSchema).max(policy.maximumAssets)}).strict();
export type HtmlReconstructionLibraryCollection = z.infer<typeof collectionSchema>;
export function initializeHtmlReconstructionLibrary(page: HtmlReconstructionLibraryPage) {
  const parsed = htmlReconstructionLibraryPageSchema.parse(page);
  if (parsed.afterAssetId !== null) throw new Error("HTML_RECONSTRUCTION_LIBRARY_PAGE_MISMATCH");
  return {page: parsed, assets: parsed.assets};
}

/** Prevent mixed owner/document/cursor pages and duplicate assets without writing
 * the native document. Metadata remains discovery, not persistent edit authority. */
export function appendHtmlReconstructionLibraryPage(input: {previous: HtmlReconstructionLibraryCollection; next: HtmlReconstructionLibraryPage}) {
  const collection = collectionSchema.parse(input.previous), previous = collection.page, next = htmlReconstructionLibraryPageSchema.parse(input.next);
  if (!previous.nextAssetId || next.afterAssetId !== previous.nextAssetId || next.organizationId !== previous.organizationId
    || next.compositionId !== previous.compositionId || next.draftId !== previous.draftId
    || next.currentDocumentHash !== previous.currentDocumentHash || next.currentVersion !== previous.currentVersion)
    throw new Error("HTML_RECONSTRUCTION_LIBRARY_PAGE_MISMATCH");
  const assets = [...collection.assets, ...next.assets];
  if (new Set(assets.map(asset => asset.productionAssetId)).size !== assets.length
    || assets.some((asset, index) => index > 0 && assets[index - 1]!.productionAssetId >= asset.productionAssetId))
    throw new Error("HTML_RECONSTRUCTION_LIBRARY_PAGE_MISMATCH");
  return collectionSchema.parse({page: next, assets});
}
