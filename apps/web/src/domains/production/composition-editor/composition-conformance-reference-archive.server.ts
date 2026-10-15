import type JSZip from "jszip";
import { CONFORMANCE_REFERENCE_ARCHIVE_PATHS, verifyConformanceReferenceSource, type buildConformanceReferenceSource } from "./composition-conformance-reference.service";

/** Shared archive writer. Verify all source/bundle pins before changing a ZIP.
 * Archive upload/hash and authorization belong to the calling snapshot service. */
export function writeConformanceReferenceArchive(archive: JSZip, source: Awaited<ReturnType<typeof buildConformanceReferenceSource>>): void {
  verifyConformanceReferenceSource(source);
  archive.file(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview, source.previewHtml);
  archive.file(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.metadata, JSON.stringify(source.metadata, null, 2));
  archive.file("composition-document.json", source.documentJson);
  archive.file("conformance-contract.json", source.contractJson);
  if (source.htmlEditingBundle) archive.file(source.htmlEditingBundle.archivePath, source.htmlEditingBundle.encodedBundle);
}
