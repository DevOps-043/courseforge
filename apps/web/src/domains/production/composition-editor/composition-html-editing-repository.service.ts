import { z } from "zod";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { bindHtmlEditingRevisionToComposition } from "./composition-html-editing-document.server";
import { htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingBindingsMatch } from "./html-editing/html-editing-validation";
import { HTML_EDITING_REVISION_POLICY, HtmlEditingRevisionError, htmlEditingRevisionSchema } from "./html-editing/html-editing-revision.contract";
import { verifyHtmlEditingRevision } from "./html-editing/html-editing-revision.server";
import type { HtmlEditingRevisionRepository } from "./html-editing/html-editing-revision-gateway.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { prepareInitialHtmlEditingRevision } from "./html-editing/html-editing-bootstrap.server";
import { HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { htmlEditingRevisionLocatorSchema } from "./composition-html-editing-mutation.contract";
import { HTML_EDITING_OPERATION_POLICY, htmlEditingOperationIdentitySchema, htmlEditingOperationReceiptSchema, htmlEditingOperationReadSchema,
  type HtmlEditingOperationIdentity, type HtmlEditingOperationReceipt } from "./composition-html-editing-operation.contract";
import { computeHtmlEditingInitializationRequestSha256 } from "./composition-html-editing-initialization-operation-digest.server";
import { HTML_EDITING_INITIALIZATION_OPERATION_POLICY, htmlEditingInitializationOperationReceiptSchema,
  htmlEditingInitializationOperationReadSchema, type HtmlEditingInitializationOperationReceipt } from "./composition-html-editing-initialization-operation.contract";

export { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const readSchema = z.object({
  revision: htmlEditingRevisionSchema, revisionSha256: hashSchema, document: z.unknown(), compositionDocumentHash: hashSchema,
  grantedAssetIds: z.array(z.string().uuid()).max(6400).refine(ids => new Set(ids).size === ids.length),
}).strict();
const scopeSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true });
type ReadInput = Parameters<HtmlEditingRevisionRepository["readAuthorized"]>[0];
type AppendInput = Parameters<HtmlEditingRevisionRepository["appendCompareAndSwap"]>[0];

/** Service-only adapter for authorized RPCs. New durable variants require their
 * matching migrations and coordinated host/HTTP/client release before activation.
 * Logical image aliases are NOT evidence of materialized bytes or render readiness.
 * Render consumers still require independent asset byte/hash/MIME materialization. */
export class SupabaseHtmlEditingRevisionRepository implements HtmlEditingRevisionRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  /** Prepared durable path, not called by the legacy mutation route yet. Native
   * append/revision/receipt share one RPC transaction, including no-op receipts. */
  async commitOperation(input: AppendInput & HtmlEditingOperationIdentity & { changed: boolean }) {
    if (typeof input.changed !== "boolean" || !["COMMAND", "RESTORE"].includes(input.operation)) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const identity = htmlEditingOperationIdentitySchema.parse({ operationId: input.operationId, requestSha256: input.requestSha256 });
    const args = this.scopeArguments(input), context = await this.readContext(input);
    if (context.revision.version !== input.expected.version || context.revisionSha256 !== input.expected.sha256
      || context.compositionDocumentHash !== input.expectedCompositionDocumentHash) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    const authority = { authoritativeBinding: context.revision.manifest.binding,
      grantedAssetIds: context.grantedAssetIds, imageSources: context.imageSources };
    if (!htmlEditingBindingsMatch(input.authoritativeBinding, authority.authoritativeBinding)) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    const next = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(input.revision) });
    if (next.sha256 !== input.sha256 || next.revision.version !== input.expected.version + (input.changed ? 1 : 0)
      || next.revision.sourceHtml !== context.revision.sourceHtml
      || (!input.changed && (next.sha256 !== input.expected.sha256 || JSON.stringify(next.revision) !== JSON.stringify(context.revision)))
      || (input.changed && next.sha256 === input.expected.sha256)) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const native = input.changed ? bindHtmlEditingRevisionToComposition({ ...authority, document: context.document,
      revision: next.revision, revisionSha256: next.sha256 }) : { document: context.document, documentHash: context.compositionDocumentHash };
    const response = await this.callRpc("commit_html_editing_operation", { ...args,
      p_operation_id: identity.operationId, p_request_sha256: identity.requestSha256, p_changed: input.changed,
      p_expected_version: input.expected.version, p_expected_sha256: input.expected.sha256,
      p_expected_document_hash: input.expectedCompositionDocumentHash, p_binding: authority.authoritativeBinding,
      p_revision: next.revision, p_revision_sha256: next.sha256, p_document: native.document,
      p_document_hash: native.documentHash, p_used_asset_ids: next.compiled.usedAssetIds, p_operation: input.operation,
    }, true, input.signal);
    if (Buffer.byteLength(JSON.stringify(response) ?? "", "utf8") > HTML_EDITING_OPERATION_POLICY.maximumReceiptBytes) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    const receipt = htmlEditingOperationReceiptSchema.safeParse(response);
    if (!receipt.success || !this.matchesOperation(receipt.data, input, identity)
      || receipt.data.acknowledgment.changed !== input.changed
      || receipt.data.acknowledgment.previous.version !== input.expected.version
      || receipt.data.acknowledgment.previous.sha256 !== input.expected.sha256
      || receipt.data.acknowledgment.next.version !== next.revision.version
      || receipt.data.acknowledgment.next.sha256 !== next.sha256) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    return receipt.data;
  }

  /** Missing receipt is not proof of failure; no retry, rollback or current-state
   * inference. Reader independently reauthorizes the current owner and template. */
  async readOperation(input: ReadInput & HtmlEditingOperationIdentity) {
    const identity = htmlEditingOperationIdentitySchema.parse({ operationId: input.operationId, requestSha256: input.requestSha256 });
    const response = await this.callRpc("read_html_editing_operation", { ...this.scopeArguments(input), p_operation_id: identity.operationId }, false, input.signal);
    if (Buffer.byteLength(JSON.stringify(response) ?? "", "utf8") > HTML_EDITING_OPERATION_POLICY.maximumReceiptBytes) throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
    const result = htmlEditingOperationReadSchema.safeParse(response);
    if (!result.success || (result.data.status === "RECORDED" && !this.matchesOperation(result.data.receipt, input, identity))) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    return result.data;
  }

  /** Prepared initialization receipt reader; historical metadata only. RPC must
   * reauthorize current draft/actor/template before returning any stored receipt. */
  async readInitializationOperation(input: ReadInput & HtmlEditingOperationIdentity) {
    const identity = htmlEditingOperationIdentitySchema.parse({ operationId: input.operationId, requestSha256: input.requestSha256 });
    const response = await this.callRpc("read_html_editing_initialization_operation", { ...this.scopeArguments(input),
      p_operation_id: identity.operationId }, false, input.signal);
    if (Buffer.byteLength(JSON.stringify(response) ?? "", "utf8") > HTML_EDITING_INITIALIZATION_OPERATION_POLICY.maximumReceiptBytes) {
      throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
    }
    const result = htmlEditingInitializationOperationReadSchema.safeParse(response);
    if (!result.success || (result.data.status === "RECORDED" && !this.matchesInitializationOperation(result.data.receipt, input, identity))) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    return result.data;
  }

  private matchesInitializationOperation(receipt: HtmlEditingInitializationOperationReceipt,
    input: ReadInput, identity: HtmlEditingOperationIdentity) {
    return receipt.operationId === identity.operationId && receipt.requestSha256 === identity.requestSha256
      && computeHtmlEditingInitializationRequestSha256(receipt.request) === receipt.requestSha256
      && receipt.owner.actorId === input.actorId && receipt.owner.organizationId === input.scope.organizationId
      && receipt.owner.draftId === input.scope.documentId && receipt.clipId === input.scope.clipId;
  }

  private matchesOperation(receipt: HtmlEditingOperationReceipt,
    input: ReadInput, identity: HtmlEditingOperationIdentity) {
    return receipt.operationId === identity.operationId && receipt.requestSha256 === identity.requestSha256
      && receipt.owner.actorId === input.actorId && receipt.owner.organizationId === input.scope.organizationId
      && receipt.owner.draftId === input.scope.documentId && receipt.clipId === input.scope.clipId;
  }

  /** Preferred host entry: resolve the installed declaration rather than accept
   * template JSON. Source/anchor/grants still require independent authorized reads. */
  async registerInstalled(input: ReadInput & Omit<Parameters<typeof prepareInitialHtmlEditingRevision>[0], "encodedTrustedTemplate"> & {
    catalog: HtmlEditingTemplateCatalog; templateId: string; templateVersion: number;
    initializationOperationId?: string;
  }) {
    this.scopeArguments(input);
    if (typeof input.sourceHtml !== "string" || input.sourceHtml.length > HTML_EDITING_LIMITS.sourceBytes
      || Buffer.byteLength(input.sourceHtml, "utf8") > HTML_EDITING_LIMITS.sourceBytes) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    const encodedTrustedTemplate = input.catalog.resolve({ organizationId: input.scope.organizationId,
      templateId: input.templateId, templateVersion: input.templateVersion,
      sourceSha256: createHash("sha256").update(input.sourceHtml, "utf8").digest("hex") });
    return this.registerInitial({ ...input, encodedTrustedTemplate });
  }

  /** Host-only bootstrap: anchor/source/catalog/grants must already be resolved
   * independently of request declarations. Legacy bootstrap uses direct ACK and
   * readback; optional internal operation ID selects the prepared durable path.
   * A boolean registration ACK alone is insufficient: reconcile the exact first
   * revision against the authorized reader. Never retry a lost/uncertain write. */
  async registerInitial(input: ReadInput & Parameters<typeof prepareInitialHtmlEditingRevision>[0] & { initializationOperationId?: string }) {
    const args = this.scopeArguments(input);
    const initial = prepareInitialHtmlEditingRevision(input);
    const binding = initial.revision.manifest.binding;
    if (binding.organizationId !== input.scope.organizationId || binding.documentId !== input.scope.documentId
      || binding.clipId !== input.scope.clipId) throw new HtmlEditingRevisionError("INVALID_REVISION");
    if (input.initializationOperationId !== undefined) {
      const request = { templateId: binding.templateId, templateVersion: binding.templateVersion, expectedDocumentHash: binding.documentSha256 };
      const identity = htmlEditingOperationIdentitySchema.parse({ operationId: input.initializationOperationId,
        requestSha256: computeHtmlEditingInitializationRequestSha256(request) });
      const response = await this.callRpc("commit_html_editing_initialization_operation", { ...args,
        p_operation_id: identity.operationId, p_request_sha256: identity.requestSha256,
        p_expected_document_hash: binding.documentSha256, p_revision: initial.revision,
        p_revision_sha256: initial.sha256, p_used_asset_ids: initial.compiled.usedAssetIds,
      }, true, input.signal);
      if (Buffer.byteLength(JSON.stringify(response) ?? "", "utf8") > HTML_EDITING_INITIALIZATION_OPERATION_POLICY.maximumReceiptBytes) {
        throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
      }
      const receipt = htmlEditingInitializationOperationReceiptSchema.safeParse(response);
      if (!receipt.success || !this.matchesInitializationOperation(receipt.data, input, identity)
        || JSON.stringify(receipt.data.request) !== JSON.stringify(request)
        || receipt.data.acknowledgment.sha256 !== initial.sha256) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
      // Historical receipt is the atomic result, not a claim that initial v1 is
      // still current. Client performs its separate authorized refresh policy.
      return { ...receipt.data.acknowledgment, initializationReceipt: receipt.data };
    }
    const acknowledgement = await this.callRpc("register_html_editing_template_v2", {
      ...args, p_expected_document_hash: binding.documentSha256,
      p_revision: initial.revision, p_revision_sha256: initial.sha256,
      p_used_asset_ids: initial.compiled.usedAssetIds,
    }, true, input.signal);
    if (typeof acknowledgement !== "boolean") throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    try {
      const context = await this.readContext(input);
      if (context.revision.version !== 1 || context.revisionSha256 !== initial.sha256
        || context.compositionDocumentHash !== binding.documentSha256) {
        throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
      }
      // Recheck current permissions after registration too. Logical aliases are
      // not proof of image bytes, decoding or renderer readiness.
      verifyHtmlEditingRevision({ encodedRevision: JSON.stringify(context.revision),
        authoritativeBinding: binding, grantedAssetIds: context.grantedAssetIds, imageSources: context.imageSources });
      return { status: "CONFIRMED" as const, created: acknowledgement,
        version: 1 as const, sha256: initial.sha256, compositionDocumentHash: context.compositionDocumentHash };
    } catch {
      // Even cancellation or a readback conflict after the write is uncertainty,
      // not evidence that registration failed or authority can be rolled back.
      throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    }
  }

  async readAuthorized(input: ReadInput) {
    const context = await this.readContext(input);
    return { encodedRevision: JSON.stringify(context.revision), authoritativeBinding: context.revision.manifest.binding,
      grantedAssetIds: context.grantedAssetIds, imageSources: context.imageSources,
      compositionDocumentHash: context.compositionDocumentHash };
  }

  /** Historical data comes from a scoped server read, never browser-provided HTML.
   * Current grants are enforced when the gateway prepares the final restoration. */
  async readRestoreRevision(input: ReadInput & { restore: z.infer<typeof htmlEditingRevisionLocatorSchema> }): Promise<string> {
    const args = this.scopeArguments(input);
    const locator = htmlEditingRevisionLocatorSchema.safeParse(input.restore);
    if (!locator.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const payload = await this.callRpc("read_html_editing_restore_revision", { ...args,
      p_restore_version: locator.data.version, p_restore_sha256: locator.data.sha256 }, false, input.signal);
    if (Buffer.byteLength(JSON.stringify(payload) ?? "", "utf8") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
    const parsed = z.object({ revision: htmlEditingRevisionSchema, revisionSha256: hashSchema }).strict().safeParse(payload);
    if (!parsed.success || parsed.data.revisionSha256 !== locator.data.sha256 || parsed.data.revision.version !== locator.data.version) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    const revision = parsed.data.revision, binding = revision.manifest.binding;
    if (binding.organizationId !== input.scope.organizationId || binding.documentId !== input.scope.documentId || binding.clipId !== input.scope.clipId) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    const declaredIds = [...new Set(revision.manifest.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []))];
    const encodedRevision = JSON.stringify(revision);
    const verified = verifyHtmlEditingRevision({ encodedRevision, authoritativeBinding: binding, grantedAssetIds: declaredIds,
      imageSources: new Map(declaredIds.map(id => [id, `conformance-media/${id}`])) });
    if (verified.sha256 !== locator.data.sha256) throw new HtmlEditingRevisionError("INVALID_REVISION");
    return encodedRevision;
  }

  async appendCompareAndSwap(input: AppendInput): ReturnType<HtmlEditingRevisionRepository["appendCompareAndSwap"]> {
    const context = await this.readContext(input);
    if (context.revision.version !== input.expected.version || context.revisionSha256 !== input.expected.sha256
      || context.compositionDocumentHash !== input.expectedCompositionDocumentHash) return { status: "CONFLICT" };
    const authority = { authoritativeBinding: context.revision.manifest.binding,
      grantedAssetIds: context.grantedAssetIds, imageSources: context.imageSources };
    if (!htmlEditingBindingsMatch(input.authoritativeBinding, authority.authoritativeBinding)) {
      throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    }
    const next = verifyHtmlEditingRevision({ ...authority, encodedRevision: JSON.stringify(input.revision) });
    if (next.sha256 !== input.sha256 || next.revision.version !== input.expected.version + 1
      || next.revision.sourceHtml !== context.revision.sourceHtml) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    const native = bindHtmlEditingRevisionToComposition({ ...authority,
      document: context.document, revision: next.revision, revisionSha256: next.sha256 });
    const data = await this.callRpc("append_html_editing_revision", {
      ...this.scopeArguments(input), p_expected_version: input.expected.version, p_expected_sha256: input.expected.sha256,
      p_expected_document_hash: input.expectedCompositionDocumentHash, p_binding: authority.authoritativeBinding,
      p_revision: next.revision, p_revision_sha256: next.sha256, p_document: native.document, p_document_hash: native.documentHash,
      p_used_asset_ids: next.compiled.usedAssetIds, p_operation: input.operation,
    }, true, input.signal);
    const parsed = z.discriminatedUnion("status", [
      z.object({ status: z.literal("CONFLICT") }).strict(),
      z.object({ status: z.literal("COMMITTED"), version: z.number().int().positive(), sha256: hashSchema }).strict(),
    ]).safeParse(data);
    if (!parsed.success || (parsed.data.status === "COMMITTED" && (parsed.data.version !== next.revision.version || parsed.data.sha256 !== next.sha256))) {
      throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    }
    return parsed.data;
  }

  private async readContext(input: ReadInput) {
    const args = this.scopeArguments(input);
    const data = await this.callRpc("read_html_editing_revision", args, false, input.signal);
    if (Buffer.byteLength(JSON.stringify(data) ?? "", "utf8") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) {
      throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
    }
    const parsed = readSchema.safeParse(data);
    if (!parsed.success || Buffer.byteLength(JSON.stringify(parsed.data.revision), "utf8") > HTML_EDITING_REVISION_POLICY.maximumBytes) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    const row = parsed.data;
    const binding = row.revision.manifest.binding;
    if (binding.organizationId !== input.scope.organizationId || binding.documentId !== input.scope.documentId || binding.clipId !== input.scope.clipId) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    const declaredAssetIds = [...new Set(row.revision.manifest.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []))];
    if (row.grantedAssetIds.some(id => !declaredAssetIds.includes(id))) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const imageSources = new Map(declaredAssetIds.map(id => [id, `conformance-media/${id}`]));
    // Prior revoked overrides must remain removable. Validate stored integrity
    // against template policy here, and current grants against the final mutation.
    const verified = verifyHtmlEditingRevision({ encodedRevision: JSON.stringify(row.revision), authoritativeBinding: binding,
      grantedAssetIds: declaredAssetIds, imageSources });
    const parsedDocument = compositionEditorDocumentSchema.safeParse(row.document);
    if (!parsedDocument.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const document = parsedDocument.data;
    if (verified.sha256 !== row.revisionSha256 || hashCompositionDocument(document) !== row.compositionDocumentHash) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    const clip = document.clips.find(candidate => candidate.id === input.scope.clipId);
    const reference = document.htmlEditing?.items.find(item => item.clipId === input.scope.clipId);
    if (clip?.source.type !== "DECK_SLIDE" || clip.source.html !== row.revision.sourceHtml
      || (!reference && row.revision.version !== 1)
      || (reference && (reference.revisionVersion !== row.revision.version || reference.revisionSha256 !== row.revisionSha256
        || reference.templateId !== binding.templateId || reference.templateVersion !== binding.templateVersion
        || reference.sourceSha256 !== binding.sourceSha256 || reference.manifestSha256 !== binding.manifestSha256))) {
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    }
    return { ...row, document, imageSources };
  }

  private scopeArguments(input: ReadInput) {
    const scope = scopeSchema.safeParse(input.scope);
    if (!scope.success || !z.string().uuid().safeParse(input.actorId).success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    input.signal?.throwIfAborted();
    return { p_organization_id: scope.data.organizationId, p_draft_id: scope.data.documentId,
      p_clip_id: scope.data.clipId, p_actor_id: input.actorId };
  }
  private rpcSignal(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }
  private async callRpc(name: string, args: Record<string, unknown>, mutation: boolean, signal?: AbortSignal): Promise<unknown> {
    try {
      const effectiveSignal = this.rpcSignal(signal);
      effectiveSignal.throwIfAborted();
      const { data, error } = await this.supabase.rpc(name, args).abortSignal(effectiveSignal);
      effectiveSignal.throwIfAborted();
      if (error) throw new Error();
      return data;
    } catch {
      // No transport/provider payload crosses the repository boundary; an
      // interrupted mutation may already have committed and must be reconciled.
      throw new HtmlEditingRevisionError(mutation ? "COMMIT_UNCONFIRMED" : "READ_UNAVAILABLE");
    }
  }
}
