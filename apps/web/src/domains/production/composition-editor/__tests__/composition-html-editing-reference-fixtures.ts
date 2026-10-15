import { createHtmlEditingRevisionFixture, htmlEditingFixtureId as uuid } from "./composition-html-editing-test-fixtures";
import { bindHtmlEditingRevisionToComposition } from "../composition-html-editing-document.server";
import { freezeCompositionHtmlEditingSnapshot } from "../composition-html-editing-snapshot-bundle.server";
import { buildSnapshotConformanceContract } from "../composition-snapshot-conformance-contract";

export function createHtmlEditingReferenceFixture() {
  const input = createHtmlEditingRevisionFixture();
  const native = bindHtmlEditingRevisionToComposition({ ...input.authority, document: input.document,
    revision: input.next.revision, revisionSha256: input.next.sha256 });
  const bundle = freezeCompositionHtmlEditingSnapshot({ document: native.document, context: {
    organizationId: uuid, documentId: uuid, documentHash: native.documentHash,
    revisions: [{ ...input.authority, encodedRevision: JSON.stringify(input.next.revision) }],
  } });
  const assets = [
    { productionAssetId: uuid, checksum: "a".repeat(64), fileSizeBytes: 1024, mimeType: "image/png",
      storageBucket: "production-assets", storagePath: "html/image.png" },
    { productionAssetId: "40000000-0000-4000-8000-000000000002", checksum: "b".repeat(64), fileSizeBytes: 1024,
      mimeType: "video/mp4", storageBucket: "production-assets", storagePath: "broll/video.mp4" },
  ];
  const contract = buildSnapshotConformanceContract({ document: native.document, documentHash: native.documentHash,
    assets: assets.map(asset => ({ id: asset.productionAssetId, checksum: asset.checksum })), contractVersion: 4,
    deckText: true, htmlEditingBundle: bundle,
    renderProfile: { format: "mp4", fps: 25, quality: "high", resolution: "1080p" } });
  const params = { document: native.document, contract, assets, fontManifest: [],
    htmlEditingSnapshot: { ...bundle, scope: { organizationId: uuid, documentId: uuid }, authorities: [input.authority] } };
  return { input, native, bundle, contract, params };
}
