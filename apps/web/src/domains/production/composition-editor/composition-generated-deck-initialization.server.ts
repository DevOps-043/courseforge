import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readGeneratedCourseDeckEditorial, GeneratedDeckReadError, type VerifiedGeneratedDeck } from "../slides/generation/course-deck-editorial-reader.server";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { bindHtmlEditingRevisionToComposition } from "./composition-html-editing-document.server";
import { readCompositionHtmlEditingCompilation } from "./composition-html-editing-reader.service";
import { compileCompositionHtmlEditingFragments } from "./composition-html-editing-compilation.server";
import { prepareInitialHtmlEditingRevision } from "./html-editing/html-editing-bootstrap.server";
import { HtmlEditingRevisionError } from "./html-editing/html-editing-revision.contract";
import { htmlEditingReferenceSchema } from "./html-editing/html-editing-reference.contract";
import { readReferencedCompositionFonts, compositionFontManifestBinding } from "./composition-font-assets.service";
import { assertDocumentConformanceFontBindings } from "./composition-conformance-font-bindings";
import {
  GENERATED_DECK_INITIALIZATION_POLICY as policy, generatedDeckInitializationOwnerSchema,
  generatedDeckInitializationRequestSchema, generatedDeckInitializationRequestPreimage,
  generatedDeckInitializationReadSchema, generatedDeckInitializationReceiptSchema,
  type GeneratedDeckInitializationOwner, type GeneratedDeckInitializationRequest, type GeneratedDeckInitializationReceipt,
} from "./composition-generated-deck-initialization.contract";

const contextSchema = z.object({
  organizationId: z.string().uuid(), documentId: z.string().uuid(), clipId: z.string(),
  revisionId: z.string().uuid(), documentHash: z.string(), document: z.unknown(),
  componentId: z.string().uuid(), documentVersion: z.number().int().positive(),
  grantedAssetIds: z.array(z.string().uuid()).max(6400).refine(ids => new Set(ids).size === ids.length),
}).strict();

export function computeGeneratedDeckInitializationRequestSha256(expectedDocumentHash: string) {
  return createHash("sha256").update(generatedDeckInitializationRequestPreimage(expectedDocumentHash), "utf8").digest("hex");
}

/** Actor/tenant must already be authenticated by the host. Browser submits only
 * operation identity and CAS; never templates, source, grants or font claims.
 * Provenance is reconstructed once from current tenant-owned saved material.
 * All registration, initial pointers, one native append and receipt commit in
 * the same SQL transaction. Lost ACK is unknown; no automatic POST retry. */
export class GeneratedDeckInitializationHost {
  constructor(private readonly supabase: SupabaseClient) {}

  private scope(owner: GeneratedDeckInitializationOwner) {
    const parsed = generatedDeckInitializationOwnerSchema.parse(owner);
    return { p_org: parsed.organizationId, p_draft: parsed.draftId, p_actor: parsed.actorId };
  }

  private signal(signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(policy.timeoutMs);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  }

  private async rpc(name: string, args: Record<string, unknown>, signal: AbortSignal, write = false) {
    try {
      signal.throwIfAborted();
      const response = await this.supabase.rpc(name, args).abortSignal(signal);
      signal.throwIfAborted();
      if (response.error) throw new Error();
      const maximum = name === "read_generated_deck_initialization_context" ? policy.maximumContextBytes : policy.maximumReceiptBytes;
      if (Buffer.byteLength(JSON.stringify(response.data) ?? "", "utf8") > maximum) throw new Error();
      return response.data as unknown;
    } catch { throw new HtmlEditingRevisionError(write ? "COMMIT_UNCONFIRMED" : "READ_UNAVAILABLE"); }
  }

  private matches(receipt: GeneratedDeckInitializationReceipt, owner: GeneratedDeckInitializationOwner,
    identity: Pick<GeneratedDeckInitializationRequest, "operationId" | "requestSha256">) {
    return receipt.operationId === identity.operationId && receipt.requestSha256 === identity.requestSha256
      && computeGeneratedDeckInitializationRequestSha256(receipt.expectedDocumentHash) === receipt.requestSha256
      && receipt.owner.actorId === owner.actorId && receipt.owner.organizationId === owner.organizationId
      && receipt.owner.draftId === owner.draftId;
  }

  async readOperation(owner: GeneratedDeckInitializationOwner,
    identity: Pick<GeneratedDeckInitializationRequest, "operationId" | "requestSha256">, signal?: AbortSignal) {
    const parsedIdentity = generatedDeckInitializationRequestSchema.omit({ expectedDocumentHash: true }).parse(identity);
    const result = generatedDeckInitializationReadSchema.parse(await this.rpc("read_generated_deck_initialization_operation",
      { ...this.scope(owner), p_operation: parsedIdentity.operationId }, this.signal(signal)));
    if (result.status === "RECORDED" && !this.matches(result.receipt, owner, parsedIdentity))
      throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    return result;
  }

  async initialize(owner: GeneratedDeckInitializationOwner, input: GeneratedDeckInitializationRequest, signal?: AbortSignal) {
    const request = generatedDeckInitializationRequestSchema.parse(input), effectiveSignal = this.signal(signal);
    if (computeGeneratedDeckInitializationRequestSha256(request.expectedDocumentHash) !== request.requestSha256)
      throw new HtmlEditingRevisionError("INVALID_REVISION");
    const historical = await this.readOperation(owner, { operationId: request.operationId, requestSha256: request.requestSha256 }, effectiveSignal);
    if (historical.status === "RECORDED") return historical.receipt;
    const context = contextSchema.parse(await this.rpc("read_generated_deck_initialization_context",
      { ...this.scope(owner), p_expected_hash: request.expectedDocumentHash }, effectiveSignal));
    const document = compositionEditorDocumentSchema.parse(context.document);
    if (context.organizationId !== owner.organizationId || context.documentId !== owner.draftId
      || context.documentHash !== request.expectedDocumentHash || hashCompositionDocument(document) !== context.documentHash)
      throw new HtmlEditingRevisionError("REVISION_CONFLICT");
    const generated = await readGeneratedCourseDeckEditorial({ componentId: context.componentId, organizationId: owner.organizationId,
      supabase: this.supabase, signal: effectiveSignal });
    if (!generated) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    const prepared = prepareGeneratedDeckInitializations({ owner, context, document, generated });
    const fonts = await readReferencedCompositionFonts({ document, organizationId: owner.organizationId, supabase: this.supabase, signal: effectiveSignal });
    const fontManifest = assertDocumentConformanceFontBindings(document, fonts.map(compositionFontManifestBinding));
    const previous = document.htmlEditing?.items.length ? await readCompositionHtmlEditingCompilation({
      supabase: this.supabase, organizationId: owner.organizationId, documentId: owner.draftId,
      actorId: owner.actorId, documentHash: context.documentHash, signal: effectiveSignal,
    }) : null;
    // Verify the complete next pointer set, not just a convenient selected slide.
    compileCompositionHtmlEditingFragments({ document: prepared.document, documentHash: prepared.documentHash,
      context: { organizationId: owner.organizationId, documentId: owner.draftId, documentHash: prepared.documentHash,
        revisions: [...(previous?.context.revisions ?? []), ...prepared.revisions] },
      assetUrls: new Map(context.grantedAssetIds.map(id => [id, `conformance-media/${id}`])),
    });
    effectiveSignal.throwIfAborted();
    const result = generatedDeckInitializationReceiptSchema.safeParse(await this.rpc("commit_generated_deck_initialization", {
      ...this.scope(owner), p_operation: request.operationId, p_request_sha256: request.requestSha256,
      p_expected_hash: request.expectedDocumentHash, p_registrations: prepared.registrations,
      p_document: prepared.document, p_document_hash: prepared.documentHash, p_fonts: fontManifest,
    }, effectiveSignal, true));
    if (!result.success || !this.matches(result.data, owner, request) || result.data.documentHash !== prepared.documentHash
      || result.data.documentVersion !== context.documentVersion + 1
      || JSON.stringify(result.data.items.map(item => htmlEditingReferenceSchema.strip().parse(item))) !== JSON.stringify(prepared.references))
      throw new HtmlEditingRevisionError("COMMIT_UNCONFIRMED");
    return result.data;
  }
}

/** Pure preparation is NOT authority. Call only with authorized native context
 * and a server-reconstructed material closure. It cannot install external HTML. */
export function prepareGeneratedDeckInitializations(input: {
  owner: GeneratedDeckInitializationOwner; context: Pick<z.infer<typeof contextSchema>, "revisionId" | "documentHash" | "grantedAssetIds">;
  document: z.infer<typeof compositionEditorDocumentSchema>; generated: VerifiedGeneratedDeck;
}) {
  const original = compositionEditorDocumentSchema.parse(input.document), owner = generatedDeckInitializationOwnerSchema.parse(input.owner);
  if (hashCompositionDocument(original) !== input.context.documentHash) throw new HtmlEditingRevisionError("REVISION_CONFLICT");
  const bound = new Set(original.htmlEditing?.items.map(reference => reference.clipId) ?? []);
  const clips = original.clips.filter(clip => clip.kind === "DECK_SLIDE" && !bound.has(clip.id))
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  if (!clips.length || clips.length + bound.size > policy.maximumClips) throw new HtmlEditingRevisionError("INVALID_REVISION");
  let document = original;
  const registrations = [], revisions = [];
  for (const clip of clips) {
    if (clip.source.type !== "DECK_SLIDE" || clip.source.htmlAssetId) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    const instance = input.generated.instance(clip.id, clip.source.slideIndex);
    if (clip.source.html !== instance.html) throw new GeneratedDeckReadError("INTEGRITY_MISMATCH");
    const requiredFonts = input.generated.fontBindings ?? [], savedFonts = clip.source.fontBindings ?? [];
    if (requiredFonts.length !== savedFonts.length || requiredFonts.some(font => !savedFonts.some(saved => JSON.stringify(font) === JSON.stringify(saved))))
      throw new GeneratedDeckReadError("FONT_BINDING_REQUIRED");
    const declaredIds = [...new Set(instance.template.elements.flatMap(element => element.kind === "IMAGE" ? element.allowedAssetIds : []))];
    const grantedAssetIds = declaredIds.filter(id => input.context.grantedAssetIds.includes(id));
    const imageSources = new Map(declaredIds.map(id => [id, `conformance-media/${id}`]));
    const initial = prepareInitialHtmlEditingRevision({ encodedTrustedTemplate: JSON.stringify(instance.template), sourceHtml: clip.source.html,
      authoritativeAnchor: { organizationId: owner.organizationId, documentId: owner.draftId, clipId: clip.id,
        revisionId: input.context.revisionId, documentSha256: input.context.documentHash }, grantedAssetIds, imageSources });
    const authority = { authoritativeBinding: initial.revision.manifest.binding, grantedAssetIds, imageSources };
    document = bindHtmlEditingRevisionToComposition({ ...authority, document, revision: initial.revision, revisionSha256: initial.sha256 }).document;
    registrations.push({ clipId: clip.id, revision: initial.revision, revisionSha256: initial.sha256, usedAssetIds: initial.compiled.usedAssetIds });
    revisions.push({ ...authority, encodedRevision: JSON.stringify(initial.revision) });
  }
  if (Buffer.byteLength(JSON.stringify(registrations), "utf8") > policy.maximumRegistrationsBytes) throw new HtmlEditingRevisionError("INVALID_REVISION");
  return { document, documentHash: hashCompositionDocument(document), registrations, revisions,
    references: document.htmlEditing!.items.filter(reference => !bound.has(reference.clipId)) };
}
