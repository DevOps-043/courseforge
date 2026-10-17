import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import type { createHtmlHistoricalReconstructionArchivePreparer } from "./composition-html-editing-reconstruction-archive.server";
import { HTML_RECONSTRUCTION_POLICY as policy, htmlReconstructionOriginSchema, htmlReconstructionTargetSchema,
  htmlReconstructionReviewsSchema, htmlReconstructionHandoffLocatorSchema as locatorSchema,
  htmlReconstructionApprovalSchema, type HtmlReconstructionHandoffLocator } from "./composition-html-editing-reconstruction.contract";
import { createHtmlPrivateHandoffFiles } from "./composition-html-private-handoff-files.server";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { htmlEditingRevisionSchema } from "./html-editing/html-editing-revision.contract";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import { htmlReconstructionNativeResourcesSchema } from "./composition-html-editing-reconstruction-native-resources.server";
import { hyperframesAssetManifestSchema, HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS, HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { compositionConformanceContractSchema } from "./composition-preview-render-conformance";
import { conformanceReferenceSourceSchema } from "./composition-conformance-reference.service";
import { conformanceFontManifestSchema, conformanceFontManifestHash } from "./composition-conformance-font-bindings";
import { HTML_EDITING_SNAPSHOT_BUNDLE_POLICY } from "./composition-html-editing-snapshot-bundle-policy";

type Artifact = Awaited<ReturnType<ReturnType<typeof createHtmlHistoricalReconstructionArchivePreparer>>>;
const domain = "COURSEFORGE_PRIVATE_RECONSTRUCTION_HANDOFF_V1\n";
const hash = z.string().regex(/^[a-f0-9]{64}$/), uuid = z.string().uuid();
const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const usedIds = z.array(uuid).max(HYPERFRAMES_MAXIMUM_MANIFEST_ASSETS).refine(ids => new Set(ids).size === ids.length);
const candidateSchema = z.object({scope: z.literal("PREPARED_NEW_CONTENT_NOT_HISTORICAL_REPUBLICATION_OR_APPROVAL"),
  origin: htmlReconstructionOriginSchema, target: htmlReconstructionTargetSchema, document: compositionEditorDocumentSchema,
  documentHash: hash, initialRevisions: z.array(z.object({clipId: z.string(), revision: htmlEditingRevisionSchema,
    revisionSha256: hash, sourceSha256: hash, usedAssetIds: usedIds}).strict()).min(1).max(HTML_EDITING_LIMITS.elements),
  nativeResources: htmlReconstructionNativeResourcesSchema, usedAssetIds: usedIds, requiredReviews: htmlReconstructionReviewsSchema,
}).strict();
const metadataSchema = z.object({scope: z.literal("PREPARED_RECONSTRUCTED_ARCHIVE_NOT_APPROVED_CREATED_OR_PUBLISHED"),
  candidate: candidateSchema,
  prepared: z.object({scope: z.literal("PREPARED_ARCHIVE_NOT_UPLOADED_OR_RENDERED"), projectHash: hash, documentHash: hash,
    contract: compositionConformanceContractSchema, assets: hyperframesAssetManifestSchema, metadata: conformanceReferenceSourceSchema,
    fontManifest: conformanceFontManifestSchema, bundle: z.object({archivePath: z.literal(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.archivePath),
      encodedBundle: z.string().max(HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes), sha256: hash}).strict(),
  }).strict(),
}).strict();
const receiptSchema = z.object({version: z.literal(1), locator: locatorSchema, seal: hash}).strict();

/** Structural/pin checks only: loading sealed producer bytes never recompiles,
 * executes, authorizes current grants or converts metadata into approval. */
function metadata(raw: unknown) {
  const parsed = metadataSchema.parse(raw), {candidate, prepared} = parsed, {origin, target} = candidate;
  if (origin.compositionId === target.compositionId || origin.documentId === target.documentId || origin.draftId === target.documentId
    || origin.revisionId === target.revisionId || hashCompositionDocument(candidate.document) !== candidate.documentHash
    || candidate.documentHash !== prepared.documentHash || prepared.contract.documentHash !== candidate.documentHash
    || prepared.metadata.documentHash !== candidate.documentHash || prepared.contract.schemaVersion !== 4
    || !prepared.contract.renderExecution || digest(prepared.bundle.encodedBundle) !== prepared.bundle.sha256
    || Buffer.byteLength(prepared.bundle.encodedBundle) > HTML_EDITING_SNAPSHOT_BUNDLE_POLICY.maximumBytes
    || prepared.metadata.htmlEditingSnapshot?.sha256 !== prepared.bundle.sha256
    || prepared.metadata.htmlEditingSnapshot.path !== prepared.bundle.archivePath
    || prepared.metadata.nativeDocumentSha256 !== digest(JSON.stringify(candidate.document, null, 2))
    || prepared.metadata.contractSha256 !== digest(JSON.stringify(prepared.contract, null, 2))
    || prepared.metadata.fontManifestSha256 !== conformanceFontManifestHash(prepared.fontManifest)
    || conformanceFontManifestHash(candidate.nativeResources.fontManifest) !== conformanceFontManifestHash(prepared.fontManifest)
    || !isDeepStrictEqual([...candidate.usedAssetIds].sort(), prepared.assets.map(asset => asset.productionAssetId).sort())
    || !isDeepStrictEqual(prepared.metadata.bindings, prepared.assets.map(asset => ({assetId: asset.productionAssetId,
      checksum: asset.checksum, fileSizeBytes: asset.fileSizeBytes, localPath: `conformance-media/${asset.productionAssetId}`,
      mimeType: asset.mimeType, storageBucket: asset.storageBucket ?? "production-assets", storagePath: asset.storagePath})))
    || candidate.nativeResources.assets.some(asset => !isDeepStrictEqual(asset,
      prepared.assets.find(preparedAsset => preparedAsset.productionAssetId === asset.productionAssetId)))) throw new Error();
  const bundle = JSON.parse(prepared.bundle.encodedBundle);
  const byClip = (first: {manifest: {binding: {clipId: string}}}, second: {manifest: {binding: {clipId: string}}}) =>
    first.manifest.binding.clipId < second.manifest.binding.clipId ? -1 : first.manifest.binding.clipId > second.manifest.binding.clipId ? 1 : 0;
  if (bundle.format !== "courseforge-html-editable-snapshot-bundle-v2" || bundle.schemaVersion !== 2
    || bundle.organizationId !== origin.organizationId || bundle.documentId !== target.documentId || bundle.documentHash !== candidate.documentHash
    || !Array.isArray(bundle.revisions) || !isDeepStrictEqual(bundle.revisions,
      candidate.initialRevisions.map(initial => initial.revision).sort(byClip))) throw new Error();
  const pointers = candidate.document.htmlEditing?.items ?? [];
  if (pointers.length !== candidate.initialRevisions.length || new Set(candidate.initialRevisions.map(entry => entry.clipId)).size !== pointers.length) throw new Error();
  for (const initial of candidate.initialRevisions) {
    const pointer = pointers.find(item => item.clipId === initial.clipId), binding = initial.revision.manifest.binding;
    const clip = candidate.document.clips.find(item => item.id === initial.clipId);
    if (!pointer || pointer.revisionSha256 !== initial.revisionSha256 || pointer.sourceSha256 !== initial.sourceSha256
      || pointer.revisionVersion !== 1 || initial.revision.version !== 1 || initial.revision.state.overrides.length
      || pointer.templateId !== binding.templateId || pointer.templateVersion !== binding.templateVersion
      || pointer.sourceSha256 !== binding.sourceSha256 || pointer.manifestSha256 !== binding.manifestSha256
      || binding.organizationId !== origin.organizationId
      || binding.documentId !== target.documentId || binding.revisionId !== target.revisionId || binding.clipId !== initial.clipId
      || !clip || clip.source.type !== "DECK_SLIDE" || clip.source.html !== initial.revision.sourceHtml
      || digest(initial.revision.sourceHtml) !== initial.sourceSha256) throw new Error();
  }
  return parsed;
}

// Host-only structural verification of persisted metadata. This does NOT
// replace the producer seal, independent review or current-authority checks.
export {metadata as verifyHtmlReconstructionArtifactMetadata};
export type HtmlReconstructionArtifactMetadata = ReturnType<typeof metadata>;

function locate(candidateId: string, artifact: ReturnType<typeof metadata>, metadataSha256: string) {
  const {origin, target} = artifact.candidate;
  return locatorSchema.parse({scope: "RECONSTRUCTION_HANDOFF_LOCATOR_NOT_APPROVAL_OR_CREATION", candidateId,
    organizationId: origin.organizationId, sourceCompositionId: origin.compositionId, sourceDraftId: origin.draftId,
    targetCompositionId: target.compositionId, targetDocumentId: target.documentId, targetRevisionId: target.revisionId,
    projectHash: artifact.prepared.projectHash, metadataSha256});
}

/** Private pre-existing directory with restricted OS ACL; key stays elsewhere.
 * HMAC is producer integrity, not reviewer approval. Privileged/same-user writers
 * are outside the boundary. Receipt is written last; partial state is preserved.
 * Same files mechanism as historical handoff, DIFFERENT schema/domain/semantics. */
export function createHtmlReconstructionHandoff(configuration: {rootDirectory: string; integrityKey: Uint8Array}) {
  if (!isAbsolute(configuration.rootDirectory) || !(configuration.integrityKey instanceof Uint8Array)
    || configuration.integrityKey.length !== 32) throw new Error("HTML_RECONSTRUCTION_HANDOFF_CONFIGURATION_INVALID");
  const files = createHtmlPrivateHandoffFiles(configuration.rootDirectory), key = Buffer.from(configuration.integrityKey);
  const seal = (locator: HtmlReconstructionHandoffLocator) => createHmac("sha256", key).update(domain)
    .update(JSON.stringify(locatorSchema.parse(locator))).digest("hex");
  async function load(input: HtmlReconstructionHandoffLocator, signal?: AbortSignal): Promise<Artifact> {
    const locator = locatorSchema.parse(input);
    const receipt = receiptSchema.parse(JSON.parse((await files.read(locator.candidateId, "handoff.json", policy.receiptBytes, signal)).toString("utf8")));
    if (!isDeepStrictEqual(receipt.locator, locator)
      || !timingSafeEqual(Buffer.from(receipt.seal, "hex"), Buffer.from(seal(locator), "hex"))) throw new Error();
    const encoded = await files.read(locator.candidateId, "artifact.json", policy.candidateBytes, signal);
    const archiveBytes = await files.read(locator.candidateId, "candidate.zip", HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES, signal);
    if (digest(encoded) !== locator.metadataSha256 || digest(archiveBytes) !== locator.projectHash) throw new Error();
    const parsed = metadata(JSON.parse(encoded.toString("utf8")));
    if (!isDeepStrictEqual(locate(locator.candidateId, parsed, digest(encoded)), locator)) throw new Error();
    return {...parsed, prepared: {...parsed.prepared, archiveBytes}};
  }
  return {
    async save(input: {candidateId: string; artifact: Artifact}, signal?: AbortSignal) {
      try {
        signal?.throwIfAborted();
        const candidateId = uuid.parse(input.candidateId), {archiveBytes: bytes, ...prepared} = input.artifact.prepared;
        if (!(bytes instanceof Uint8Array) || !bytes.byteLength || bytes.byteLength > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES) throw new Error();
        const archiveBytes = Buffer.from(bytes);
        const encoded = Buffer.from(JSON.stringify({scope: input.artifact.scope, candidate: input.artifact.candidate, prepared}));
        if (encoded.length > policy.candidateBytes || digest(archiveBytes) !== prepared.projectHash) throw new Error();
        const parsed = metadata(JSON.parse(encoded.toString("utf8"))), locator = locate(candidateId, parsed, digest(encoded));
        await files.create(candidateId, signal);
        await files.write(candidateId, "candidate.zip", archiveBytes, signal);
        await files.write(candidateId, "artifact.json", encoded, signal);
        await files.write(candidateId, "handoff.json", Buffer.from(JSON.stringify({version: 1, locator, seal: seal(locator)})), signal);
        await load(locator, signal); return locator;
      } catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_HANDOFF_SAVE_UNCONFIRMED");}
    },
    async load(locator: HtmlReconstructionHandoffLocator, signal?: AbortSignal) {
      try {return await load(locator, signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_HANDOFF_UNAVAILABLE");}
    },
  };
}

/** Host must authenticate reviewerId independently. This binds the evidence to
 * frozen bytes and provenance ONLY; SQL creation still needs current authority,
 * create-only transaction and durable intent/receipt. No writes occur here. */
export async function readReviewedHtmlReconstructionHandoff(input: {
  handoff: ReturnType<typeof createHtmlReconstructionHandoff>; locator: HtmlReconstructionHandoffLocator;
  approval: z.infer<typeof htmlReconstructionApprovalSchema>; authenticatedReviewerId: string; signal?: AbortSignal;
}) {
  try {
    const locator = locatorSchema.parse(input.locator), approval = htmlReconstructionApprovalSchema.parse(input.approval);
    const reviewerId = uuid.parse(input.authenticatedReviewerId), {handoff, signal} = input;
    if (approval.reviewerId !== reviewerId || approval.candidateId !== locator.candidateId
      || approval.reviewedProjectHash !== locator.projectHash || approval.reviewedMetadataSha256 !== locator.metadataSha256) throw new Error();
    const artifact = await handoff.load(locator, signal);
    return {scope: "REVIEW_BOUND_RECONSTRUCTION_NOT_CURRENT_AUTHORITY_OR_CREATION" as const, locator, approval, artifact};
  } catch {input.signal?.throwIfAborted(); throw new Error("HTML_RECONSTRUCTION_REVIEW_UNAVAILABLE");}
}
