import { createHash } from "node:crypto";
import JSZip from "jszip";
import { z } from "zod";
import type { CompositionCompiledFont } from "../fonts/organization-font.types";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS, hyperframesAssetManifestSchema, hyperframesRenderProfileSchema } from "../hyperframes/hyperframes.types";
import { prepareCompositionHtmlEditingSnapshotImages } from "./composition-html-editing-snapshot-images.service";
import { assertHtmlEditingImageIdentities } from "./composition-html-editing-image-identity";
import { controlledRenderExecutionContractSchema } from "./composition-render-execution-contract";
import { buildSnapshotConformanceContract } from "./composition-snapshot-conformance-contract";
import { assertDocumentConformanceFontBindings, CONFORMANCE_FONT_BINDING_LIMITS, conformanceFontPath, type ConformanceFontManifest } from "./composition-conformance-font-bindings";
import { buildConformanceReferenceSource } from "./composition-conformance-reference.service";
import { writeConformanceReferenceArchive } from "./composition-conformance-reference-archive.server";
import { compileCompositionPreview, readCompositionAnimationRuntime, COMPOSITION_COMPILATION_TARGETS } from "./composition-preview-compiler.service";
import { compileCompositionHtmlEditingFragments } from "./composition-html-editing-compilation.server";
import { assertControlledDeckSourcesLocal, applyControlledBrowserResourcePolicy } from "./qa/composition-controlled-source-policy";
import { CONFORMANCE_MATERIALIZATION_LIMITS } from "./qa/composition-conformance-materialization";
import { HTML_HISTORICAL_PUBLICATION_POLICY, htmlHistoricalPublicationProvenanceSchema,
  type HtmlHistoricalPublicationProvenance } from "./composition-html-editing-historical-publication.contract";
import { canonicalHtmlEditingJson } from "./html-editing/html-editing-canonical-json.server";
import { hashCompositionDocument } from "./composition-document.service";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { freezeCompositionHtmlEditingSnapshot } from "./composition-html-editing-snapshot-bundle.server";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { verifyHtmlEditingRevision } from "./html-editing/html-editing-revision.server";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
type AssetManifest = z.infer<typeof hyperframesAssetManifestSchema>;
type Preparation = Parameters<typeof prepareCompositionHtmlEditingSnapshotImages>[0];
type AcquiredSnapshot = Awaited<ReturnType<typeof prepareCompositionHtmlEditingSnapshotImages>>;
type ArchiveOptions = {
  otherAssets: AssetManifest;
  renderProfile: z.input<typeof hyperframesRenderProfileSchema>;
  renderExecution: z.input<typeof controlledRenderExecutionContractSchema>;
  animationRuntimeSha256: string;
  packagedFonts: Array<{binding: ConformanceFontManifest[number]; bytes: Uint8Array}>;
  deckPublicUrls?: Map<string, string>;
  historicalRepublication?: HtmlHistoricalPublicationProvenance;
};

function captureArchiveOptions(input: ArchiveOptions): ArchiveOptions {
  if (!Array.isArray(input.packagedFonts) || input.packagedFonts.length > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts)
    throw new Error("HTML_EDITING_SNAPSHOT_FONT_LIMIT");
  let fontBytes = 0;
  for (const font of input.packagedFonts) {
    if (!(font.bytes instanceof Uint8Array)) throw new Error("HTML_EDITING_SNAPSHOT_FONT_BYTES_MISMATCH");
    fontBytes += font.bytes.byteLength;
    if (fontBytes > CONFORMANCE_MATERIALIZATION_LIMITS.extractedBytes) throw new Error("HTML_EDITING_SNAPSHOT_SOURCE_BUDGET");
  }
  return {otherAssets: hyperframesAssetManifestSchema.parse(input.otherAssets),
    renderProfile: structuredClone(hyperframesRenderProfileSchema.parse(input.renderProfile)),
    renderExecution: structuredClone(controlledRenderExecutionContractSchema.parse(input.renderExecution)),
    animationRuntimeSha256: z.string().regex(/^[a-f0-9]{64}$/).parse(input.animationRuntimeSha256),
    packagedFonts: input.packagedFonts.map(font => ({binding: {...font.binding}, bytes: new Uint8Array(font.bytes)})),
    deckPublicUrls: new Map(input.deckPublicUrls),
    historicalRepublication: input.historicalRepublication ? htmlHistoricalPublicationProvenanceSchema.parse(input.historicalRepublication) : undefined};
}

/** Prepared host assembler, not an upload/registration endpoint. Caller must
 * independently authorize non-HTML assets and fonts before supplying them.
 * Source image identity is acquired here; actual media bytes remain a worker
 * materialization obligation. Returned archive grants no execution authority. */
export async function prepareCompositionHtmlEditingSnapshotArchive(params: Preparation & ArchiveOptions) {
  params.signal?.throwIfAborted();
  const options = captureArchiveOptions(params);
  const request = {actorId: params.actorId, organizationId: params.organizationId, documentId: params.documentId,
    documentHash: params.documentHash, supabase: params.supabase, signal: params.signal};
  const prepared = await prepareCompositionHtmlEditingSnapshotImages(request);
  return assembleAcquiredCompositionHtmlEditingSnapshotArchive({...request, ...options, prepared,
    refresh: () => prepareCompositionHtmlEditingSnapshotImages(request)});
}

/** Shared private host assembler for saved snapshots and independently prepared
 * new content. Acquired input and refresh are authority ports, NOT request data
 * or proof of permission. The caller must acquire/recheck resource authorization;
 * persistence must reauthorize again. No upload, registration or execution here. */
export async function assembleAcquiredCompositionHtmlEditingSnapshotArchive(input: ArchiveOptions & {
  organizationId: string; documentId: string; documentHash: string; signal?: AbortSignal;
  prepared: AcquiredSnapshot; refresh: () => Promise<AcquiredSnapshot>;
}) {
  input.signal?.throwIfAborted();
  // Own all content, configuration and font bytes before the first await. A host
  // refresh may release or mutate its own references while compilation runs.
  const params = {...input, ...captureArchiveOptions(input)};
  const refresh = input.refresh;
  const capture = (acquired: AcquiredSnapshot): AcquiredSnapshot => {
    const document = compositionEditorDocumentSchema.parse(acquired.document);
    if (hashCompositionDocument(document) !== params.documentHash || acquired.context.organizationId !== params.organizationId
      || acquired.context.documentId !== params.documentId || acquired.context.documentHash !== params.documentHash) {
      throw new Error("HTML_EDITING_SNAPSHOT_ACQUIRED_SCOPE_MISMATCH");
    }
    const context = {...acquired.context, revisions: acquired.context.revisions.map(entry => ({...entry,
      authoritativeBinding: {...entry.authoritativeBinding}, grantedAssetIds: [...entry.grantedAssetIds],
      imageSources: new Map(entry.imageSources)}))};
    const bundle = freezeCompositionHtmlEditingSnapshot({document, context});
    if (bundle.sha256 !== acquired.bundle.sha256 || bundle.encodedBundle !== acquired.bundle.encodedBundle
      || bundle.archivePath !== acquired.bundle.archivePath) throw new Error("HTML_EDITING_SNAPSHOT_ACQUIRED_BUNDLE_MISMATCH");
    const imageAssets = z.array(htmlEditingImageIdentitySchema).max(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS).parse(acquired.imageAssets);
    const used = new Set(context.revisions.flatMap(entry => verifyHtmlEditingRevision(entry).compiled.usedAssetIds));
    if (imageAssets.length !== used.size || new Set(imageAssets.map(asset => asset.productionAssetId)).size !== used.size
      || imageAssets.some(asset => !used.has(asset.productionAssetId))) throw new Error("HTML_EDITING_SNAPSHOT_ACQUIRED_IMAGE_SET_MISMATCH");
    return {...acquired, document, context, bundle, imageAssets};
  };
  const prepared = capture(input.prepared);
  z.string().regex(/^[a-f0-9]{64}$/).parse(params.animationRuntimeSha256);
  const renderProfile = hyperframesRenderProfileSchema.parse(params.renderProfile);
  const renderExecution = controlledRenderExecutionContractSchema.parse(params.renderExecution);
  const otherAssets = hyperframesAssetManifestSchema.parse(params.otherAssets);
  const byId = new Map<string, AssetManifest[number]>();
  for (const asset of [...otherAssets, ...prepared.imageAssets]) {
    const previous = byId.get(asset.productionAssetId);
    if (previous && JSON.stringify(previous) !== JSON.stringify(asset)) throw new Error("HTML_EDITING_SNAPSHOT_ASSET_CONFLICT");
    byId.set(asset.productionAssetId, asset);
  }
  const assets = hyperframesAssetManifestSchema.parse([...byId.values()].sort((a,b) => a.productionAssetId.localeCompare(b.productionAssetId)));
  if (params.packagedFonts.length > CONFORMANCE_FONT_BINDING_LIMITS.maximumFonts) throw new Error("HTML_EDITING_SNAPSHOT_FONT_LIMIT");
  const fontManifest = assertDocumentConformanceFontBindings(prepared.document, params.packagedFonts.map(font => font.binding));
  const fontAssets = new Map<string, CompositionCompiledFont>();
  const fontBytes = new Map<string, Uint8Array>();
  let fontTotalBytes = 0;
  for (const font of fontManifest) {
    const packaged = params.packagedFonts.find(entry => entry.binding.fontAssetId === font.fontAssetId)!;
    if (!(packaged.bytes instanceof Uint8Array) || packaged.bytes.byteLength !== font.fileSizeBytes
      || digest(packaged.bytes) !== font.checksumSha256) throw new Error("HTML_EDITING_SNAPSHOT_FONT_BYTES_MISMATCH");
    const path = conformanceFontPath(font);
    if (!fontBytes.has(path)) fontTotalBytes += packaged.bytes.byteLength;
    if (fontTotalBytes > CONFORMANCE_MATERIALIZATION_LIMITS.extractedBytes) throw new Error("HTML_EDITING_SNAPSHOT_SOURCE_BUDGET");
    // Copy caller-owned bytes before asynchronous compilation/publication.
    fontBytes.set(path, new Uint8Array(packaged.bytes));
    fontAssets.set(font.fontAssetId, {assetId: font.fontAssetId, family: font.family, sourceUrl: path,
      format: font.mimeType === "font/otf" ? "opentype" : font.mimeType === "font/ttf" ? "truetype" : font.mimeType.slice(5) as "woff" | "woff2"});
  }
  const contract = buildSnapshotConformanceContract({document: prepared.document, documentHash: params.documentHash,
    assets: assets.map(asset => ({id: asset.productionAssetId, checksum: asset.checksum})), contractVersion: 4,
    renderProfile, renderExecution, deckText: true, htmlEditingBundle: prepared.bundle, fontUsage: true, fontManifest});
  const assetUrls = new Map(assets.map(asset => [asset.productionAssetId, `conformance-media/${asset.productionAssetId}`]));
  const deckAssetUrls = new Map([...(params.deckPublicUrls ?? [])].map(([id,url]) => {
    const local = assetUrls.get(id);
    if (!local) throw new Error("HTML_EDITING_SNAPSHOT_DECK_BINDING_MISSING");
    return [url, local] as const;
  }));
  const fragments = compileCompositionHtmlEditingFragments({document: prepared.document,
    documentHash: params.documentHash, context: prepared.context, assetUrls});
  assertControlledDeckSourcesLocal({document: prepared.document, remoteToLocal: deckAssetUrls,
    localFiles: new Set([...assetUrls.values(), ...fontBytes.keys()]), resolvedDeckFragments: fragments});
  const htmlEditingSnapshot = {...prepared.bundle, scope: {organizationId: params.organizationId, documentId: params.documentId},
    authorities: prepared.context.revisions};
  const [source, renderHtml, runtime] = await Promise.all([
    buildConformanceReferenceSource({document: prepared.document, contract, assets, fontManifest, fontAssets,
      deckPublicUrls: params.deckPublicUrls, htmlEditingSnapshot}),
    compileCompositionPreview({document: prepared.document, documentHash: params.documentHash, assetUrls, deckAssetUrls, fontAssets,
      htmlEditingSnapshot, target: COMPOSITION_COMPILATION_TARGETS.HYPERFRAMES_RENDER}),
    readCompositionAnimationRuntime(),
  ]);
  if (digest(runtime) !== params.animationRuntimeSha256) throw new Error("HTML_EDITING_SNAPSHOT_RUNTIME_MISMATCH");
  const indexHtml = applyControlledBrowserResourcePolicy(renderHtml);
  if ([indexHtml, runtime].some(value => Buffer.byteLength(value) > CONFORMANCE_MATERIALIZATION_LIMITS.sourceFileBytes))
    throw new Error("HTML_EDITING_SNAPSHOT_SOURCE_BUDGET");
  // Re-read exact authority after compilation. Logical aliases verify current
  // grants only, never substitute historical pointers or prove downloaded bytes.
  const refreshed = capture(await refresh());
  compileCompositionHtmlEditingFragments({document: prepared.document, documentHash: params.documentHash,
    context: refreshed.context, assetUrls});
  assertHtmlEditingImageIdentities({usedAssetIds: prepared.imageAssets.map(asset => asset.productionAssetId),
    currentImages: refreshed.imageAssets, frozenBindings: source.metadata.bindings});
  params.signal?.throwIfAborted();
  const archive = new JSZip();
  let historicalMetadata = "";
  if (params.historicalRepublication) {
    const provenance = htmlHistoricalPublicationProvenanceSchema.parse(params.historicalRepublication);
    if (provenance.organizationId !== params.organizationId || provenance.documentId !== params.documentId
      || provenance.documentHash !== params.documentHash || provenance.candidateBundleSha256 !== prepared.bundle.sha256) {
      throw new Error("HTML_HISTORICAL_PROVENANCE_INVALID");
    }
    historicalMetadata = canonicalHtmlEditingJson(provenance);
    archive.file(HTML_HISTORICAL_PUBLICATION_POLICY.provenancePath, historicalMetadata);
  }
  writeConformanceReferenceArchive(archive, source);
  archive.file("index.html", indexHtml); archive.file("assets/gsap.min.js", runtime);
  archive.file("asset-manifest.json", JSON.stringify(assets)); archive.file("font-manifest.json", JSON.stringify(fontManifest));
  for (const [path, bytes] of fontBytes) archive.file(path, bytes);
  const sourceBytes = [indexHtml,runtime,source.previewHtml,source.documentJson,source.contractJson,
    JSON.stringify(source.metadata,null,2),JSON.stringify(assets),JSON.stringify(fontManifest),prepared.bundle.encodedBundle,historicalMetadata]
    .reduce((total,value) => total + Buffer.byteLength(value), fontTotalBytes);
  if (sourceBytes > CONFORMANCE_MATERIALIZATION_LIMITS.extractedBytes) throw new Error("HTML_EDITING_SNAPSHOT_SOURCE_BUDGET");
  const archiveBytes = await archive.generateAsync({type: "nodebuffer", compression: "DEFLATE", compressionOptions: {level: 6}});
  params.signal?.throwIfAborted();
  if (archiveBytes.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) throw new Error("HTML_EDITING_SNAPSHOT_ARCHIVE_BUDGET");
  return {archiveBytes, projectHash: digest(archiveBytes), documentHash: params.documentHash, contract, assets,
    metadata: source.metadata, fontManifest, bundle: prepared.bundle,
    scope: "PREPARED_ARCHIVE_NOT_UPLOADED_OR_RENDERED" as const};
}
