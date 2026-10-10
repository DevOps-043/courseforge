import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { hashCompositionDocument } from "./composition-document.service";
import { HTML_LEGACY_ADOPTION_POLICY as policy } from "./composition-html-editing-legacy-adoption.contract";
import { htmlEditingBindingSchema, HTML_EDITING_LIMITS } from "./html-editing/html-editing.contract";

export const htmlLegacyBootstrapReadSchema = htmlEditingBindingSchema.pick({organizationId: true, documentId: true, clipId: true})
  .extend({actorId: z.string().uuid(), expectedDocumentHash: z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const contextSchema = z.object({organizationId: z.string().uuid(), documentId: z.string().uuid(), clipId: z.string(), revisionId: z.string().uuid(),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/), document: z.unknown(),
  grantedAssetIds: z.array(z.string().uuid()).max(HTML_EDITING_LIMITS.elements * HTML_EDITING_LIMITS.choices)
    .refine(ids => new Set(ids).size === ids.length)}).strict();
export class HtmlLegacyContextError extends Error {
  constructor(readonly baseChanged = false) {super(baseChanged ? "HTML_LEGACY_CONTEXT_CONFLICT" : "HTML_LEGACY_CONTEXT_UNAVAILABLE");}
}
/** Integrity only for an independently authorized RPC result. Never derive
 * current source, native anchor or grants from an operator package. */
export function verifyHtmlLegacyBootstrapContext(input: unknown, request: z.infer<typeof htmlLegacyBootstrapReadSchema>) {
  try {
    if (Buffer.byteLength(JSON.stringify(input) ?? "") > policy.responseBytes) throw new Error();
    const context = contextSchema.parse(input);
    if (context.organizationId !== request.organizationId || context.documentId !== request.documentId
      || context.clipId !== request.clipId || context.documentHash !== request.expectedDocumentHash) throw new HtmlLegacyContextError(true);
    const document = compositionEditorDocumentSchema.parse(context.document);
    if (hashCompositionDocument(document) !== request.expectedDocumentHash) throw new Error();
    return {...context, document};
  } catch (error) {if (error instanceof HtmlLegacyContextError) throw error; throw new HtmlLegacyContextError();}
}
export async function readAuthorizedHtmlLegacyBootstrapContext(input: {supabase: SupabaseClient;
  request: z.infer<typeof htmlLegacyBootstrapReadSchema>; signal: AbortSignal}) {
  const request = htmlLegacyBootstrapReadSchema.parse(input.request);
  try {
    input.signal.throwIfAborted();
    const result = await input.supabase.rpc("read_html_editing_bootstrap_context", {p_organization_id: request.organizationId,
      p_draft_id: request.documentId, p_clip_id: request.clipId, p_actor_id: request.actorId,
      p_expected_document_hash: request.expectedDocumentHash}).abortSignal(input.signal);
    input.signal.throwIfAborted(); if (result.error) throw new Error();
    return verifyHtmlLegacyBootstrapContext(result.data, request);
  } catch (error) {
    input.signal.throwIfAborted(); if (error instanceof HtmlLegacyContextError) throw error; throw new HtmlLegacyContextError();
  }
}
