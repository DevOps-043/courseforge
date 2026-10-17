import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { compositionEditorDocumentSchema } from "./composition-document.types";
import { compileCompositionHtmlEditingFragments, type CompositionHtmlEditingCompilation } from "./composition-html-editing-compilation.server";
import { HTML_EDITING_REPOSITORY_POLICY } from "./composition-html-editing-repository-policy";
import { HTML_EDITING_LIMITS, htmlEditingBindingSchema } from "./html-editing/html-editing.contract";
import { HtmlEditingRevisionError, htmlEditingRevisionSchema } from "./html-editing/html-editing-revision.contract";
import { freezeCompositionHtmlEditingSnapshot } from "./composition-html-editing-snapshot-bundle.server";

const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const requestSchema = z.object({ actorId: z.string().uuid(), organizationId: z.string().uuid(),
  documentId: z.string().uuid(), documentHash: hashSchema }).strict();
const responseSchema = z.object({ document: z.unknown(), documentHash: hashSchema,
  revisions: z.array(z.object({ authoritativeBinding: htmlEditingBindingSchema,
    revision: htmlEditingRevisionSchema,
    grantedAssetIds: z.array(z.string().uuid()).max(HTML_EDITING_LIMITS.elements * HTML_EDITING_LIMITS.choices)
      .refine(ids => new Set(ids).size === ids.length),
  }).strict()).min(1).max(HTML_EDITING_LIMITS.elements),
}).strict();

export type HtmlEditingHistoricalRead = z.infer<typeof requestSchema> & { signal?: AbortSignal };

/** Service-only exact batch reader. The RPC authenticates current tenant/actor,
 * template revocation and grants in one locked transaction. The caller must
 * authenticate actorId; client-provided authority is never accepted here.
 * No route/feature is activated, and aliases do not attest materialized bytes. */
export async function readCompositionHtmlEditingCompilation(params: HtmlEditingHistoricalRead & { supabase: SupabaseClient }) {
  const request = requestSchema.safeParse({ actorId: params.actorId, organizationId: params.organizationId,
    documentId: params.documentId, documentHash: params.documentHash });
  if (!request.success) throw new HtmlEditingRevisionError("INVALID_REVISION");
  params.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
  const signal = params.signal ? AbortSignal.any([params.signal, timeout]) : timeout;
  let data: unknown;
  try {
    const result = await params.supabase.rpc("read_html_editing_compilation", {
      p_actor_id: request.data.actorId, p_organization_id: request.data.organizationId,
      p_draft_id: request.data.documentId, p_document_hash: request.data.documentHash,
    }).abortSignal(signal);
    if (result.error) throw new Error();
    data = result.data;
  } catch { throw new HtmlEditingRevisionError("READ_UNAVAILABLE"); }
  return verifyCompositionHtmlEditingRead({ organizationId: request.data.organizationId,
    documentId: request.data.documentId, documentHash: request.data.documentHash, response: data });
}

/** Integrity verification for a response obtained by an independently authorized
 * host RPC. Calling this pure function does not authenticate a request. */
export function verifyCompositionHtmlEditingRead(params: {
  organizationId: string; documentId: string; documentHash: string; response: unknown;
}) {
  try {
    const scope = requestSchema.omit({ actorId: true }).parse({ organizationId: params.organizationId,
      documentId: params.documentId, documentHash: params.documentHash });
    if (Buffer.byteLength(JSON.stringify(params.response) ?? "", "utf8") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error();
    const response = responseSchema.parse(params.response);
    const document = compositionEditorDocumentSchema.parse(response.document);
    if (response.documentHash !== scope.documentHash || !document.htmlEditing?.items.length) throw new Error();
    const context: CompositionHtmlEditingCompilation = { organizationId: scope.organizationId,
      documentId: scope.documentId, documentHash: response.documentHash, revisions: response.revisions.map(row => {
        const declaredAssetIds = [...new Set(row.revision.manifest.elements.flatMap(element =>
          element.kind === "IMAGE" ? element.allowedAssetIds : []))];
        if (row.grantedAssetIds.some(id => !declaredAssetIds.includes(id))) throw new Error();
        return { encodedRevision: JSON.stringify(row.revision), authoritativeBinding: row.authoritativeBinding,
          grantedAssetIds: row.grantedAssetIds,
          imageSources: new Map(declaredAssetIds.map(id => [id, `conformance-media/${id}`])) };
      }) };
    // Reuse pointer/source/digest/grant verification. These aliases are only
    // logical integrity inputs; discard compiled output and do not claim render
    // readiness. The eventual compiler caller must bind actual delivery itself.
    const logicalAliases = new Map(context.revisions.flatMap(row =>
      row.grantedAssetIds.map(id => [id, `conformance-media/${id}`] as [string, string])));
    compileCompositionHtmlEditingFragments({ document, documentHash: response.documentHash, context, assetUrls: logicalAliases });
    return { document, context };
  } catch { throw new HtmlEditingRevisionError("INVALID_REVISION"); }
}

/** Producer entry for frozen content. Still requires authorized host identity;
 * it issues one exact read and does not upload a ZIP or persist stale grants. */
export async function readCompositionHtmlEditingSnapshot(params: HtmlEditingHistoricalRead & { supabase: SupabaseClient }) {
  const { document, context } = await readCompositionHtmlEditingCompilation(params);
  return { document, context, bundle: freezeCompositionHtmlEditingSnapshot({ document, context }) };
}
