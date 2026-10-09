import { verifyHtmlPreviewResourceCapability, type HtmlPreviewResourceClaims } from "./composition-html-editing-preview-capability.server";
import { readCompositionHtmlEditingPreviewPortfolio } from "./composition-html-editing-preview-resources.server";
import { spoolCompositionHtmlEditingPreviewResource, HtmlEditingPreviewSpoolCleanupError } from "./composition-html-editing-preview-spool.server";
import { createHtmlPreviewResourceResponse, parseHtmlPreviewResourceRange } from "./composition-html-editing-preview-file-stream.server";
import { validateCompositionHtmlEditingPreviewImageBytes } from "./composition-html-editing-preview-images.server";
import { htmlEditingImageIdentitySchema } from "./composition-html-editing-image-identity";
import { HTML_EDITING_PREVIEW_RESOURCE_POLICY } from "./composition-html-editing-preview-inventory.server";
import { htmlPreviewDeliveryBudget } from "./composition-html-editing-preview-delivery-budget.server";

export class HtmlPreviewDeliveryAccessError extends Error {
  constructor() { super("HTML_PREVIEW_RESOURCE_ACCESS_UNAVAILABLE"); this.name = "HtmlPreviewDeliveryAccessError"; }
}
type PortfolioInput = Parameters<typeof readCompositionHtmlEditingPreviewPortfolio>[0];
type Portfolio = Awaited<ReturnType<typeof readCompositionHtmlEditingPreviewPortfolio>>;
function resourceFromCurrentPortfolio(portfolio: Portfolio, claims: HtmlPreviewResourceClaims) {
  if (portfolio.snapshot.bundle.sha256 !== claims.bundleSha256 || portfolio.inventory.fingerprint !== claims.inventoryFingerprint) throw new HtmlPreviewDeliveryAccessError();
  const resource = portfolio.inventory.entries.find(entry => entry.localPath === claims.localPath);
  if (!resource || resource.identity.checksum !== claims.checksum || resource.identity.fileSizeBytes !== claims.fileSizeBytes
    || resource.identity.mimeType !== claims.mimeType) throw new HtmlPreviewDeliveryAccessError();
  return resource;
}

/** Stateless binary read boundary: caller supplies operator configuration only.
 * Signed claims authenticate issuance, while TWO current portfolio reads enforce
 * actor/tenant/template/grants/resource revocation before actual bytes are served.
 * Quota consumption is required and must use shared infrastructure, not a Map.
 * No request-supplied actor, Storage URL/path or authorization grant enters RPCs. */
export async function deliverCompositionHtmlEditingPreviewResource(input: {
  token: string; key: Uint8Array; audience: string; documentId: string; range: string | null;
  supabase: PortfolioInput["supabase"]; storageOrigin: string; fetchResource?: typeof fetch; signal?: AbortSignal;
  consumeQuota: (claims: HtmlPreviewResourceClaims) => Promise<boolean>; nowSeconds?: () => number;
}) {
  input.signal?.throwIfAborted();
  const now = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const verify = () => verifyHtmlPreviewResourceCapability({ ...input, nowSeconds: now() });
  const claims = verify();
  if (!(await input.consumeQuota(claims))) throw new HtmlPreviewDeliveryAccessError();
  parseHtmlPreviewResourceRange(input.range, claims.fileSizeBytes);
  const scoped: PortfolioInput = { actorId: claims.actorId, organizationId: claims.organizationId,
    documentId: claims.documentId, documentHash: claims.session.documentHash,
    supabase: input.supabase, storageOrigin: input.storageOrigin, fetchResource: input.fetchResource,
    signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_EDITING_PREVIEW_RESOURCE_POLICY.preparationTimeoutMs)])
      : AbortSignal.timeout(HTML_EDITING_PREVIEW_RESOURCE_POLICY.preparationTimeoutMs) };
  const initial = await readCompositionHtmlEditingPreviewPortfolio(scoped);
  const resource = resourceFromCurrentPortfolio(initial, claims);
  const release = htmlPreviewDeliveryBudget.reserve(resource.identity.fileSizeBytes);
  let file: Awaited<ReturnType<typeof spoolCompositionHtmlEditingPreviewResource>>;
  try {
    const acquired = await spoolCompositionHtmlEditingPreviewResource({ ...scoped, identity: resource.identity });
    file = { ...acquired, dispose: async () => { await acquired.dispose(); release(); } };
  } catch (error) { if (!(error instanceof HtmlEditingPreviewSpoolCleanupError)) release(); throw error; }
  try {
    if (resource.identity.mimeType.startsWith("image/")) {
      await validateCompositionHtmlEditingPreviewImageBytes({ bytes: await file.readSmallBytes(), signal: scoped.signal,
        identity: htmlEditingImageIdentitySchema.parse({ ...resource.identity,
          productionAssetId: resource.localPath.slice("conformance-media/".length) }) });
    }
    return await createHtmlPreviewResourceResponse({ file, range: input.range, signal: scoped.signal,
      beforeDelivery: async () => {
        resourceFromCurrentPortfolio(await readCompositionHtmlEditingPreviewPortfolio(scoped), claims);
        verify(); scoped.signal?.throwIfAborted();
      } });
  } catch (error) { await file.dispose(); throw error; }
}
