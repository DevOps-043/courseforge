import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import type { CompositionFontReference } from "./composition-font-references";
import { hashCompositionDocument } from "./composition-document.service";
import { SupabaseHtmlEditingRevisionRepository } from "./composition-html-editing-repository.service";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { HTML_EDITING_LIMITS, htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { htmlEditingTrustedTemplateSchema } from "./html-editing/html-editing-bootstrap.server";
import { HtmlEditingRevisionError } from "./html-editing/html-editing-revision.contract";
import type { HtmlEditingTemplateCatalog } from "./html-editing/html-editing-template-catalog.server";
import { computeHtmlEditingInitializationRequestSha256 } from "./composition-html-editing-initialization-operation-digest.server";
import { htmlEditingInitializationRequestSchema } from "./composition-html-editing-initialization-http.contract";
import { htmlTemplateChoicesViewSchema } from "./composition-html-editing-template-choices.contract";

const requestSchema = htmlEditingBindingSchema.pick({ organizationId: true, documentId: true, clipId: true,
  templateId: true, templateVersion: true }).extend({ actorId: z.string().uuid(), expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const operationRequestSchema = requestSchema.extend({ operationId: z.string().uuid() }).strict();
const choicesRequestSchema = requestSchema.omit({ templateId: true, templateVersion: true }).strict();
const readSchema = z.object({ organizationId: z.string().uuid(), documentId: z.string().uuid(), clipId: htmlEditingBindingSchema.shape.clipId,
  revisionId: z.string().uuid(), documentHash: z.string().regex(/^[a-f0-9]{64}$/), document: z.unknown(),
  grantedAssetIds: z.array(z.string().uuid()).max(6400).refine(ids => new Set(ids).size === ids.length),
}).strict();

export type HtmlEditingBootstrapCatalogProvider = (input: z.infer<typeof choicesRequestSchema> & {
  sourceHtml: string; slideIndex: number; fontBindings?: CompositionFontReference[];
}, signal?: AbortSignal) => Promise<HtmlEditingTemplateCatalog>;

/** Authenticated actor/tenant come from the host, not request claims. This service
 * reads source/anchor/grants independently and composes catalog + registration.
 * No browser endpoint, template activation, URL fetch or render is implied. */
export class CompositionHtmlEditingBootstrapHost {
  constructor(private readonly supabase: SupabaseClient, private readonly catalog: HtmlEditingTemplateCatalog | HtmlEditingBootstrapCatalogProvider) {}

  private resolveCatalog(scope: z.infer<typeof choicesRequestSchema>, sourceHtml: string, slideIndex: number,
    fontBindings: CompositionFontReference[] | undefined, signal?: AbortSignal) {
    return typeof this.catalog === "function" ? this.catalog({ ...scope, sourceHtml, slideIndex, fontBindings }, signal) : this.catalog;
  }

  async listTemplateChoices(input: z.infer<typeof choicesRequestSchema>, signal?: AbortSignal) {
    const request = choicesRequestSchema.safeParse(input);
    if (!request.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const { context, sourceHtml, slideIndex, fontBindings, effectiveSignal } = await this.readBootstrapContext(request.data, signal);
    const catalog = await this.resolveCatalog(request.data, sourceHtml, slideIndex, fontBindings, effectiveSignal);
    const templates = catalog.listSourceMatches({ organizationId: request.data.organizationId,
      sourceSha256: createHash("sha256").update(sourceHtml, "utf8").digest("hex") });
    effectiveSignal.throwIfAborted();
    return htmlTemplateChoicesViewSchema.parse({ documentId: context.documentId, clipId: context.clipId,
      documentHash: context.documentHash, templates });
  }

  async register(input: z.infer<typeof requestSchema>, signal?: AbortSignal) {
    const request = requestSchema.safeParse(input);
    if (!request.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    return new SupabaseHtmlEditingRevisionRepository(this.supabase).registerInstalled(await this.prepareRegistration(request.data, signal));
  }

  /** Opt-in durable path. A recorded ID is returned as historical evidence before
   * current source/CAS preparation; never re-registers or claims it is current.
   * NOT_FOUND admits this requested first attempt only, not an automatic retry of
   * a previous unknown client attempt. SQL resolves concurrent same-ID commits. */
  async registerOperation(input: z.infer<typeof operationRequestSchema>, signal?: AbortSignal) {
    const request = operationRequestSchema.safeParse(input);
    if (!request.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const { operationId, ...scope } = request.data;
    const body = htmlEditingInitializationRequestSchema.parse({ templateId: scope.templateId, templateVersion: scope.templateVersion,
      expectedDocumentHash: scope.expectedDocumentHash });
    const requestSha256 = computeHtmlEditingInitializationRequestSha256(body);
    const effectiveSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    const repository = new SupabaseHtmlEditingRevisionRepository(this.supabase);
    const result = await repository.readInitializationOperation({ actorId: scope.actorId,
      scope: { organizationId: scope.organizationId, documentId: scope.documentId, clipId: scope.clipId },
      operationId, requestSha256, signal: effectiveSignal });
    effectiveSignal.throwIfAborted();
    if (result.status === "RECORDED") {
      if (JSON.stringify(result.receipt.request) !== JSON.stringify(body)) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
      return result.receipt;
    }
    const prepared = await this.prepareRegistration(scope, effectiveSignal);
    effectiveSignal.throwIfAborted();
    const registered = await repository.registerInstalled({ ...prepared, initializationOperationId: operationId });
    effectiveSignal.throwIfAborted();
    if (!("initializationReceipt" in registered) || !registered.initializationReceipt) throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    return registered.initializationReceipt;
  }

  private async prepareRegistration(scope: z.infer<typeof requestSchema>, signal?: AbortSignal) {
    const { context, sourceHtml, slideIndex, fontBindings, effectiveSignal } = await this.readBootstrapContext(scope, signal);
    const catalog = await this.resolveCatalog(scope, sourceHtml, slideIndex, fontBindings, effectiveSignal);
    const template = htmlEditingTrustedTemplateSchema.parse(JSON.parse(catalog.resolve({
      organizationId: scope.organizationId, templateId: scope.templateId, templateVersion: scope.templateVersion,
      sourceSha256: createHash("sha256").update(sourceHtml, "utf8").digest("hex"),
    })));
    const declaredIds = [...new Set(template.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []))];
    const currentGrants = new Set(context.grantedAssetIds);
    effectiveSignal.throwIfAborted();
    return {
      actorId: scope.actorId, scope: { organizationId: scope.organizationId, documentId: scope.documentId, clipId: scope.clipId },
      authoritativeAnchor: { organizationId: scope.organizationId, documentId: scope.documentId, clipId: scope.clipId,
        revisionId: context.revisionId, documentSha256: context.documentHash },
      sourceHtml, grantedAssetIds: declaredIds.filter(id => currentGrants.has(id)),
      imageSources: new Map(declaredIds.map(id => [id, `conformance-media/${id}`])),
      catalog, templateId: scope.templateId, templateVersion: scope.templateVersion, signal,
    };
  }

  private async readBootstrapContext(scope: z.infer<typeof choicesRequestSchema>, signal?: AbortSignal) {
    const effectiveSignal = signal ? AbortSignal.any([signal, AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    let payload: unknown;
    try {
      effectiveSignal.throwIfAborted();
      const result = await this.supabase.rpc("read_html_editing_bootstrap_context", {
        p_organization_id: scope.organizationId, p_draft_id: scope.documentId, p_clip_id: scope.clipId,
        p_actor_id: scope.actorId, p_expected_document_hash: scope.expectedDocumentHash,
      }).abortSignal(effectiveSignal);
      effectiveSignal.throwIfAborted();
      if (result.error) throw new Error();
      payload = result.data;
    } catch { throw new HtmlEditingRevisionError("READ_UNAVAILABLE"); }
    if (Buffer.byteLength(JSON.stringify(payload) ?? "", "utf8") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) {
      throw new HtmlEditingRevisionError("READ_UNAVAILABLE");
    }
    const parsed = readSchema.safeParse(payload);
    if (!parsed.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const context = parsed.data;
    if (context.organizationId !== scope.organizationId || context.documentId !== scope.documentId || context.clipId !== scope.clipId
      || context.documentHash !== scope.expectedDocumentHash) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    const document = compositionEditorDocumentSchema.safeParse(context.document);
    if (!document.success || hashCompositionDocument(document.data) !== context.documentHash) throw new HtmlEditingRevisionError("INVALID_REVISION");
    const clip = document.data.clips.find(candidate => candidate.id === scope.clipId);
    if (clip?.kind !== "DECK_SLIDE" || clip.source.type !== "DECK_SLIDE"
      || document.data.htmlEditing?.items.some(item => item.clipId === scope.clipId)) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    const sourceHtml = clip.source.html;
    if (Buffer.byteLength(sourceHtml, "utf8") > HTML_EDITING_LIMITS.sourceBytes) throw new HtmlEditingRevisionError("INVALID_REVISION");
    effectiveSignal.throwIfAborted();
    return { context, sourceHtml, slideIndex: clip.source.slideIndex, fontBindings: clip.source.fontBindings, effectiveSignal };
  }
}
