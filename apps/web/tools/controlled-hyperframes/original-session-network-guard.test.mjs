import test from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {originalProducerOrigin, startOriginalSessionNetworkGuard, ORIGINAL_SESSION_NETWORK_POLICY}
  from "./original-session-network-guard.mjs";

async function fixture(send = async () => ({})) {
  const cdp = new EventEmitter(), calls = [], controller = new AbortController();
  cdp.send = async (method, parameters) => {calls.push({method, parameters}); return send(method, parameters);};
  const guard = await startOriginalSessionNetworkGuard({cdp, serverUrl: "http://localhost:1234", signal: controller.signal});
  const request = (url, method = "GET", extra = {}) => cdp.emit("Fetch.requestPaused",
    {requestId: `request-${calls.length}`, request: {url, method, ...extra}});
  return {cdp, calls, controller, guard, request};
}

test("origin rejects aliases, credentials, non-loopback, missing port and server paths", () => {
  for (const value of ["http://localhost", "http://localhost:80", "http://127.1:1234", "http://2130706433:1234",
    "http://localhost.:1234", "http://localhost:1234/project", "http://user@localhost:1234", "https://localhost:1234",
    "http://evil.test:1234", "http://localhost:1234/?q=1", "http://localhost:1234/#x", "http://LOCALHOST:1234"])
    assert.throws(() => originalProducerOrigin(value));
  assert.equal(originalProducerOrigin("http://127.0.0.1:1234/"), "http://127.0.0.1:1234");
  assert.equal(originalProducerOrigin("http://[::1]:1234"), "http://[::1]:1234");
});

test("interception attaches first, bypasses service workers/cache and admits exact GET/HEAD assets", async () => {
  const f = await fixture();
  assert.deepEqual(f.calls.map(call => call.method), ["Network.enable", "Network.setBypassServiceWorker",
    "Network.setCacheDisabled", "Fetch.enable"]);
  for (const method of ["GET", "HEAD"]) {f.request("http://localhost:1234/media.mp4", method); await f.guard.assertHealthy();}
  assert.equal(f.calls.filter(call => call.method === "Fetch.continueRequest").length, 2);
  assert.equal(f.guard.scope, "ORIGINAL_PAGE_HTTP_GUARD_NOT_OS_NETWORK_ISOLATION");
  await f.guard.close(); assert.equal(f.cdp.listenerCount("Fetch.requestPaused"), 0);
  assert.ok(!f.calls.some(call => call.method === "Fetch.disable"));
});

test("external URLs, redirects to another port, protocols, credentials and mutations reject and latch", async () => {
  for (const [url, method, extra] of [["https://evil.test/", "GET"], ["http://localhost:4321/", "GET"],
    ["http://127.0.0.1:1234/", "GET"], ["file:///private", "GET"], ["ws://localhost:1234/", "GET"],
    ["http://private@localhost:1234/", "GET"], ["http://localhost:1234/", "POST"],
    ["http://localhost:1234/", "GET", {hasPostData: true}], ["http://localhost:1234/", "GET", {postData: "private"}]]) {
    const f = await fixture(); f.request(url, method, extra);
    await assert.rejects(f.guard.assertHealthy(), /ORIGINAL_NETWORK_REJECTED/);
    assert.equal(f.calls.at(-1).method, "Fetch.failRequest");
    f.request("http://localhost:1234/");
    await assert.rejects(f.guard.assertHealthy(), /ORIGINAL_NETWORK_REJECTED/);
    assert.equal(f.calls.at(-1).method, "Fetch.failRequest"); await f.guard.close();
  }
});

test("private CDP errors never leak or reopen interception", async () => {
  const f = await fixture(async method => {if (method === "Fetch.continueRequest") throw new Error("secret URL");});
  f.request("http://localhost:1234/");
  await assert.rejects(f.guard.assertHealthy(), {message: "CONTROLLED_RENDER_ORIGINAL_NETWORK_REJECTED"});
  await f.guard.close();
  const cdp = new EventEmitter(); cdp.send = async () => {throw new Error("private connection");};
  await assert.rejects(startOriginalSessionNetworkGuard({cdp, serverUrl: "http://localhost:1234",
    signal: new AbortController().signal}), {message: "CONTROLLED_RENDER_ORIGINAL_NETWORK_REJECTED"});
  assert.equal(cdp.listenerCount("Fetch.requestPaused"), 0);
});

test("overflow and malformed events fail closed with bounded pending commands", async () => {
  const f = await fixture();
  for (let count = 0; count <= ORIGINAL_SESSION_NETWORK_POLICY.maximumPendingRequests; count++) f.request("http://localhost:1234/");
  await assert.rejects(f.guard.assertHealthy(), /ORIGINAL_NETWORK_REJECTED/);
  assert.equal(f.calls.filter(call => call.method === "Fetch.failRequest").length, ORIGINAL_SESSION_NETWORK_POLICY.maximumPendingRequests);
  assert.ok(!f.calls.some(call => call.method === "Fetch.continueRequest")); await f.guard.close();
  const malformed = await fixture(); malformed.cdp.emit("Fetch.requestPaused", {});
  await assert.rejects(malformed.guard.assertHealthy(), /ORIGINAL_NETWORK_REJECTED/); await malformed.guard.close();
});

test("cancellation never continues a pending request and close drains command acknowledgements", async () => {
  let release;
  const f = await fixture(method => method === "Fetch.failRequest" ? new Promise(resolve => {release = resolve;}) : {});
  f.request("http://localhost:1234/"); f.controller.abort();
  const checking = f.guard.assertHealthy(); await Promise.resolve(); await Promise.resolve();
  let closed = false;
  const closing = f.guard.close().then(() => {closed = true;}); await Promise.resolve();
  assert.equal(closed, false); release({});
  await assert.rejects(checking, /ORIGINAL_NETWORK_REJECTED/); await closing;
  assert.ok(!f.calls.some(call => call.method === "Fetch.continueRequest"));
});
