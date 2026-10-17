import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifyCompositionHtmlEditingRead } from "../composition-html-editing-reader.service";
import { HTML_EDITING_REPOSITORY_POLICY } from "../composition-html-editing-repository-policy";
import { htmlEditingImageIdentitiesSchema } from "../composition-html-editing-image-identity";
import { controlledRenderQueueClaimSchema, type ControlledRenderQueueClaim } from "./composition-controlled-render-worker-contract";
import type { materializeControlledRenderRevision } from "./composition-controlled-render-materialization";

type Resolver = NonNullable<Parameters<typeof materializeControlledRenderRevision>[0]["readHtmlEditingAuthority"]>;
const responseSchema = z.object({ documentId: z.string().uuid(), compilation: z.unknown(),
  imageAssets: htmlEditingImageIdentitiesSchema }).strict();

/** Claim-bound service-only reader. SQL resolves actor/draft from stored lineage,
 * checks current lease and role/grants, and returns exact historical pointers in
 * one transaction. No archive or caller actor is accepted as authorization. */
export function createControlledHtmlEditingAuthorityReader(input: {
  supabase: SupabaseClient<any, any, any>; claim: ControlledRenderQueueClaim;
}): Resolver {
  const claim = controlledRenderQueueClaimSchema.parse(input.claim);
  return async request => {
    request.signal?.throwIfAborted();
    if (claim.action !== "EXECUTE" || request.organizationId !== claim.organizationId || request.revisionId !== claim.revisionId
      || request.documentHash !== claim.contract.documentHash) throw new Error("CONTROLLED_RENDER_HTML_LINEAGE_MISMATCH");
    const timeout = AbortSignal.timeout(HTML_EDITING_REPOSITORY_POLICY.rpcTimeoutMs);
    const signal = request.signal ? AbortSignal.any([request.signal, timeout]) : timeout;
    let data: unknown;
    try {
      const result = await input.supabase.rpc("read_controlled_render_html_editing_authority", {
        p_organization_id: claim.organizationId, p_request_id: claim.requestId, p_revision_id: claim.revisionId,
        p_production_job_id: claim.productionJobId, p_worker_lease_token: claim.leaseToken,
        p_document_hash: request.documentHash,
      }).abortSignal(signal);
      signal.throwIfAborted();
      if (result.error) throw new Error();
      data = result.data;
    } catch {
      request.signal?.throwIfAborted();
      throw new Error("CONTROLLED_RENDER_HTML_AUTHORITY_UNAVAILABLE");
    }
    try {
      if (Buffer.byteLength(JSON.stringify(data) ?? "", "utf8") > HTML_EDITING_REPOSITORY_POLICY.responseBytes) throw new Error();
      const response = responseSchema.parse(data);
      const { context } = verifyCompositionHtmlEditingRead({ organizationId: claim.organizationId,
        documentId: response.documentId, documentHash: request.documentHash, response: response.compilation });
      const grantedIds = new Set(context.revisions.flatMap(revision => [...revision.grantedAssetIds]));
      if (response.imageAssets.length !== grantedIds.size
        || response.imageAssets.some(image => !grantedIds.has(image.productionAssetId))) throw new Error();
      return { scope: { organizationId: context.organizationId, documentId: context.documentId },
        imageAssets: response.imageAssets,
        authorities: context.revisions.map(({ authoritativeBinding, grantedAssetIds, imageSources }) =>
          ({ authoritativeBinding, grantedAssetIds, imageSources })) };
    } catch { throw new Error("CONTROLLED_RENDER_HTML_AUTHORITY_INVALID"); }
  };
}
