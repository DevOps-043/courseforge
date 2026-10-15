import { createHash } from "node:crypto";
import { z } from "zod";
import type { CompositionCompiledFont } from "../fonts/organization-font.types";
import { hyperframesAssetManifestSchema } from "../hyperframes/hyperframes.types";
import { hashCompositionDocument } from "./composition-document.service";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { compileCompositionPreview, COMPOSITION_COMPILATION_TARGETS } from "./composition-preview-compiler.service";
import { compositionConformanceContractSchema } from "./composition-preview-render-conformance";
import { buildTextParityCheckpointPlans } from "./composition-text-checkpoint-plan";
import { assertCompiledConformanceFontBindings, assertConformanceFontManifestPin, buildDeclaredNativeFontUsageContract, conformanceFontManifestHash, type ConformanceFontManifest } from "./composition-conformance-font-bindings";
import { assertCompositionEventCheckpointBatch } from "./composition-conformance-batch-identity";
import { validateDeckTextPlan } from "./composition-deck-text-plan";
import {
  HTML_EDITING_SNAPSHOT_BUNDLE_POLICY, verifyCompositionHtmlEditingSnapshotContent,
  type HtmlEditingFrozenCompilationInput, type HtmlEditingFrozenSnapshotBundle,
} from "./composition-html-editing-snapshot-bundle.server";

/** Byte integrity alone cannot prove that a producer froze the document's actual text. */
function validateReferenceTextPlan(
  document: z.infer<typeof compositionEditorDocumentSchema>,
  contract: z.infer<typeof compositionConformanceContractSchema>,
  htmlEditingBundle?: HtmlEditingFrozenSnapshotBundle,
) {
  if (document.htmlEditing?.items.length && (contract.schemaVersion !== 4 || !contract.deckTextPlan))
    throw new Error("CONFORMANCE_REFERENCE_HTML_TEXT_PLAN_REQUIRED");
  if (contract.schemaVersion !== 4) return;
  if (contract.deckTextPlan) validateDeckTextPlan(document, contract.deckTextPlan, htmlEditingBundle);
  if (contract.checkpointPolicy) assertCompositionEventCheckpointBatch(document, contract);
  const expected = buildTextParityCheckpointPlans(document, contract.checkpoints, contract.textParity.visibilityPolicy ?? false);
  if (JSON.stringify(expected) !== JSON.stringify(contract.textParity.checkpoints)) {
    throw new Error("CONFORMANCE_REFERENCE_TEXT_PLAN_MISMATCH");
  }
}

export const CONFORMANCE_REFERENCE_ARCHIVE_PATHS = {
  preview: "conformance-preview.html", metadata: "conformance-reference.json",
} as const;
const referenceBindingSchema = z.object({
  assetId: z.string().uuid(), checksum: z.string().regex(/^[a-f0-9]{64}$/),
  fileSizeBytes: z.number().int().positive(), localPath: z.string().regex(/^conformance-media\/[0-9a-f-]{36}$/i),
  mimeType: z.string(), storageBucket: z.string().min(1), storagePath: z.string().min(1),
}).strict();
export const conformanceReferenceSourceSchema = z.object({
  schemaVersion: z.literal(1), documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewPath: z.literal(CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview), previewSha256: z.string().regex(/^[a-f0-9]{64}$/),
  nativeDocumentSha256: z.string().regex(/^[a-f0-9]{64}$/), contractSha256: z.string().regex(/^[a-f0-9]{64}$/),
  mediaState: z.literal("REQUIRES_VERIFIED_MATERIALIZATION"),
  audioState: z.literal("REFERENCE_NOT_CAPTURED"), bindings: z.array(referenceBindingSchema).max(250),
  fontManifestSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  htmlEditingSnapshot: z.object({ schemaVersion: z.literal(1),
    path: z.literal(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict().optional(),
}).strict();

export function conformanceReferenceVersion(raw: string | undefined): 1 | null {
  return raw === "true" ? 1 : null;
}

/** Checks extracted source bytes; the caller must separately verify the archive against project_hash. */
export function verifyConformanceReferenceSource(input: {
  metadata: unknown; previewHtml: string; documentJson: string; contractJson: string;
  fontManifest?: unknown;
  htmlEditingBundle?: HtmlEditingFrozenSnapshotBundle;
}) {
  const metadata = conformanceReferenceSourceSchema.parse(input.metadata);
  const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
  if (sha256(input.previewHtml) !== metadata.previewSha256
    || sha256(input.documentJson) !== metadata.nativeDocumentSha256
    || sha256(input.contractJson) !== metadata.contractSha256) throw new Error("CONFORMANCE_REFERENCE_BYTES_MISMATCH");
  const document = compositionEditorDocumentSchema.parse(JSON.parse(input.documentJson));
  const contract = compositionConformanceContractSchema.parse(JSON.parse(input.contractJson));
  if (hashCompositionDocument(document) !== metadata.documentHash || contract.documentHash !== metadata.documentHash) {
    throw new Error("CONFORMANCE_REFERENCE_DOCUMENT_MISMATCH");
  }
  const htmlEditingBundle = assertReferenceHtmlBundle(document, metadata, input.htmlEditingBundle);
  validateReferenceTextPlan(document, contract, htmlEditingBundle);
  if (metadata.fontManifestSha256 !== undefined && input.fontManifest === undefined) {
    throw new Error("CONFORMANCE_REFERENCE_FONT_MANIFEST_MISSING");
  }
  const fontManifest = input.fontManifest === undefined ? undefined
    : assertConformanceFontManifestPin(document, input.fontManifest, metadata.fontManifestSha256);
  validateReferenceFontContract(document, contract, fontManifest);
  const byId = new Map(metadata.bindings.map((binding) => [binding.assetId, binding]));
  if (byId.size !== metadata.bindings.length || contract.assets.length !== byId.size
    || contract.assets.some((asset) => byId.get(asset.id)?.checksum !== asset.checksum)
    || metadata.bindings.some((binding) => binding.localPath !== `conformance-media/${binding.assetId}`)) {
    throw new Error("CONFORMANCE_REFERENCE_ASSETS_MISMATCH");
  }
  // Reuse the production path and size validators, not weaker consumer-owned rules.
  hyperframesAssetManifestSchema.parse(metadata.bindings.map((binding) => ({
    productionAssetId: binding.assetId, checksum: binding.checksum, fileSizeBytes: binding.fileSizeBytes,
    mimeType: binding.mimeType, storageBucket: binding.storageBucket, storagePath: binding.storagePath,
  })));
  return { metadata, document, contract, ...(fontManifest ? {fontManifest} : {}), ...(htmlEditingBundle ? {htmlEditingBundle} : {}) };
}

/** Compiles from the saved document; no draft fetch, signed URL or remote media download. */
export async function buildConformanceReferenceSource(params: {
  document: z.infer<typeof compositionEditorDocumentSchema>;
  contract: z.infer<typeof compositionConformanceContractSchema>;
  assets: z.infer<typeof hyperframesAssetManifestSchema>;
  fontAssets?: Map<string, CompositionCompiledFont>;
  fontManifest?: ConformanceFontManifest;
  deckPublicUrls?: Map<string, string>;
  htmlEditingSnapshot?: HtmlEditingFrozenCompilationInput;
}) {
  const document = compositionEditorDocumentSchema.parse(params.document);
  const contract = compositionConformanceContractSchema.parse(params.contract);
  const assets = hyperframesAssetManifestSchema.parse(params.assets);
  const fontManifest = params.fontManifest === undefined ? undefined
    : assertCompiledConformanceFontBindings(document, params.fontManifest, params.fontAssets);
  if (hashCompositionDocument(document) !== contract.documentHash) throw new Error("CONFORMANCE_REFERENCE_DOCUMENT_MISMATCH");
  const htmlEditingBundle = params.htmlEditingSnapshot ? {
    archivePath: params.htmlEditingSnapshot.archivePath, encodedBundle: params.htmlEditingSnapshot.encodedBundle,
    sha256: params.htmlEditingSnapshot.sha256,
  } : undefined;
  if (Boolean(document.htmlEditing?.items.length) !== Boolean(htmlEditingBundle)) throw new Error("CONFORMANCE_REFERENCE_HTML_BUNDLE_REQUIRED");
  validateReferenceTextPlan(document, contract, htmlEditingBundle);
  validateReferenceFontContract(document, contract, fontManifest);
  const byId = new Map(assets.map((asset) => [asset.productionAssetId, asset]));
  if (byId.size !== assets.length || contract.assets.length !== assets.length
    || contract.assets.some((asset) => byId.get(asset.id)?.checksum.toLowerCase() !== asset.checksum)) {
    throw new Error("CONFORMANCE_REFERENCE_ASSETS_MISMATCH");
  }
  const bindings = assets.map((asset) => {
    if (!asset.storageBucket) throw new Error("CONFORMANCE_REFERENCE_BUCKET_MISSING");
    return referenceBindingSchema.parse({
      assetId: asset.productionAssetId, checksum: asset.checksum.toLowerCase(), fileSizeBytes: asset.fileSizeBytes,
      localPath: `conformance-media/${asset.productionAssetId}`, mimeType: asset.mimeType,
      storageBucket: asset.storageBucket, storagePath: asset.storagePath,
    });
  }).sort((left, right) => left.assetId.localeCompare(right.assetId));
  const assetUrls = new Map(bindings.map((binding) => [binding.assetId, binding.localPath]));
  const deckAssetUrls = new Map([...params.deckPublicUrls ?? []].map(([id, url]) => {
    const localPath = assetUrls.get(id);
    if (!localPath) throw new Error("CONFORMANCE_REFERENCE_DECK_BINDING_MISSING");
    return [url, localPath] as const;
  }));
  const previewHtml = await compileCompositionPreview({
    assetUrls, deckAssetUrls, document, documentHash: contract.documentHash, fontAssets: params.fontAssets,
    audioMetersEnabled: false, target: COMPOSITION_COMPILATION_TARGETS.INTERACTIVE_PREVIEW,
    htmlEditingSnapshot: params.htmlEditingSnapshot,
  });
  const documentJson = JSON.stringify(document, null, 2);
  const contractJson = JSON.stringify(contract, null, 2);
  const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
  const metadata = conformanceReferenceSourceSchema.parse({
    schemaVersion: 1, documentHash: contract.documentHash,
    previewPath: CONFORMANCE_REFERENCE_ARCHIVE_PATHS.preview, previewSha256: sha256(previewHtml),
    nativeDocumentSha256: sha256(documentJson), contractSha256: sha256(contractJson),
    mediaState: "REQUIRES_VERIFIED_MATERIALIZATION", audioState: "REFERENCE_NOT_CAPTURED", bindings,
    ...(fontManifest ? {fontManifestSha256: conformanceFontManifestHash(fontManifest)} : {}),
    ...(htmlEditingBundle ? {htmlEditingSnapshot: {schemaVersion: 1,
      path: htmlEditingBundle.archivePath, sha256: htmlEditingBundle.sha256}} : {}),
  });
  assertReferenceHtmlBundle(document, metadata, htmlEditingBundle);
  return { previewHtml, metadata, documentJson, contractJson, ...(fontManifest ? {fontManifest} : {}),
    ...(htmlEditingBundle ? {htmlEditingBundle} : {}) };
}

function assertReferenceHtmlBundle(document: z.infer<typeof compositionEditorDocumentSchema>,
  metadata: z.infer<typeof conformanceReferenceSourceSchema>, bundle: HtmlEditingFrozenSnapshotBundle | undefined) {
  const required = Boolean(document.htmlEditing?.items.length);
  if (required !== Boolean(metadata.htmlEditingSnapshot) || required !== Boolean(bundle)) {
    throw new Error("CONFORMANCE_REFERENCE_HTML_BUNDLE_REQUIRED");
  }
  if (!bundle) return undefined;
  if (metadata.htmlEditingSnapshot?.path !== bundle.archivePath || metadata.htmlEditingSnapshot.sha256 !== bundle.sha256) {
    throw new Error("CONFORMANCE_REFERENCE_HTML_BUNDLE_PIN_MISMATCH");
  }
  const content = verifyCompositionHtmlEditingSnapshotContent({ ...bundle, document, documentHash: metadata.documentHash });
  const assets = new Map(metadata.bindings.map(binding => [binding.assetId, binding]));
  if (content.usedAssetIds.some(id => !assets.has(id)
    || !["image/png", "image/jpeg", "image/webp"].includes(assets.get(id)!.mimeType))) {
    throw new Error("CONFORMANCE_REFERENCE_HTML_ASSETS_MISMATCH");
  }
  return bundle;
}

function validateReferenceFontContract(document: z.infer<typeof compositionEditorDocumentSchema>,
  contract: z.infer<typeof compositionConformanceContractSchema>, manifest: ConformanceFontManifest | undefined) {
  if (contract.schemaVersion !== 4 || !contract.fontUsageContract) return;
  if (manifest === undefined) throw new Error("CONFORMANCE_REFERENCE_FONT_CONTRACT_MANIFEST_MISSING");
  if (JSON.stringify(buildDeclaredNativeFontUsageContract(document, manifest)) !== JSON.stringify(contract.fontUsageContract)) {
    throw new Error("CONFORMANCE_REFERENCE_FONT_CONTRACT_MISMATCH");
  }
}
