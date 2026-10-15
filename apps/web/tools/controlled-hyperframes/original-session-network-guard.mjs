export const ORIGINAL_SESSION_NETWORK_POLICY = Object.freeze({
  scope: "ORIGINAL_PAGE_HTTP_GUARD_NOT_OS_NETWORK_ISOLATION",
  maximumPendingRequests: 128, maximumRequests: 100000, maximumUrlBytes: 8192,
});

const failure = () => new Error("CONTROLLED_RENDER_ORIGINAL_NETWORK_REJECTED");

/** Exact SDK-owned origin, never a URL or allowlist supplied by composition HTML.
 * localhost is retained because the pinned producer serves that origin. This is
 * not DNS pinning, protection of other targets, WebRTC, or a kernel boundary. */
export function originalProducerOrigin(serverUrl) {
  if (typeof serverUrl !== "string") throw failure();
  let url;
  try {url = new URL(serverUrl);} catch {throw failure();}
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    || !url.port || url.username || url.password || url.pathname !== "/" || url.search || url.hash
    || ![url.origin, `${url.origin}/`].includes(serverUrl)) throw failure();
  return url.origin;
}

/** Borrowed original CDP only. Never disables interception on cleanup: doing so
 * would reopen the page before its owning SDK/Job Object has terminated it. */
export async function startOriginalSessionNetworkGuard({cdp, serverUrl, signal}) {
  const origin = originalProducerOrigin(serverUrl);
  if (!(signal instanceof AbortSignal) || !cdp || !["send", "on", "off"].every(key => typeof cdp[key] === "function"))
    throw failure();
  let rejected, closed = false, requests = 0;
  const pending = new Set();
  const reject = () => {rejected ??= failure();};
  const active = () => {
    if (rejected || closed || signal.aborted) throw failure();
  };
  const paused = event => {
    if (closed) return; // Fetch remains enabled; no continue is issued after closure.
    if (++requests > ORIGINAL_SESSION_NETWORK_POLICY.maximumRequests
      || pending.size >= ORIGINAL_SESSION_NETWORK_POLICY.maximumPendingRequests) {reject(); return;}
    let task;
    task = Promise.resolve().then(async () => {
      if (typeof event?.requestId !== "string" || !event.requestId || event.requestId.length > 512) {reject(); return;}
      let allowed = !closed && !signal.aborted && !rejected;
      try {
        const request = event.request;
        if (typeof request?.url !== "string" || Buffer.byteLength(request.url) > ORIGINAL_SESSION_NETWORK_POLICY.maximumUrlBytes)
          throw failure();
        const url = new URL(request.url);
        allowed &&= url.protocol === "http:" && url.origin === origin && !url.username && !url.password
          && ["GET", "HEAD"].includes(request.method) && request.hasPostData !== true && request.postData === undefined;
      } catch {allowed = false;}
      if (!allowed) reject();
      await cdp.send(allowed ? "Fetch.continueRequest" : "Fetch.failRequest",
        allowed ? {requestId: event.requestId} : {requestId: event.requestId, errorReason: "BlockedByClient"});
    }).catch(reject).finally(() => pending.delete(task));
    pending.add(task);
  };
  const drain = async () => {while (pending.size) await Promise.all([...pending]);};
  const close = async () => {
    closed = true;
    try {await drain();} finally {try {cdp.off("Fetch.requestPaused", paused);} catch {throw failure();}}
    return !rejected;
  };
  try {
    active();
    cdp.on("Fetch.requestPaused", paused);
    await cdp.send("Network.enable", {}); active();
    await cdp.send("Network.setBypassServiceWorker", {bypass: true}); active();
    await cdp.send("Network.setCacheDisabled", {cacheDisabled: true}); active();
    await cdp.send("Fetch.enable", {patterns: [{urlPattern: "*", requestStage: "Request"}]}); active();
    return Object.freeze({scope: ORIGINAL_SESSION_NETWORK_POLICY.scope,
      async assertHealthy() {await drain(); active();}, close});
  } catch {
    reject(); try {await close();} catch {} throw failure();
  }
}
