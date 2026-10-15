import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { createHtmlHistoricalReconstructionArchivePreparer } from "./composition-html-editing-reconstruction-archive.server";
import { createHtmlReconstructionCompositionResourceAcquirer } from "./composition-html-editing-reconstruction-resources.server";
import { createHtmlReconstructionAuthorityVerifier } from "./composition-html-editing-reconstruction-authority.server";
import { createHtmlReconstructionHandoff } from "./composition-html-editing-reconstruction-handoff.server";
import { createHtmlReconstructionOperationJournal } from "./composition-html-editing-reconstruction-journal.server";
import { createHtmlReconstructionReviewJournal } from "./composition-html-editing-reconstruction-review-journal.server";
import { HtmlReconstructionReviewRepository } from "./composition-html-editing-reconstruction-review-repository.server";
import { HtmlReconstructionRepository } from "./composition-html-editing-reconstruction-repository.server";
import { createHtmlEditingSnapshotArchiveStore } from "./composition-html-editing-snapshot-storage.server";
import { createHtmlReconstructionOperatorWorkflow } from "./composition-html-editing-reconstruction-operator.server";

type Backend = Parameters<typeof createHtmlReconstructionCompositionResourceAcquirer>[0];
type Catalog = Parameters<typeof createHtmlReconstructionAuthorityVerifier>[0]["readCatalog"];

/** Host configuration only. Roots already exist with restricted OS ACL; this
 * factory never creates roots, installs keys/flags or applies migrations. */
export async function createHtmlReconstructionOperatorHost(configuration: Backend & {readCatalog: Catalog;
  handoffRoot: string; reviewRoot: string; operationRoot: string; integrityKey: Uint8Array}) {
  const {supabase, supabaseUrl, serviceRoleKey, fetchImpl, readCatalog, integrityKey} = configuration;
  const key = Buffer.from(integrityKey);
  const roots = [configuration.handoffRoot, configuration.reviewRoot, configuration.operationRoot];
  if (key.length !== 32 || roots.some(path => !isAbsolute(path))) throw new Error("HTML_RECONSTRUCTION_HOST_CONFIGURATION_INVALID");
  const resolved: string[] = [];
  for (const path of roots) {
    const stat = await lstat(path);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("HTML_RECONSTRUCTION_HOST_CONFIGURATION_INVALID");
    resolved.push(await realpath(path));
  }
  const contains = (parent: string, child: string) => {
    const difference = relative(parent, child);
    return difference === "" || !isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`);
  };
  if (resolved.some((root, index) => resolved.some((other, otherIndex) => index !== otherIndex && contains(root, other))))
    throw new Error("HTML_RECONSTRUCTION_HOST_ROOTS_MUST_BE_DISJOINT");
  const [handoffRoot, reviewRoot, operationRoot] = resolved;
  const backend = {supabase, supabaseUrl, serviceRoleKey, fetchImpl};
  const handoff = createHtmlReconstructionHandoff({rootDirectory: handoffRoot, integrityKey: key});
  const reviewJournal = createHtmlReconstructionReviewJournal({rootDirectory: reviewRoot, integrityKey: key});
  const operationJournal = createHtmlReconstructionOperationJournal({rootDirectory: operationRoot, integrityKey: key});
  return createHtmlReconstructionOperatorWorkflow({handoff, reviewJournal, operationJournal,
    reviews: new HtmlReconstructionReviewRepository(supabase),
    repository: new HtmlReconstructionRepository(supabase, createHtmlReconstructionAuthorityVerifier({supabase, readCatalog}), operationJournal.preserveCreationIntent),
    prepare: createHtmlHistoricalReconstructionArchivePreparer({supabase, storageOrigin: supabaseUrl, fetchResource: fetchImpl,
      readCatalog, acquireResources: createHtmlReconstructionCompositionResourceAcquirer(backend)}),
    storeArchive: createHtmlEditingSnapshotArchiveStore(backend),
  });
}
