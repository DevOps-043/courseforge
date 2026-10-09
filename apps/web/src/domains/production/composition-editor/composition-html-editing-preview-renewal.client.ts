import { readBoundedCompositionJson } from "./composition-bounded-json-response.client";
import { buildHtmlEditingPreviewPageUrl } from "./composition-html-editing-preview-url";
import { assertHtmlEditingPreviewParentOrigin, htmlEditingPreviewSessionSchema, type HtmlEditingPreviewSession } from "./composition-html-editing-preview-channel.contract";
import { HTML_PREVIEW_RENEWAL_POLICY, parseHtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";

/** One authenticated read, never retries, writes editor state or follows a
 * redirect. Caller owns scheduling and cancellation on owner/base drift. */
export async function consultHtmlPreviewResourceRenewal(input: {
  documentId: string; session: HtmlEditingPreviewSession; audience: string;
  revisionId?: string;
  bundleSha256?: string; inventoryFingerprint?: string; signal?: AbortSignal;
  fetcher?: typeof fetch; nowSeconds?: () => number;
}) {
  try {
    const session = htmlEditingPreviewSessionSchema.parse(input.session);
    const expected = { documentId: input.documentId, session, audience: input.audience,
      bundleSha256: input.bundleSha256, inventoryFingerprint: input.inventoryFingerprint };
    assertHtmlEditingPreviewParentOrigin(expected.audience);
    const pageUrl = new URL(buildHtmlEditingPreviewPageUrl(expected.documentId, session, input.revisionId), expected.audience);
    const url = `${pageUrl.pathname}/renew${pageUrl.search}`;
    const fetcher = input.fetcher ?? fetch, now = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
    const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(HTML_PREVIEW_RENEWAL_POLICY.requestTimeoutMs)])
      : AbortSignal.timeout(HTML_PREVIEW_RENEWAL_POLICY.requestTimeoutMs);
    signal.throwIfAborted();
    const response = await fetcher(url, { method: "GET", credentials: "same-origin", cache: "no-store", redirect: "error", signal });
    const candidate = await readBoundedCompositionJson(response, HTML_PREVIEW_RENEWAL_POLICY.responseBytes, signal);
    signal.throwIfAborted();
    const renewal = parseHtmlPreviewResourceRenewal(candidate, expected), currentTime = now();
    if (!Number.isSafeInteger(currentTime) || currentTime < renewal.issuedAt
      || renewal.expiresAt - currentTime < HTML_PREVIEW_RENEWAL_POLICY.minimumRemainingSeconds)
      throw new Error();
    return renewal;
  } catch { throw new Error("HTML_PREVIEW_RENEWAL_UNAVAILABLE"); }
}
