import type { HtmlSnapshotPublicationLock } from "./composition-html-snapshot-publication-lock.client";
import { z } from "zod";
import type { HtmlSnapshotLocatorStorage } from "./composition-html-snapshot-locator.client";
import { boundedWait } from "./composition-html-editing-dispatch.client";
import { HTML_RECONSTRUCTION_RESOURCE_LINK_POLICY as policy, htmlReconstructionResourceCandidateSchema,
  type HtmlReconstructionResourceCandidate } from "./composition-html-editing-reconstruction-resource-link.contract";
import { consultHtmlReconstructionResource, requestHtmlReconstructionResourceLink } from "./composition-html-editing-reconstruction-resource-link.client";
import { htmlReconstructionResourceLinkScopeSchema, readHtmlReconstructionResourceLinkJournal, beginHtmlReconstructionResourceLinkJournal,
  recordHtmlReconstructionResourceLinkReceipt, closeVerifiedHtmlReconstructionResourceLinkJournal,
  type HtmlReconstructionResourceLinkScope } from "./composition-html-editing-reconstruction-resource-link-journal.client";

const actionSchema = z.discriminatedUnion("mode", [
  z.object({mode: z.literal("LINK"), candidate: htmlReconstructionResourceCandidateSchema, confirmedResourceOnly: z.literal(true)}).strict(),
  z.object({mode: z.literal("RECOVER"), operationId: z.string().uuid()}).strict(),
  z.object({mode: z.literal("CLOSE"), operationId: z.string().uuid()}).strict(),
]);

/** Resource link only. No native reservation/adoption is appropriate here:
 * SQL never changes document/version, original or publication. Current edit and
 * resource delivery still reauthorize independently of this historical receipt. */
export async function coordinateHtmlReconstructionResourceLink(input: {
  scope: HtmlReconstructionResourceLinkScope; storage: HtmlSnapshotLocatorStorage | null; lock: HtmlSnapshotPublicationLock | null;
  signal: AbortSignal; isCurrent: () => boolean; fetcher?: typeof fetch; createOperationId?: () => string;
  action: {mode: "LINK"; candidate: HtmlReconstructionResourceCandidate; confirmedResourceOnly: true}
    | {mode: "RECOVER"; operationId: string} | {mode: "CLOSE"; operationId: string};
}) {
  const scope = htmlReconstructionResourceLinkScopeSchema.parse(input.scope), action = actionSchema.parse(input.action), signal = AbortSignal.any([input.signal, AbortSignal.timeout(policy.timeoutMs)]);
  const guard = () => {signal.throwIfAborted(); if (!input.isCurrent()) throw new Error("El contexto cambió. Conserva el seguimiento.");};
  guard(); if (!input.lock || !input.storage) throw new Error("El bloqueo o seguimiento durable no está disponible. No se enviará el enlace.");
  return boundedWait(() => input.lock!.runExclusive({actorId: scope.actorId, organizationId: scope.organizationId, draftId: scope.draftId}, async () => {
    guard(); let pending = await readHtmlReconstructionResourceLinkJournal(input.storage, scope); guard();
    if (action.mode === "LINK") {
      if (action.confirmedResourceOnly !== true || pending.status !== "EMPTY") throw new Error("Hay seguimiento pendiente o indisponible. No se enviará otro enlace.");
      const candidate = htmlReconstructionResourceCandidateSchema.parse(action.candidate);
      if (candidate.alreadyLinked || candidate.organizationId !== scope.organizationId || candidate.compositionId !== scope.compositionId
        || candidate.draftId !== scope.draftId) throw new Error("El candidato no pertenece al contexto actual.");
      const fresh = await consultHtmlReconstructionResource({request: {actorId: scope.actorId, organizationId: scope.organizationId,
        draftId: scope.draftId, query: {compositionId: scope.compositionId, assetId: candidate.asset.productionAssetId}}, signal, fetcher: input.fetcher}); guard();
      if (JSON.stringify(fresh) !== JSON.stringify(candidate)) throw new Error("El medio o la base cambiaron. Consulta y revisa de nuevo.");
      const entry = await beginHtmlReconstructionResourceLinkJournal(input.storage, {...scope, operationId: (input.createOperationId ?? (() => crypto.randomUUID()))(),
        request: {assetId: candidate.asset.productionAssetId, resourceIdentitySha256: candidate.resourceIdentitySha256,
          expectedDocumentHash: candidate.currentDocumentHash, expectedVersion: candidate.currentVersion, confirmedResourceOnly: true}}); guard();
      if (!entry) throw new Error("No se pudo preservar el seguimiento antes del envío.");
      pending = await readHtmlReconstructionResourceLinkJournal(input.storage, scope); guard();
      if (pending.status !== "PENDING" || JSON.stringify(pending.entry) !== JSON.stringify(entry)) throw new Error("El seguimiento cambió. No se enviará el enlace.");
      const result = await requestHtmlReconstructionResourceLink({command: entry.command, mode: "LINK", signal, fetcher: input.fetcher}); guard();
      if (result.status !== "RECORDED" || !await recordHtmlReconstructionResourceLinkReceipt(input.storage, scope, entry, result.receipt))
        throw new Error("Resultado sin confirmar. Conserva el seguimiento y consulta el recibo.");
      guard(); return result.receipt;
    }
    if (pending.status !== "PENDING" || pending.entry.command.operationId !== action.operationId) throw new Error("No coincide el seguimiento de esta operación.");
    const entry = pending.entry, result = await requestHtmlReconstructionResourceLink({command: entry.command, mode: "READ", signal, fetcher: input.fetcher}); guard();
    if (result.status === "NOT_FOUND") throw new Error("El recibo aún no está confirmado. Conserva el seguimiento; no repitas el envío.");
    const recorded = await recordHtmlReconstructionResourceLinkReceipt(input.storage, scope, entry, result.receipt); guard();
    if (!recorded || action.mode === "CLOSE" && !await closeVerifiedHtmlReconstructionResourceLinkJournal(input.storage, scope, recorded, () => {guard(); return true;}))
      throw new Error("No se pudo conservar/cerrar el seguimiento verificado.");
    guard(); return result.receipt;
  }), signal);
}
