import { consultHtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.client";
import { HTML_PREVIEW_RENEWAL_POLICY, parseHtmlPreviewResourceRenewal, type HtmlPreviewResourceRenewal } from "./composition-html-editing-preview-renewal.contract";
import type { HtmlEditingPreviewSession } from "./composition-html-editing-preview-channel.contract";
import { buildHtmlEditingPreviewPageUrl } from "./composition-html-editing-preview-url";

type Failure = "EXPIRED" | "OWNER_CHANGED" | "UNAVAILABLE";
/** Owns capability lifetime, not media playback. The next lifetime is committed
 * only AFTER apply resolves (the frame's application acknowledgment), never on
 * HTTP success. One attempt per lifetime; uncertainty closes without replay. */
export function createHtmlPreviewRenewalController(input: {
  documentId: string; session: HtmlEditingPreviewSession; audience: string;
  revisionId?: string;
  isCurrentOwner: () => boolean;
  apply: (renewal: HtmlPreviewResourceRenewal, signal: AbortSignal) => Promise<void>;
  onFailure: (reason: Failure) => void;
  consult?: typeof consultHtmlPreviewResourceRenewal;
  signal?: AbortSignal; nowSeconds?: () => number; monotonicMilliseconds?: () => number;
}) {
  const { documentId, audience, isCurrentOwner, apply, onFailure } = input;
  const session = { ...input.session };
  const revisionId = input.revisionId;
  if (revisionId !== undefined) buildHtmlEditingPreviewPageUrl(documentId, session, revisionId);
  const consult = input.consult ?? consultHtmlPreviewResourceRenewal;
  const now = input.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const monotonic = input.monotonicMilliseconds ?? (() => performance.now());
  const externalSignal = input.signal, controller = new AbortController();
  let disposed = false, started = false, renewing = false;
  let active: HtmlPreviewResourceRenewal | undefined;
  let renewalTimer: ReturnType<typeof setTimeout> | undefined, expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let deadline = 0, lastMonotonic = 0, lastWallTime = 0;
  const dispose = () => {
    if (disposed) return;
    disposed = true; clearTimeout(renewalTimer); clearTimeout(expiryTimer);
    externalSignal?.removeEventListener("abort", dispose); controller.abort(); active = undefined;
  };
  const fail = (reason: Failure) => { if (disposed) return; dispose(); try { onFailure(reason); } catch { /* Already closed. */ } };
  const current = () => {
    if (disposed) return false;
    try {
      if (!isCurrentOwner()) { fail("OWNER_CHANGED"); return false; }
      const wall = now(), elapsed = monotonic();
      if (!Number.isSafeInteger(wall) || !Number.isFinite(elapsed) || wall < lastWallTime || elapsed < lastMonotonic
        || !active || wall >= active.expiresAt || elapsed >= deadline) { fail("EXPIRED"); return false; }
      lastWallTime = wall; lastMonotonic = elapsed; return true;
    } catch { fail("UNAVAILABLE"); return false; }
  };
  const install = (renewal: HtmlPreviewResourceRenewal) => {
    const wall = now(), elapsed = monotonic(), remaining = renewal.expiresAt - wall;
    if (!Number.isSafeInteger(wall) || !Number.isFinite(elapsed) || elapsed < 0 || wall < renewal.issuedAt
      || remaining < HTML_PREVIEW_RENEWAL_POLICY.minimumRemainingSeconds) throw new Error();
    clearTimeout(renewalTimer); clearTimeout(expiryTimer);
    active = renewal; lastWallTime = wall; lastMonotonic = elapsed; deadline = elapsed + remaining * 1000;
    expiryTimer = setTimeout(() => fail("EXPIRED"), remaining * 1000);
    renewalTimer = setTimeout(() => { void renew(); }, Math.max(0, remaining - HTML_PREVIEW_RENEWAL_POLICY.renewBeforeExpirySeconds) * 1000);
  };
  const renew = async () => {
    if (renewing || !current()) return;
    renewing = true;
    try {
      const previous = active!;
      const candidate = await consult({ documentId, audience, session, revisionId, bundleSha256: previous.bundleSha256,
        inventoryFingerprint: previous.inventoryFingerprint, signal: controller.signal, nowSeconds: now });
      if (!current()) return;
      const renewal = parseHtmlPreviewResourceRenewal(candidate, { documentId, audience, session,
        bundleSha256: previous.bundleSha256, inventoryFingerprint: previous.inventoryFingerprint });
      if (renewal.issuedAt <= previous.issuedAt || renewal.expiresAt <= previous.expiresAt
        || renewal.resources.length !== previous.resources.length
        || renewal.resources.some(resource => !previous.resources.some(prior => prior.localPath === resource.localPath))) throw new Error();
      await apply(renewal, controller.signal);
      if (!current()) return;
      install(renewal);
    } catch { fail("UNAVAILABLE"); }
    finally { renewing = false; }
  };
  externalSignal?.addEventListener("abort", dispose, { once: true });
  if (externalSignal?.aborted) dispose();
  return {
    start(initial: HtmlPreviewResourceRenewal) {
      if (disposed || started) return false;
      started = true;
      try {
        if (!isCurrentOwner()) { fail("OWNER_CHANGED"); return false; }
        install(parseHtmlPreviewResourceRenewal(initial, { documentId, audience, session })); return true;
      } catch { fail("UNAVAILABLE"); return false; }
    },
    dispose,
    getState: () => ({ started, disposed, renewing, expiresAt: active?.expiresAt ?? null }),
  };
}
