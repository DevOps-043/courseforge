import { prepareCompositionHtmlEditingSecurePreview } from "./composition-html-editing-preview-secure.server";
import { issueHtmlPreviewResourceCapability, HTML_PREVIEW_CAPABILITY_POLICY } from "./composition-html-editing-preview-capability.server";
import { bindCompositionHtmlPreviewResources } from "./composition-html-editing-preview-bindings.server";
import { parseHtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";
import { load } from "cheerio";
import { buildCompositionHtmlEditingPreviewCsp } from "./composition-html-editing-preview-csp.server";

type Input = Parameters<typeof prepareCompositionHtmlEditingSecurePreview>[0] & { deliveryKey: Uint8Array; nowSeconds?: () => number };
/** Authenticated issuer boundary: identity comes from host authentication;
 * claims come ONLY from exact prepared snapshot/inventory. No public raw-claims
 * endpoint or persistent preview tokens; originals/render bytes stay unchanged. */
export async function prepareCompositionHtmlEditingPreviewPage(input: Input) {
  if (input.deliveryKey.byteLength !== HTML_PREVIEW_CAPABILITY_POLICY.keyBytes) throw new Error("HTML_PREVIEW_DELIVERY_NOT_CONFIGURED");
  const key = new Uint8Array(input.deliveryKey);
  const prepared = await prepareCompositionHtmlEditingSecurePreview(input);
  try {
    const issuedAt = (input.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
    const resourceEndpoint = `${input.parentOrigin}/api/production/hyperframes/drafts/${input.documentId}/html-preview/resources`;
    const resourceUrls = new Map<string, string>();
    for (const resource of prepared.inventory.entries) {
      const cap = issueHtmlPreviewResourceCapability({ format: "courseforge-html-preview-resource-v1", actorId: input.actorId,
        organizationId: input.organizationId, documentId: input.documentId, session: prepared.session, audience: input.parentOrigin,
        bundleSha256: prepared.bundle.sha256, inventoryFingerprint: prepared.inventory.fingerprint,
        localPath: resource.localPath, checksum: resource.identity.checksum, fileSizeBytes: resource.identity.fileSizeBytes,
        mimeType: resource.identity.mimeType, issuedAt, expiresAt: issuedAt + HTML_PREVIEW_CAPABILITY_POLICY.lifetimeSeconds }, key);
      resourceUrls.set(resource.localPath, `${resourceEndpoint}?cap=${cap}`);
    }
    const bound = bindCompositionHtmlPreviewResources({ trustedCompiledPage: prepared.previewHtml, resourceEndpoint, resourceUrls });
    const resourceRenewal = parseHtmlPreviewResourceRenewal({ format: "courseforge-html-preview-resource-renewal-v1",
      documentId: input.documentId, session: prepared.session, bundleSha256: prepared.bundle.sha256,
      inventoryFingerprint: prepared.inventory.fingerprint, issuedAt,
      expiresAt: issuedAt + HTML_PREVIEW_CAPABILITY_POLICY.lifetimeSeconds,
      resources: [...resourceUrls].map(([localPath, url]) => ({ localPath, url })) }, {
      documentId: input.documentId, session: prepared.session, audience: input.parentOrigin,
      bundleSha256: prepared.bundle.sha256, inventoryFingerprint: prepared.inventory.fingerprint });
    const page = load(bound.html);
    const controller = page("script").filter((_index, element) => (page(element).html() ?? "").includes("const compiledDocumentHash ="));
    if (controller.length !== 1) throw new Error("HTML_PREVIEW_CONTROLLER_UNAVAILABLE");
    controller.before(`<script>window.__courseforgeHtmlPreviewBridge.setResources(${JSON.stringify(resourceRenewal).replaceAll("<", "\\u003c")});</script>`);
    const html = page.html(), contentSecurityPolicy = buildCompositionHtmlEditingPreviewCsp(html, resourceEndpoint);
    input.signal?.throwIfAborted();
    // Responses need only the compiled page, not live temp files. Each resource
    // GET independently authenticates the capability and reauthorizes current RPC.
    await prepared.dispose();
    input.signal?.throwIfAborted();
    const completedAt = (input.nowSeconds ?? (() => Math.floor(Date.now() / 1000)))();
    if (!Number.isSafeInteger(completedAt) || completedAt < issuedAt || completedAt >= resourceRenewal.expiresAt)
      throw new Error("HTML_PREVIEW_RENEWAL_EXPIRED_DURING_PREPARATION");
    return { html, contentSecurityPolicy, session: prepared.session, resourceRenewal,
      scope: "AUTHORIZED_RESOURCE_BOUND_PREVIEW_PAGE_NOT_BROWSER_OR_RENDER_EVIDENCE" as const };
  } catch (error) { await prepared.dispose(); throw error; }
}
