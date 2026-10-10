import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { isAbsolute } from "node:path";
import { z } from "zod";
import type { createHistoricalHtmlCandidatePreparer } from "./composition-html-editing-historical-candidate.server";
import { HTML_HISTORICAL_PUBLICATION_POLICY as policy, htmlHistoricalPublicationProvenanceSchema } from "./composition-html-editing-historical-publication.contract";
import { htmlSnapshotRepublicationReviewSchema } from "./composition-html-editing-snapshot-republication-review.contract";
import { HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES } from "../hyperframes/hyperframes.types";
import { createHtmlPrivateHandoffFiles } from "./composition-html-private-handoff-files.server";

type Artifact = Awaited<ReturnType<ReturnType<typeof createHistoricalHtmlCandidatePreparer>>>;
const domain = "COURSEFORGE_PRIVATE_HISTORICAL_HANDOFF_V1\n";
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const historicalHtmlHandoffLocatorSchema = z.object({candidateId: z.string().uuid(), organizationId: z.string().uuid(),
  compositionId: z.string().uuid(), draftId: z.string().uuid(), projectHash: hash, metadataSha256: hash}).strict();
const locatorSchema = historicalHtmlHandoffLocatorSchema;
export type HistoricalHtmlHandoffLocator = z.infer<typeof locatorSchema>;
const envelopeSchema = z.object({version: z.literal(1), locator: locatorSchema, seal: hash}).strict();
const filenames = {archive: "candidate.zip", metadata: "artifact.json", receipt: "handoff.json"} as const;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Host-only disk handoff, NOT approval or execution. The trusted preparer owns
 * the artifact; its seal prevents edited local JSON becoming trusted producer
 * input on restart. Keep the key outside this folder and out of browser/HTTP.
 * Caller supplies a pre-existing private directory with exclusive OS access.
 * Windows requires a restricted ACL: POSIX mode bits alone do not provide it.
 * Same-user/root attackers and races by privileged writers are outside this
 * boundary. Staging MUST still verify current authority and independent approval. */
export function createHistoricalHtmlOperatorHandoff(configuration: {rootDirectory: string; integrityKey: Uint8Array}) {
  if (!isAbsolute(configuration.rootDirectory) || !(configuration.integrityKey instanceof Uint8Array)
    || configuration.integrityKey.length !== 32) throw new Error("HTML_HISTORICAL_HANDOFF_CONFIGURATION_INVALID");
  const rootDirectory = configuration.rootDirectory, key = Buffer.from(configuration.integrityKey);
  const files = createHtmlPrivateHandoffFiles(rootDirectory);
  const seal = (locator: HistoricalHtmlHandoffLocator) => createHmac("sha256", key).update(domain)
    .update(JSON.stringify(locatorSchema.parse(locator))).digest("hex");
  async function load(input: HistoricalHtmlHandoffLocator, signal?: AbortSignal): Promise<Artifact> {
    const locator = locatorSchema.parse(input);
    const receipt = envelopeSchema.parse(JSON.parse((await files.read(locator.candidateId, filenames.receipt, policy.receiptBytes, signal)).toString("utf8")));
    if (JSON.stringify(receipt.locator) !== JSON.stringify(locator)
      || !timingSafeEqual(Buffer.from(receipt.seal, "hex"), Buffer.from(seal(locator), "hex"))) throw new Error();
    const metadata = await files.read(locator.candidateId, filenames.metadata, policy.candidateBytes, signal);
    const archiveBytes = await files.read(locator.candidateId, filenames.archive, HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES, signal);
    if (digest(metadata) !== locator.metadataSha256 || digest(archiveBytes) !== locator.projectHash) throw new Error();
    const parsed = JSON.parse(metadata.toString("utf8"));
    const provenance = htmlHistoricalPublicationProvenanceSchema.parse(parsed.provenance);
    const review = htmlSnapshotRepublicationReviewSchema.parse(parsed.review);
    if (parsed.scope !== "PREPARED_HISTORICAL_ARCHIVE_NOT_APPROVED_UPLOADED_OR_PUBLISHED"
      || parsed.prepared?.projectHash !== locator.projectHash || parsed.prepared?.archiveBytes !== undefined
      || Object.entries({candidateId: locator.candidateId, organizationId: locator.organizationId,
        compositionId: locator.compositionId, draftId: locator.draftId}).some(([field, value]) => provenance[field as keyof typeof provenance] !== value)
      || review.organizationId !== locator.organizationId || review.compositionId !== locator.compositionId || review.draftId !== locator.draftId) throw new Error();
    // Only metadata sealed by this host can cross this type boundary. The
    // repository's full payload/current-authority verifier remains mandatory.
    return {...parsed, provenance, review, prepared: {...parsed.prepared, archiveBytes}} as Artifact;
  }
  return {
    async save(artifact: Artifact, signal?: AbortSignal): Promise<HistoricalHtmlHandoffLocator> {
      try {
        signal?.throwIfAborted();
        const provenance = htmlHistoricalPublicationProvenanceSchema.parse(artifact.provenance);
        const {archiveBytes: callerBytes, ...prepared} = artifact.prepared;
        const archiveBytes = Buffer.from(callerBytes);
        const metadata = Buffer.from(JSON.stringify({scope: artifact.scope, provenance,
          review: htmlSnapshotRepublicationReviewSchema.parse(artifact.review), prepared}));
        if (metadata.length > policy.candidateBytes || !archiveBytes.length || archiveBytes.length > HYPERFRAMES_CLOUD_ARCHIVE_LIMIT_BYTES
          || digest(archiveBytes) !== prepared.projectHash) throw new Error();
        const locator = locatorSchema.parse({candidateId: provenance.candidateId, organizationId: provenance.organizationId,
          compositionId: provenance.compositionId, draftId: provenance.draftId, projectHash: prepared.projectHash, metadataSha256: digest(metadata)});
        // No overwrite, cleanup, retry or silent adoption of partial directories.
        await files.create(locator.candidateId, signal);
        await files.write(locator.candidateId, filenames.archive, archiveBytes, signal);
        await files.write(locator.candidateId, filenames.metadata, metadata, signal);
        await files.write(locator.candidateId, filenames.receipt, Buffer.from(JSON.stringify({version: 1, locator, seal: seal(locator)})), signal);
        await load(locator, signal); return locator;
      } catch {signal?.throwIfAborted(); throw new Error("HTML_HISTORICAL_HANDOFF_SAVE_UNCONFIRMED");}
    },
    async load(locator: HistoricalHtmlHandoffLocator, signal?: AbortSignal) {
      try {return await load(locator, signal);}
      catch {signal?.throwIfAborted(); throw new Error("HTML_HISTORICAL_HANDOFF_UNAVAILABLE");}
    },
  };
}
