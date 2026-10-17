import assert from "node:assert/strict";
import test from "node:test";
import { readCaptureBrowserIdentity, browserIdentityHash, browserIdentitySchema, assertCaptureBrowserIdentityUnchanged } from "../qa/composition-browser-identity";
import type { CompositionQaCdpClient } from "../qa/composition-qa-browser";
const version = {protocolVersion: "1.3", product: "HeadlessChrome/130.0.0.0", revision: "controlled-revision",
  userAgent: "controlled-agent", jsVersion: "13.0"};
const identity = {policy: "CDP_BROWSER_VERSION_FORWARD_REVERSE_V1" as const,
  scope: "CAPTURE_BROWSER_SELF_REPORTED_VERSION_ONLY" as const, version};

test("identity queries the running browser without reading launch paths, command-line arguments or environment", async () => {
  const calls: string[] = [];
  const client: CompositionQaCdpClient = {close() {}, async send(method) {calls.push(method); return version;}};
  assert.deepEqual(await readCaptureBrowserIdentity(client), identity);
  assert.deepEqual(calls, ["Browser.getVersion"]);
  assert.equal(browserIdentityHash({...identity, version: Object.fromEntries(Object.entries(version).reverse())}), browserIdentityHash(identity));
});

test("missing, oversize, control characters and extra sensitive fields fail closed without exposing response", async () => {
  for (const response of [{}, {...version, product: ""}, {...version, revision: "x".repeat(513)},
    {...version, userAgent: "private\nvalue"}, {...version, arguments: ["private-path"]}]) {
    const client: CompositionQaCdpClient = {close() {}, async send() {return response;}};
    await assert.rejects(readCaptureBrowserIdentity(client), /^Error: CONFORMANCE_BROWSER_IDENTITY_INVALID$/);
  }
  assert.equal(browserIdentitySchema.safeParse({...identity, scope: "BINARY_ATTESTED"}).success, false);
});

test("every reported version field is pinned and any changed field invalidates repeatability identity", () => {
  assert.doesNotThrow(() => assertCaptureBrowserIdentityUnchanged(identity, structuredClone(identity)));
  for (const field of Object.keys(version) as Array<keyof typeof version>) {
    assert.throws(() => assertCaptureBrowserIdentityUnchanged(identity, {...identity, version: {...version, [field]: `${version[field]}-changed`}}), /IDENTITY_CHANGED/);
  }
});
